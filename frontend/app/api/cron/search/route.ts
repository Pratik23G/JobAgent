import { anthropic } from "@/lib/claude";
import { CLAUDE_MODEL } from "@/lib/models";
import { getServiceClient } from "@/lib/db";
import { extensionEvents } from "@/lib/events";
import { complete } from "@/lib/models";
import { validateCronSecret } from "@/lib/cron-auth";
import { searchAdzuna } from "@/lib/job-search";
import { scoreJobs as scoreJobsShared } from "@/lib/job-scoring";

// ─── Daily Job Digest + Auto-Apply Pipeline ─────────────────────────────────
// Trigger via: GET /api/cron/search?secret=YOUR_CRON_SECRET
// Set up with cron-job.org, Vercel Cron, or any scheduler to run daily.
//
// What it does:
// 1. Loads all users who have a resume uploaded
// 2. For each user, searches jobs matching their skills
// 3. Scores results against their resume
// 4. Stores top matches in a new "digest" for the user
// 5. For high-scoring matches (>= 70), auto-generates apply packs
// 6. Queues applications for extension auto-fill + human approval

const MAX_DAILY_APPLICATIONS = 20;
const AUTO_APPLY_MIN_SCORE = 70;

// Search and scoring functions imported from shared modules above

export async function GET(request: Request) {
  const authError = validateCronSecret(request);
  if (authError) return authError;

  const supabase = getServiceClient();

  try {
    // Get all users with resumes
    const { data: resumes } = await supabase
      .from("resumes")
      .select("user_id, parsed_json")
      .not("parsed_json", "is", null);

    if (!resumes || resumes.length === 0) {
      return Response.json({ message: "No users with resumes found", digests: 0 });
    }

    const results: { userId: string; jobsFound: number; topMatches: number; applicationsQueued?: number }[] = [];

    for (const resume of resumes) {
      const parsed = resume.parsed_json as { summary?: string; skills?: string[]; experience?: { title?: string }[] };
      if (!parsed?.skills?.length) continue;

      // Derive search query from resume skills and recent job titles
      const recentTitle = parsed.experience?.[0]?.title || "";
      const topSkills = parsed.skills.slice(0, 3).join(" ");
      const searchQuery = recentTitle || topSkills || "software engineer";

      // Search for jobs
      const jobs = await searchAdzuna(searchQuery, "");

      if (jobs.length === 0) continue;

      // Score against resume
      const scored = await scoreJobsShared(jobs, parsed, 0);
      const topMatches = scored
        .filter((j) => j.match_score >= 60)
        .sort((a, b) => (b.match_score as number) - (a.match_score as number))
        .slice(0, 5);

      if (topMatches.length === 0) continue;

      // Store digest
      await supabase.from("agent_logs").insert({
        user_id: resume.user_id,
        command: "daily_digest",
        action: `Found ${topMatches.length} matching jobs`,
        result: {
          type: "daily_digest",
          date: new Date().toISOString().split("T")[0],
          search_query: searchQuery,
          jobs: topMatches,
        },
      });

      // ─── Auto-apply for high-scoring matches ────────────────────────────
      // Check daily cap
      const { data: todaysRuns } = await supabase
        .from("pipeline_runs")
        .select("applications_queued")
        .eq("user_id", resume.user_id)
        .eq("run_date", new Date().toISOString().split("T")[0]);

      const todaysTotal = (todaysRuns || []).reduce((sum, r) => sum + (r.applications_queued || 0), 0);
      const remainingCap = Math.max(0, MAX_DAILY_APPLICATIONS - todaysTotal);

      const autoApplyJobs = topMatches
        .filter((j) => (j.match_score as number) >= AUTO_APPLY_MIN_SCORE)
        .slice(0, remainingCap);

      let applicationsQueued = 0;

      for (const job of autoApplyJobs) {
        // Check for duplicates
        const { data: existing } = await supabase
          .from("applications")
          .select("id")
          .eq("user_id", resume.user_id)
          .ilike("company", `%${job.company}%`)
          .ilike("job_title", `%${job.title}%`)
          .limit(1);

        if (existing && existing.length > 0) continue;

        try {
          // Generate apply pack via Claude
          const resp = await anthropic.messages.create({
            model: CLAUDE_MODEL,
            max_tokens: 2500,
            messages: [{
              role: "user",
              content: `Generate a job application package. Return ONLY valid JSON, no markdown fences.

Job: ${job.title} at ${job.company}
Job Description: ${job.description}
Candidate Summary: ${parsed.summary || "Experienced professional"}
Candidate Skills: ${(parsed.skills || []).join(", ")}

JSON format:
{
  "cover_letter": "Professional cover letter under 200 words, specific to this role",
  "resume_bullets": "5 tailored resume bullet points matching this JD, each starting with action verb",
  "why_good_fit": "2-3 sentence explanation of why this candidate fits this role",
  "outreach_email": "Cold email under 80 words to hiring manager, genuine, with clear ask",
  "common_answers": {
    "why_this_company": "2 sentences",
    "why_this_role": "2 sentences"
  }
}`,
            }],
          });

          const rawText = resp.content[0].type === "text" ? resp.content[0].text : "{}";
          const cleaned = rawText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          const pack = JSON.parse(cleaned);

          // Save application
          const { data: appData } = await supabase
            .from("applications")
            .insert({
              user_id: resume.user_id,
              job_title: job.title,
              company: job.company,
              job_url: job.url,
              cover_letter: pack.cover_letter || null,
              status: "queued",
              notes: `Auto-pipeline (cron). Score: ${job.match_score}. Source: ${job.source || "adzuna"}`,
            })
            .select("id")
            .single();

          // Save apply pack
          const { data: packData } = await supabase
            .from("apply_packs")
            .insert({
              user_id: resume.user_id,
              application_id: appData?.id || null,
              job_title: job.title,
              company: job.company,
              job_url: job.url,
              cover_letter: pack.cover_letter,
              resume_bullets: pack.resume_bullets,
              why_good_fit: pack.why_good_fit,
              common_answers: pack.common_answers,
              outreach_email: pack.outreach_email,
              source: job.source || "adzuna",
            })
            .select("id")
            .single();

          // Queue for auto-fill
          await supabase.from("application_queue").insert({
            user_id: resume.user_id,
            application_id: appData?.id,
            apply_pack_id: packData?.id,
            job_url: job.url,
            job_title: job.title,
            company: job.company,
            match_score: job.match_score,
            status: "pending_fill",
          });

          applicationsQueued++;
        } catch (err) {
          console.error(`Failed to generate apply pack for ${job.company}:`, err);
        }
      }

      // Record pipeline run
      if (applicationsQueued > 0) {
        await supabase.from("pipeline_runs").insert({
          user_id: resume.user_id,
          trigger: "cron",
          jobs_found: jobs.length,
          jobs_matched: topMatches.length,
          packs_generated: applicationsQueued,
          applications_queued: applicationsQueued,
        });
      }

      results.push({
        userId: resume.user_id,
        jobsFound: jobs.length,
        topMatches: topMatches.length,
        applicationsQueued,
      });
    }

    return Response.json({
      message: `Daily digest complete. Processed ${resumes.length} users.`,
      digests: results.length,
      results,
    });
  } catch (err) {
    console.error("Cron search error:", err);
    return new Response("Cron job failed", { status: 500 });
  }
}
