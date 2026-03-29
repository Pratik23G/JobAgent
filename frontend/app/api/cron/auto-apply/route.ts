import { getServiceClient } from "@/lib/db";
import { extensionEvents } from "@/lib/events";
import { validateCronSecret } from "@/lib/cron-auth";

// ─── Auto-Apply Cron: Process Queued Applications ───────────────────────────
// Trigger via: GET /api/cron/auto-apply?secret=YOUR_CRON_SECRET
//
// Processes application_queue items with status "pending_fill":
// 1. Loads queued items that haven't been sent to the extension yet
// 2. Pushes auto_fill_request events to the extension via SSE
// 3. Extension navigates to URL, fills form (no submit), reports back
// 4. Also handles items stuck in "pending_fill" for > 1 hour (retry)

const MAX_CONCURRENT_FILLS = 5;
const FILL_DELAY_MS = 10_000; // 10s between fills to avoid rate limits

export async function GET(request: Request) {
  const authError = validateCronSecret(request);
  if (authError) return authError;

  const supabase = getServiceClient();

  try {
    // Get pending_fill items (not yet sent to extension)
    const { data: pendingItems } = await supabase
      .from("application_queue")
      .select(`
        id, user_id, application_id, apply_pack_id, job_url, job_title, company, match_score,
        auto_fill_attempted_at
      `)
      .eq("status", "pending_fill")
      .order("created_at", { ascending: true })
      .limit(MAX_CONCURRENT_FILLS * 3); // fetch more than needed, we'll filter per user

    if (!pendingItems || pendingItems.length === 0) {
      return Response.json({ message: "No pending items to process", processed: 0 });
    }

    // Group by user_id for efficient processing
    const byUser = new Map<string, typeof pendingItems>();
    for (const item of pendingItems) {
      const list = byUser.get(item.user_id) || [];
      list.push(item);
      byUser.set(item.user_id, list);
    }

    let totalProcessed = 0;
    const results: { userId: string; queued: number; sent: number }[] = [];

    for (const [userId, items] of byUser) {
      // Get user's profile and resume for form filling
      const { data: resume } = await supabase
        .from("resumes")
        .select("parsed_json, file_url")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      const profile = resume?.parsed_json as Record<string, unknown> || {};

      // Get apply pack data for each item
      let sentCount = 0;
      const toSend = items.slice(0, MAX_CONCURRENT_FILLS);

      for (const item of toSend) {
        // Skip if already attempted recently (within 1 hour) — avoid spam
        if (item.auto_fill_attempted_at) {
          const attemptedAt = new Date(item.auto_fill_attempted_at).getTime();
          if (Date.now() - attemptedAt < 60 * 60 * 1000) continue;
        }

        // Fetch the apply pack
        let pack = null;
        if (item.apply_pack_id) {
          const { data: packData } = await supabase
            .from("apply_packs")
            .select("*")
            .eq("id", item.apply_pack_id)
            .single();
          pack = packData;
        }

        // Send auto_fill_request to extension via SSE
        // The extension will: open tab → fill form (no submit) → report results
        extensionEvents.publish(userId, {
          type: "auto_fill_request" as "apply_pack",
          data: {
            queueId: item.id,
            jobUrl: item.job_url,
            jobTitle: item.job_title,
            company: item.company,
            matchScore: item.match_score,
            pack: pack ? {
              cover_letter: pack.cover_letter,
              resume_bullets: pack.resume_bullets,
              why_good_fit: pack.why_good_fit,
              common_answers: pack.common_answers,
              outreach_email: pack.outreach_email,
            } : null,
            profile: {
              firstName: profile.name?.toString().split(" ")[0] || "",
              lastName: profile.name?.toString().split(" ").slice(1).join(" ") || "",
              email: profile.email || "",
              phone: profile.phone || "",
              linkedin: profile.linkedin || "",
              website: profile.website || "",
              location: profile.location || "",
              skills: profile.skills || [],
            },
            resumeFileUrl: resume?.file_url || null,
          },
        });

        // Mark as attempted
        await supabase
          .from("application_queue")
          .update({ auto_fill_attempted_at: new Date().toISOString() })
          .eq("id", item.id);

        sentCount++;
        totalProcessed++;

        // Delay between fills
        if (sentCount < toSend.length) {
          await new Promise((r) => setTimeout(r, FILL_DELAY_MS));
        }
      }

      results.push({ userId, queued: items.length, sent: sentCount });
    }

    return Response.json({
      message: `Auto-apply cron complete. Sent ${totalProcessed} fill requests to extensions.`,
      processed: totalProcessed,
      results,
    });
  } catch (err) {
    console.error("Auto-apply cron error:", err);
    return new Response("Auto-apply cron failed", { status: 500 });
  }
}
