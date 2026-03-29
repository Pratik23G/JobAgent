// POST /api/jobs/auto-apply
// Receives selected jobs, generates apply packs, and queues them for the extension via SSE.

import { anthropic } from "@/lib/claude";
import { getServiceClient } from "@/lib/db";
import { extensionEvents } from "@/lib/events";

export async function POST(request: Request) {
  const { jobs, sessionId, mode = "review" } = await request.json();

  if (!jobs || !Array.isArray(jobs) || jobs.length === 0) {
    return Response.json({ error: "No jobs provided" }, { status: 400 });
  }

  const supabase = getServiceClient();
  const userId = `anon_${sessionId || "unknown"}`;

  // Load user resume
  const { data: resume } = await supabase
    .from("resumes")
    .select("parsed_json")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const parsed = resume?.parsed_json as { summary?: string; skills?: string[] } | null;
  const resumeSummary = parsed?.summary || "Experienced professional";
  const skills = parsed?.skills || [];

  const results: {
    company: string;
    title: string;
    url: string;
    status: string;
    error?: string;
  }[] = [];

  for (const job of jobs.slice(0, 10)) {
    // Check duplicate
    const { data: existing } = await supabase
      .from("applications")
      .select("id")
      .eq("user_id", userId)
      .ilike("company", `%${job.company}%`)
      .ilike("job_title", `%${job.title}%`)
      .limit(1);

    if (existing && existing.length > 0) {
      results.push({ company: job.company, title: job.title, url: job.url, status: "skipped_duplicate" });
      continue;
    }

    try {
      // Generate apply pack
      const resp = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2500,
        messages: [
          {
            role: "user",
            content: `Generate a job application package. Return ONLY valid JSON, no markdown fences.

Job: ${job.title} at ${job.company}
Job Description: ${job.description || "Not available"}
Candidate Summary: ${resumeSummary}
Candidate Skills: ${skills.join(", ")}

JSON format:
{
  "cover_letter": "Professional cover letter under 200 words, specific to this role",
  "resume_bullets": "5 tailored resume bullet points matching this JD, each starting with action verb",
  "why_good_fit": "2-3 sentence explanation of why this candidate fits this role",
  "outreach_email": "Cold email under 80 words to hiring manager",
  "common_answers": {
    "why_this_company": "2 sentences",
    "why_this_role": "2 sentences",
    "greatest_strength": "1-2 sentences",
    "salary_expectations": "Competitive salary commensurate with experience"
  }
}`,
          },
        ],
      });

      const rawText = resp.content[0].type === "text" ? resp.content[0].text : "{}";
      const cleaned = rawText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const pack = JSON.parse(cleaned);

      // Save to DB
      const { data: appData } = await supabase
        .from("applications")
        .insert({
          user_id: userId,
          job_title: job.title,
          company: job.company,
          job_url: job.url,
          cover_letter: pack.cover_letter || null,
          status: "queued",
          notes: `Auto-apply queued (${mode} mode).`,
        })
        .select("id")
        .single();

      await supabase.from("apply_packs").insert({
        user_id: userId,
        application_id: appData?.id || null,
        job_title: job.title,
        company: job.company,
        job_url: job.url,
        cover_letter: pack.cover_letter,
        resume_bullets: pack.resume_bullets,
        why_good_fit: pack.why_good_fit,
        common_answers: pack.common_answers,
        outreach_email: pack.outreach_email,
        source: "auto_apply_dashboard",
      });

      // Send to extension via SSE
      extensionEvents.publish(sessionId || userId, {
        type: "auto_apply",
        data: {
          action: "navigate_and_fill",
          mode,
          job: {
            company: job.company,
            title: job.title,
            url: job.url,
            score: job.score || 0,
          },
          pack: {
            company: job.company,
            title: job.title,
            job_url: job.url,
            cover_letter: pack.cover_letter || "",
            resume_bullets: pack.resume_bullets || "",
            why_good_fit: pack.why_good_fit || "",
            common_answers: pack.common_answers || {},
            outreach_email: pack.outreach_email || "",
          },
        },
      });

      results.push({ company: job.company, title: job.title, url: job.url, status: "queued" });
    } catch (err) {
      results.push({ company: job.company, title: job.title, url: job.url, status: "error", error: String(err).slice(0, 100) });
    }
  }

  // Log activity
  await supabase.from("agent_logs").insert({
    user_id: userId,
    command: `auto_apply_dashboard: ${jobs.length} jobs`,
    action: `Queued ${results.filter((r) => r.status === "queued").length} jobs for auto-apply (${mode} mode)`,
    result: { results },
  });

  return Response.json({
    results,
    queued: results.filter((r) => r.status === "queued").length,
    skipped: results.filter((r) => r.status === "skipped_duplicate").length,
    failed: results.filter((r) => r.status === "error").length,
  });
}
