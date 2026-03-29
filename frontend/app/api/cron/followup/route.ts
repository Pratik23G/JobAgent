import { getServiceClient } from "@/lib/db";
import { sendColdEmail } from "@/lib/resend";
import { complete } from "@/lib/models";
import { validateCronSecret } from "@/lib/cron-auth";

// ─── Follow-Up Email Cron ───────────────────────────────────────────────────
// Trigger via: GET /api/cron/followup?secret=YOUR_CRON_SECRET
//
// Processes scheduled follow-up emails:
// 1. Finds follow-ups due today (scheduled_at <= now, status = 'scheduled')
// 2. Checks if a reply was received (email_replies table)
// 3. If no reply: generates a shorter follow-up via Claude, sends it
// 4. If reply received: marks as 'replied' and skips

const MAX_FOLLOWUPS_PER_THREAD = 3;
const MAX_EMAILS_PER_RUN = 10;

export async function GET(request: Request) {
  const authError = validateCronSecret(request);
  if (authError) return authError;

  const supabase = getServiceClient();

  try {
    // Get due follow-ups
    const { data: dueFollowups } = await supabase
      .from("email_followups")
      .select(`
        id, user_id, original_email_id, scheduled_at, followup_number, subject, body, status
      `)
      .eq("status", "scheduled")
      .lte("scheduled_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(MAX_EMAILS_PER_RUN);

    if (!dueFollowups || dueFollowups.length === 0) {
      return Response.json({ message: "No follow-ups due", sent: 0 });
    }

    let sentCount = 0;
    let skippedCount = 0;
    const results: { email: string; action: string }[] = [];

    for (const followup of dueFollowups) {
      // Fetch original email details
      const { data: originalEmail } = await supabase
        .from("recruiter_emails")
        .select("*")
        .eq("id", followup.original_email_id)
        .single();

      if (!originalEmail) {
        await supabase.from("email_followups").update({ status: "cancelled" }).eq("id", followup.id);
        continue;
      }

      // Check if they already replied
      const { data: replies } = await supabase
        .from("email_replies")
        .select("id")
        .eq("linked_recruiter_email_id", followup.original_email_id)
        .limit(1);

      // Also check if the recruiter_emails record was marked as replied
      if ((replies && replies.length > 0) || originalEmail.replied) {
        await supabase.from("email_followups").update({ status: "replied" }).eq("id", followup.id);
        skippedCount++;
        results.push({ email: originalEmail.recruiter_email, action: "skipped (replied)" });
        continue;
      }

      // Check max follow-ups per thread
      if (followup.followup_number > MAX_FOLLOWUPS_PER_THREAD) {
        await supabase.from("email_followups").update({ status: "cancelled" }).eq("id", followup.id);
        results.push({ email: originalEmail.recruiter_email, action: "cancelled (max follow-ups reached)" });
        continue;
      }

      // Generate follow-up email via GPT-4o mini (with fallback)
      try {
        const resp = await complete(
          {
            system: "You are a professional email writer. Write concise follow-up emails.",
            userMessage: `Write a brief follow-up email (follow-up #${followup.followup_number}).

Original email sent to ${originalEmail.recruiter_name || "them"} at ${originalEmail.company || "the company"}:
Subject: ${originalEmail.subject}
Body: ${originalEmail.body}

Rules:
- Under 60 words
- Reference the original email briefly ("Following up on my previous email about...")
- Be respectful of their time
- Reiterate interest concisely
- Include a soft ask ("Would love to connect when you have a moment")
- Sound human, not automated
- No apologies for following up

Return ONLY the email body.`,
            maxTokens: 400,
          },
          "email_draft"
        );

        const followupBody = resp.text;
        const followupSubject = `Re: ${originalEmail.subject}`;

        // Get sender name from user's resume
        const { data: resume } = await supabase
          .from("resumes")
          .select("parsed_json")
          .eq("user_id", followup.user_id)
          .order("created_at", { ascending: false })
          .limit(1)
          .single();

        const fromName = (resume?.parsed_json as { name?: string })?.name || "JobAgent User";

        // Send the follow-up
        await sendColdEmail({
          to: originalEmail.recruiter_email,
          toName: originalEmail.recruiter_name || undefined,
          subject: followupSubject,
          body: followupBody,
          fromName,
        });

        // Update follow-up record
        await supabase.from("email_followups").update({
          status: "sent",
          subject: followupSubject,
          body: followupBody,
          sent_at: new Date().toISOString(),
        }).eq("id", followup.id);

        // Update original email's followup count
        await supabase.from("recruiter_emails").update({
          followup_count: followup.followup_number,
        }).eq("id", followup.original_email_id);

        // Schedule the next follow-up (if under max)
        if (followup.followup_number < MAX_FOLLOWUPS_PER_THREAD) {
          const nextScheduled = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000); // 5 days later
          await supabase.from("email_followups").insert({
            user_id: followup.user_id,
            original_email_id: followup.original_email_id,
            scheduled_at: nextScheduled.toISOString(),
            followup_number: followup.followup_number + 1,
            status: "scheduled",
          });
        }

        sentCount++;
        results.push({ email: originalEmail.recruiter_email, action: `follow-up #${followup.followup_number} sent` });
      } catch (err) {
        console.error(`Follow-up failed for ${originalEmail.recruiter_email}:`, err);
        results.push({ email: originalEmail.recruiter_email, action: `failed: ${String(err).slice(0, 100)}` });
      }
    }

    return Response.json({
      message: `Follow-up cron complete. Sent: ${sentCount}, Skipped: ${skippedCount}`,
      sent: sentCount,
      skipped: skippedCount,
      results,
    });
  } catch (err) {
    console.error("Follow-up cron error:", err);
    return new Response("Follow-up cron failed", { status: 500 });
  }
}
