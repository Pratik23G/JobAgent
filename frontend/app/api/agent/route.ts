import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { anthropic, AGENT_TOOLS, buildSystemPrompt } from "@/lib/claude";
import { getServiceClient } from "@/lib/db";
import { sendColdEmail } from "@/lib/resend";
import { runSubAgent, orchestrateApplication, createApplicationPlan } from "@/lib/orchestrator";
import { extensionEvents } from "@/lib/events";
import { complete, CLAUDE_MODEL } from "@/lib/models";
import { AgentCommandSchema, validateRequest } from "@/lib/validation";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { checkAndIncrementUsage, usageLimitResponse } from "@/lib/usage";
import { scoreJobs } from "@/lib/job-scoring";
import { searchMultipleSources, type JobResult } from "@/lib/job-search";
import { loadSessionContext, saveSessionState } from "@/lib/session";
import { getBaseUrl } from "@/lib/config";
import type Anthropic from "@anthropic-ai/sdk";

// Search, scoring, and session functions extracted to:
// - lib/job-search.ts
// - lib/job-scoring.ts
// - lib/session.ts

// ─── Tool handlers ───────────────────────────────────────────────────────────

async function handleToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
  userId: string,
  resumeData: Record<string, unknown> | null,
  sessionId?: string
): Promise<string> {
  const supabase = getServiceClient();

  switch (toolName) {
    case "search_jobs": {
      const title = toolInput.title as string;
      const location = (toolInput.location as string) || "";
      const keywords = (toolInput.keywords as string[]) || [];
      const minScore = (toolInput.min_match_score as number) || 0;

      try {
        const allJobs = await searchMultipleSources(title, location, keywords);

        if (allJobs.length === 0) {
          return JSON.stringify({
            jobs: [],
            count: 0,
            message: `No jobs found for "${title}" in "${location || "any location"}". Try broader terms like "software engineer" or a major city name.`,
          });
        }

        // RAG: Score jobs against resume
        const scoredJobs = await scoreJobs(
          allJobs,
          resumeData as { summary?: string; skills?: string[] },
          minScore
        );

        return JSON.stringify({ jobs: scoredJobs, count: scoredJobs.length });
      } catch (err) {
        return JSON.stringify({
          error: "Failed to search jobs",
          detail: String(err),
        });
      }
    }

    case "write_cover_letter": {
      const { job_title, company, job_description, resume_summary } =
        toolInput as {
          job_title: string;
          company: string;
          job_description: string;
          resume_summary: string;
        };

      const resp = await complete(
        {
          system: "You are a professional cover letter writer. Write compelling, specific cover letters.",
          userMessage: `Write a concise, professional cover letter for a ${job_title} position at ${company}.

Job description: ${job_description}

Candidate resume summary: ${resume_summary}

Write it in first person, keep it under 300 words. Be specific about why this candidate is a fit. No generic filler.`,
          maxTokens: 1024,
        },
        "cover_letter"
      );

      const letter = resp.text;
      return JSON.stringify({ cover_letter: letter });
    }

    case "apply_to_job": {
      const { job_title, company, job_url, cover_letter } = toolInput as {
        job_title: string;
        company: string;
        job_url: string;
        cover_letter?: string;
      };

      // Check for duplicate applications
      const { data: existing } = await supabase
        .from("applications")
        .select("id, status")
        .eq("user_id", userId)
        .ilike("company", `%${company}%`)
        .ilike("job_title", `%${job_title}%`)
        .limit(1);

      if (existing && existing.length > 0) {
        return JSON.stringify({
          error: "duplicate",
          message: `Already applied to ${company} for a similar role (${job_title}). Status: ${existing[0].status}`,
          existing_id: existing[0].id,
        });
      }

      const { data, error } = await supabase
        .from("applications")
        .insert({
          user_id: userId,
          job_title,
          company,
          job_url,
          cover_letter: cover_letter || null,
          status: "ready",
        })
        .select()
        .single();

      if (error) {
        return JSON.stringify({
          error: "Failed to save application",
          detail: error.message,
        });
      }

      return JSON.stringify({
        success: true,
        application_id: data.id,
        message: `Application to ${company} for ${job_title} recorded.`,
      });
    }

    case "write_cold_email": {
      const {
        recruiter_name, recipient_title, recipient_context,
        company, company_domain, role_interest, resume_summary,
        relevant_projects, company_tech_stack,
      } = toolInput as {
        recruiter_name: string;
        recipient_title?: string;
        recipient_context?: string;
        company: string;
        company_domain?: string;
        role_interest: string;
        resume_summary?: string;
        relevant_projects?: { name: string; url: string; description: string; tech_stack: string[] }[];
        company_tech_stack?: string[];
      };

      // Build enriched context using email personalizer
      let emailContext = "";
      try {
        const { buildEmailContext } = await import("@/lib/email-personalizer");
        emailContext = await buildEmailContext({
          recipientName: recruiter_name,
          recipientTitle: recipient_title || "",
          recipientContext: recipient_context,
          company,
          companyDomain: company_domain,
          roleInterest: role_interest,
          candidateSummary: resume_summary || (resumeData as { summary?: string })?.summary || "Experienced professional",
          candidateSkills: (resumeData as { skills?: string[] })?.skills || [],
          relevantProjects: relevant_projects || [],
          companyTechStack: company_tech_stack,
        });
      } catch {
        // Fallback to basic context
        emailContext = `Recipient: ${recruiter_name}${recipient_title ? `, ${recipient_title}` : ""} at ${company}\nRole: ${role_interest}\n${resume_summary || ""}`;
      }

      const resp = await complete(
        {
          system: "You are a cold email expert. Write genuine, personalized outreach emails.",
          userMessage: `Write a cold email based on this context. Return ONLY the email body — no subject line.

${emailContext}

RULES:
- Under 150 words. Genuine, not salesy. Varied sentence lengths.
- Reference the recipient's specific role or work if context is available
- If relevant projects are listed, mention 1-2 with their URLs naturally in the text
- Include a clear, specific ask (e.g., "Would you be open to a 15-minute chat this week?")
- Sound like a real person wrote it — no corporate jargon, no "I hope this email finds you well"
- No "As an AI" or similar phrases
- Use the recipient's first name naturally
- If writing to an engineer, be technical and peer-to-peer
- If writing to a recruiter, be professional but warm
- If writing to an executive, be brief and vision-aligned`,
          maxTokens: 800,
        },
        "email_draft"
      );

      const emailBody = resp.text;
      return JSON.stringify({
        email_body: emailBody,
        subject: `${role_interest} — ${company}`,
        to_name: recruiter_name,
        recipient_title: recipient_title || "",
        projects_included: (relevant_projects || []).map(p => ({ name: p.name, url: p.url })),
      });
    }

    case "send_email": {
      const {
        to_email, to_name, subject, body, company,
        recipient_title, attach_resume, project_links,
        schedule_followup_days,
      } = toolInput as {
        to_email: string;
        to_name?: string;
        subject: string;
        body: string;
        company?: string;
        recipient_title?: string;
        attach_resume?: boolean;
        project_links?: { name: string; url: string }[];
        schedule_followup_days?: number;
      };

      try {
        // Build attachments if resume requested
        const attachments: { filename: string; content: string; content_type: string }[] = [];

        if (attach_resume) {
          // Fetch resume from DB
          const { data: resume } = await supabase
            .from("resumes")
            .select("file_url")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(1)
            .single();

          if (resume?.file_url) {
            // file_url is a data URI: "data:application/pdf;base64,..."
            const base64Match = (resume.file_url as string).match(/^data:[^;]+;base64,(.+)$/);
            if (base64Match) {
              attachments.push({
                filename: "resume.pdf",
                content: base64Match[1],
                content_type: "application/pdf",
              });
            }
          }
        }

        // Get sender name from resume
        const parsedResume = resumeData as { name?: string } | null;
        const fromName = parsedResume?.name || "JobAgent User";

        await sendColdEmail({
          to: to_email,
          toName: to_name,
          subject,
          body,
          fromName,
          attachments: attachments.length > 0 ? attachments : undefined,
        });

        // Save to DB with enriched metadata
        const { data: emailRecord } = await supabase.from("recruiter_emails").insert({
          user_id: userId,
          recruiter_name: to_name || null,
          recruiter_email: to_email,
          company: company || null,
          subject,
          body,
          status: "sent",
          recipient_title: recipient_title || null,
          has_attachment: attachments.length > 0,
          project_links: project_links || null,
          thread_id: `thread_${Date.now()}`,
        }).select("id").single();

        // Schedule follow-up if requested
        const followupDays = schedule_followup_days ?? 5;
        if (followupDays > 0 && emailRecord?.id) {
          const scheduledAt = new Date(Date.now() + followupDays * 24 * 60 * 60 * 1000);
          await supabase.from("email_followups").insert({
            user_id: userId,
            original_email_id: emailRecord.id,
            scheduled_at: scheduledAt.toISOString(),
            followup_number: 1,
            status: "scheduled",
          });
        }

        return JSON.stringify({
          success: true,
          message: `Email sent to ${to_email}${attachments.length > 0 ? " with resume attached" : ""}.${followupDays > 0 ? ` Follow-up scheduled in ${followupDays} days.` : ""}`,
          has_attachment: attachments.length > 0,
          followup_scheduled: followupDays > 0,
        });
      } catch (err) {
        return JSON.stringify({
          error: "Failed to send email",
          detail: String(err),
        });
      }
    }

    case "get_application_status": {
      const company = toolInput.company as string | undefined;

      let query = supabase
        .from("applications")
        .select("id, job_title, company, status, applied_at, notes")
        .eq("user_id", userId)
        .order("applied_at", { ascending: false });

      if (company) {
        query = query.ilike("company", `%${company}%`);
      }

      const { data, error } = await query.limit(20);

      if (error) {
        return JSON.stringify({
          error: "Failed to fetch applications",
          detail: error.message,
        });
      }

      return JSON.stringify({
        applications: data || [],
        count: data?.length || 0,
      });
    }

    case "search_jobs_multi": {
      const title = toolInput.title as string;
      const location = (toolInput.location as string) || "";
      const keywords = (toolInput.keywords as string[]) || [];
      const minScore = (toolInput.min_match_score as number) || 0;

      const results = await searchMultipleSources(title, location, keywords);

      if (results.length === 0) {
        return JSON.stringify({
          jobs: [],
          count: 0,
          message: `No jobs found for "${title}" across any source. Try broader terms.`,
        });
      }

      // RAG score against resume
      const scored = await scoreJobs(
        results,
        resumeData as { summary?: string; skills?: string[] },
        minScore
      );

      return JSON.stringify({ jobs: scored, count: scored.length });
    }

    case "auto_apply_pipeline": {
      const title = toolInput.title as string;
      const location = (toolInput.location as string) || "remote";
      const keywords = (toolInput.keywords as string[]) || [];
      const minScore = (toolInput.min_match_score as number) || 60;

      // Check daily cap (20 applications/day)
      const MAX_DAILY_APPS = 20;
      const { data: todaysRuns } = await supabase
        .from("pipeline_runs")
        .select("applications_queued")
        .eq("user_id", userId)
        .eq("run_date", new Date().toISOString().split("T")[0]);
      const todaysTotal = (todaysRuns || []).reduce((sum: number, r: { applications_queued: number }) => sum + (r.applications_queued || 0), 0);
      const remainingCap = Math.max(0, MAX_DAILY_APPS - todaysTotal);
      const maxApps = Math.min((toolInput.max_applications as number) || 5, 10, remainingCap);

      if (maxApps === 0) {
        return JSON.stringify({
          error: "Daily application cap reached (20/day). Try again tomorrow.",
          today_total: todaysTotal,
        });
      }

      const resumeSummary = (resumeData as { summary?: string })?.summary || "Experienced professional";
      const skills = (resumeData as { skills?: string[] })?.skills || [];

      const pipeline: {
        jobs_found: number;
        jobs_matched: number;
        apply_packs: {
          company: string;
          title: string;
          apply_url: string;
          score: number;
          source: string;
          cover_letter: string;
          resume_bullets: string;
          why_good_fit: string;
          outreach_email: string;
          common_answers: Record<string, string>;
        }[];
        skipped_duplicates: string[];
        errors: string[];
      } = {
        jobs_found: 0,
        jobs_matched: 0,
        apply_packs: [],
        skipped_duplicates: [],
        errors: [],
      };

      try {
        // Step 1: Search across sources
        const allJobs = await searchMultipleSources(title, location, keywords);
        pipeline.jobs_found = allJobs.length;

        if (allJobs.length === 0) {
          return JSON.stringify({
            ...pipeline,
            message: `No jobs found for "${title}". Try broader search terms.`,
          });
        }

        // Step 2: Score against resume
        const scored = await scoreJobs(
          allJobs,
          resumeData as { summary?: string; skills?: string[] },
          minScore
        );
        pipeline.jobs_matched = scored.length;

        if (scored.length === 0) {
          return JSON.stringify({
            ...pipeline,
            message: `Found ${pipeline.jobs_found} jobs but none scored above ${minScore} against your resume. Try lowering the minimum score or broadening your search.`,
          });
        }

        // Step 3: Generate apply packs for top matches
        const toApply = scored.slice(0, maxApps);

        for (const job of toApply) {
          // Check for duplicates (only if authenticated)
          if (userId !== "anonymous") {
            const { data: existing } = await supabase
              .from("applications")
              .select("id")
              .eq("user_id", userId)
              .ilike("company", `%${job.company}%`)
              .ilike("job_title", `%${job.title}%`)
              .limit(1);

            if (existing && existing.length > 0) {
              pipeline.skipped_duplicates.push(`${job.company} - ${job.title}`);
              continue;
            }
          }

          // Generate full apply pack in one Claude call
          try {
            const resp = await anthropic.messages.create({
              model: CLAUDE_MODEL,
              max_tokens: 2500,
              messages: [
                {
                  role: "user",
                  content: `Generate a job application package. Return ONLY valid JSON, no markdown fences.

Job: ${job.title} at ${job.company}
Job Description: ${job.description}
Candidate Summary: ${resumeSummary}
Candidate Skills: ${skills.join(", ")}

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
                },
              ],
            });

            const rawText = resp.content[0].type === "text" ? resp.content[0].text : "{}";
            const cleaned = rawText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
            const pack = JSON.parse(cleaned);

            // Save to DB if authenticated
            if (userId !== "anonymous") {
              const { data: appData } = await supabase
                .from("applications")
                .insert({
                  user_id: userId,
                  job_title: job.title,
                  company: job.company,
                  job_url: job.url,
                  cover_letter: pack.cover_letter || null,
                  status: "ready",
                  notes: `Auto-pipeline. Score: ${job.match_score}. Source: ${job.source || "adzuna"}`,
                })
                .select("id")
                .single();

              const { data: packData } = await supabase.from("apply_packs").insert({
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
                source: job.source || "adzuna",
              }).select("id").single();

              // Queue for the Auto-Apply Queue dashboard
              await supabase.from("application_queue").insert({
                user_id: userId,
                application_id: appData?.id || null,
                apply_pack_id: packData?.id || null,
                job_url: job.url,
                job_title: job.title,
                company: job.company,
                match_score: job.match_score || 0,
                status: "pending_review",
              });
            }

            pipeline.apply_packs.push({
              company: job.company,
              title: job.title,
              apply_url: job.url,
              score: job.match_score,
              source: job.source || "adzuna",
              cover_letter: pack.cover_letter || "",
              resume_bullets: pack.resume_bullets || "",
              why_good_fit: pack.why_good_fit || "",
              outreach_email: pack.outreach_email || "",
              common_answers: pack.common_answers || {},
            });
          } catch (err) {
            pipeline.errors.push(`Apply pack failed for ${job.company}: ${String(err).slice(0, 100)}`);
          }
        }

        // Log + record pipeline run for daily cap
        if (userId !== "anonymous") {
          await supabase.from("agent_logs").insert({
            user_id: userId,
            command: `auto_apply_pipeline: ${title}`,
            action: `Generated ${pipeline.apply_packs.length} apply packs`,
            result: { summary: pipeline },
          });

          await supabase.from("pipeline_runs").insert({
            user_id: userId,
            trigger: "agent",
            jobs_found: pipeline.jobs_found,
            jobs_matched: pipeline.jobs_matched,
            packs_generated: pipeline.apply_packs.length,
            applications_queued: pipeline.apply_packs.length,
          });
        }

        return JSON.stringify({
          ...pipeline,
          daily_remaining: remainingCap - pipeline.apply_packs.length,
          message: `Pipeline complete! Found ${pipeline.jobs_found} jobs, ${pipeline.jobs_matched} matched your resume (score >= ${minScore}). Generated ${pipeline.apply_packs.length} apply packs. ${remainingCap - pipeline.apply_packs.length} applications remaining today (cap: ${MAX_DAILY_APPS}/day). Applications are queued — review them in the Queue dashboard.`,
        });
      } catch (err) {
        return JSON.stringify({
          ...pipeline,
          error: "Pipeline failed",
          detail: String(err),
        });
      }
    }

    case "follow_up_applications": {
      const daysSince = (toolInput.days_since_applied as number) || 5;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - daysSince);

      const { data: staleApps, error } = await supabase
        .from("applications")
        .select("id, job_title, company, status, applied_at, job_url")
        .eq("user_id", userId)
        .eq("status", "applied")
        .lt("applied_at", cutoff.toISOString())
        .order("applied_at", { ascending: true })
        .limit(10);

      if (error) {
        return JSON.stringify({ error: "Failed to query applications", detail: error.message });
      }

      if (!staleApps || staleApps.length === 0) {
        return JSON.stringify({
          follow_ups: [],
          message: `No applications older than ${daysSince} days need follow-up. All caught up!`,
        });
      }

      const resumeSummary = (resumeData as { summary?: string })?.summary || "Experienced professional";

      const followUps: { company: string; job_title: string; days_ago: number; follow_up_email: string; subject: string }[] = [];

      for (const app of staleApps) {
        const daysAgo = Math.floor((Date.now() - new Date(app.applied_at).getTime()) / (1000 * 60 * 60 * 24));

        try {
          const resp = await complete(
            {
              system: "You are a professional email writer. Write concise follow-up emails.",
              userMessage: `Write a brief follow-up email (under 80 words) for a ${app.job_title} role at ${app.company} that was applied to ${daysAgo} days ago. Candidate: ${resumeSummary}. Be polite, express continued interest, ask about timeline. Just the body.`,
              maxTokens: 300,
            },
            "email_draft"
          );

          const body = resp.text;
          followUps.push({
            company: app.company,
            job_title: app.job_title,
            days_ago: daysAgo,
            follow_up_email: body,
            subject: `Following up: ${app.job_title} application`,
          });
        } catch {
          followUps.push({
            company: app.company,
            job_title: app.job_title,
            days_ago: daysAgo,
            follow_up_email: "(draft generation failed)",
            subject: `Following up: ${app.job_title} application`,
          });
        }
      }

      return JSON.stringify({
        follow_ups: followUps,
        count: followUps.length,
        message: `Found ${followUps.length} applications awaiting response. Follow-up drafts generated.`,
      });
    }

    case "generate_apply_pack": {
      const { job_title, company, job_url, job_description, resume_summary, resume_skills } =
        toolInput as {
          job_title: string;
          company: string;
          job_url?: string;
          job_description: string;
          resume_summary: string;
          resume_skills?: string[];
        };

      const skills = resume_skills || (resumeData as { skills?: string[] })?.skills || [];
      const summary = resume_summary || (resumeData as { summary?: string })?.summary || "";

      try {
        // Generate all apply pack materials in one Claude call for speed
        const resp = await anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 3000,
          messages: [
            {
              role: "user",
              content: `Generate a complete job application package. Return ONLY valid JSON.

Job: ${job_title} at ${company}
Job Description: ${job_description}

Candidate Resume Summary: ${summary}
Candidate Skills: ${skills.join(", ")}

Return this exact JSON structure:
{
  "cover_letter": "A professional cover letter under 250 words. Be specific about why this candidate fits THIS role. No generic filler.",
  "resume_bullets": "5-7 tailored resume bullet points that match this specific job description. Each bullet should start with a strong action verb and include metrics where possible.",
  "why_good_fit": "A 2-3 sentence paragraph explaining why this candidate is a strong fit for this role. Be specific and reference both the JD and resume.",
  "common_answers": {
    "why_this_company": "Answer to 'Why do you want to work at ${company}?' (2-3 sentences)",
    "why_this_role": "Answer to 'Why are you interested in this role?' (2-3 sentences)",
    "greatest_strength": "Answer to 'What is your greatest strength?' tailored to this role (2-3 sentences)",
    "salary_expectations": "A diplomatic answer about salary expectations based on the role level"
  },
  "outreach_email": "A short cold email (under 100 words) to a hiring manager or recruiter at ${company} about this role. Be genuine, include a clear ask."
}

Return ONLY the JSON, no markdown fences.`,
            },
          ],
        });

        const rawText = resp.content[0].type === "text" ? resp.content[0].text : "{}";
        let pack;
        try {
          // Strip markdown fences if Claude adds them
          const cleaned = rawText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          pack = JSON.parse(cleaned);
        } catch {
          return JSON.stringify({ error: "Failed to generate apply pack — AI returned invalid JSON", raw: rawText.slice(0, 200) });
        }

        // Save to DB if authenticated
        if (userId !== "anonymous") {
          // First record the application
          const { data: appData } = await supabase
            .from("applications")
            .insert({
              user_id: userId,
              job_title,
              company,
              job_url: job_url || null,
              cover_letter: pack.cover_letter || null,
              status: "ready",
              notes: `Apply pack generated. Source: agent`,
            })
            .select("id")
            .single();

          // Then save the full apply pack
          await supabase.from("apply_packs").insert({
            user_id: userId,
            application_id: appData?.id || null,
            job_title,
            company,
            job_url: job_url || null,
            cover_letter: pack.cover_letter,
            resume_bullets: pack.resume_bullets,
            why_good_fit: pack.why_good_fit,
            common_answers: pack.common_answers,
            outreach_email: pack.outreach_email,
            source: "agent",
          });
        }

        return JSON.stringify({
          success: true,
          apply_url: job_url || `https://www.google.com/search?q=${encodeURIComponent(`${company} ${job_title} careers apply`)}`,
          pack: {
            cover_letter: pack.cover_letter,
            resume_bullets: pack.resume_bullets,
            why_good_fit: pack.why_good_fit,
            common_answers: pack.common_answers,
            outreach_email: pack.outreach_email,
          },
          message: `Apply pack ready for ${job_title} at ${company}. Open the apply link and use these materials to fill out the application.`,
        });
      } catch (err) {
        return JSON.stringify({ error: "Failed to generate apply pack", detail: String(err) });
      }
    }

    // ─── Fully Autonomous Auto-Apply ──────────────────────────────────────────

    case "auto_apply_to_jobs": {
      const title = toolInput.title as string;
      const location = (toolInput.location as string) || "remote";
      const keywords = (toolInput.keywords as string[]) || [];
      const maxApps = Math.min((toolInput.max_applications as number) || 5, 10);
      const minScore = (toolInput.min_match_score as number) || 60;
      const mode = (toolInput.mode as string) || "review";

      const resumeSummary = (resumeData as { summary?: string })?.summary || "Experienced professional";
      const skills = (resumeData as { skills?: string[] })?.skills || [];

      const result: {
        jobs_found: number;
        jobs_queued: number;
        jobs: { company: string; title: string; url: string; score: number; status: string }[];
        errors: string[];
        mode: string;
      } = {
        jobs_found: 0,
        jobs_queued: 0,
        jobs: [],
        errors: [],
        mode,
      };

      try {
        // Step 1: Search across all sources
        const allJobs = await searchMultipleSources(title, location, keywords);
        result.jobs_found = allJobs.length;

        if (allJobs.length === 0) {
          return JSON.stringify({
            ...result,
            message: `No jobs found for "${title}". Try broader search terms.`,
          });
        }

        // Step 2: Score against resume
        const scored = await scoreJobs(
          allJobs,
          resumeData as { summary?: string; skills?: string[] },
          minScore
        );

        if (scored.length === 0) {
          return JSON.stringify({
            ...result,
            message: `Found ${result.jobs_found} jobs but none scored above ${minScore}. Try lowering the minimum score.`,
          });
        }

        const toApply = scored.slice(0, maxApps);

        // Step 3: For each job — generate apply pack → save to DB → queue for extension
        for (const job of toApply) {
          // Check for duplicates
          if (userId !== "anonymous") {
            const { data: existing } = await supabase
              .from("applications")
              .select("id")
              .eq("user_id", userId)
              .ilike("company", `%${job.company}%`)
              .ilike("job_title", `%${job.title}%`)
              .limit(1);

            if (existing && existing.length > 0) {
              result.jobs.push({ company: job.company, title: job.title, url: job.url, score: job.match_score, status: "skipped_duplicate" });
              continue;
            }
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
Job Description: ${job.description}
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
            if (userId !== "anonymous") {
              const { data: appData } = await supabase
                .from("applications")
                .insert({
                  user_id: userId,
                  job_title: job.title,
                  company: job.company,
                  job_url: job.url,
                  cover_letter: pack.cover_letter || null,
                  status: "queued",
                  notes: `Auto-apply queued (${mode} mode). Score: ${job.match_score}.`,
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
                source: "auto_apply",
              });
            }

            // Queue job for the extension to auto-navigate + fill
            // The extension will receive this via SSE and process it
            const sessionIdForEvents = userId.startsWith("anon_") ? userId.slice(5) : (sessionId || userId);

            extensionEvents.publish(sessionIdForEvents, {
              type: "auto_apply",
              data: {
                action: "navigate_and_fill",
                mode, // "review" or "auto"
                job: {
                  company: job.company,
                  title: job.title,
                  url: job.url,
                  score: job.match_score,
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

            result.jobs.push({
              company: job.company,
              title: job.title,
              url: job.url,
              score: job.match_score,
              status: "queued",
            });
            result.jobs_queued++;
          } catch (err) {
            result.errors.push(`${job.company}: ${String(err).slice(0, 100)}`);
            result.jobs.push({ company: job.company, title: job.title, url: job.url, score: job.match_score, status: "error" });
          }
        }

        // Log
        if (userId !== "anonymous") {
          await supabase.from("agent_logs").insert({
            user_id: userId,
            command: `auto_apply_to_jobs: ${title}`,
            action: `Queued ${result.jobs_queued} jobs for auto-apply (${mode} mode)`,
            result: { summary: result },
          });
        }

        const modeDesc = mode === "auto"
          ? "The extension will automatically navigate to each job, fill the form, upload your resume, and submit."
          : "The extension will navigate to each job, fill the form, and upload your resume. You'll review and click submit for each one.";

        return JSON.stringify({
          ...result,
          message: `Auto-apply pipeline started! Found ${result.jobs_found} jobs, ${result.jobs_queued} queued for ${mode} mode. ${modeDesc}`,
        });
      } catch (err) {
        return JSON.stringify({
          ...result,
          error: "Auto-apply pipeline failed",
          detail: String(err),
        });
      }
    }

    // ─── Orchestration tools ─────────────────────────────────────────────────

    case "orchestrate_application": {
      const { job_title, company, job_url, job_description } = toolInput as {
        job_title: string;
        company: string;
        job_url: string;
        job_description: string;
      };

      try {
        const plan = createApplicationPlan(job_title, company, job_url, job_description);
        const result = await orchestrateApplication(
          plan,
          resumeData || {},
          undefined
        );

        const docResult = result.plan.steps.find((s) => s.agent === "document_manager")?.result;
        const formResult = result.plan.steps.find((s) => s.agent === "form_filler")?.result;
        const matchResult = result.plan.steps.find((s) => s.agent === "job_matcher")?.result;
        const matchScore = matchResult?.data?.score || matchResult?.data?.match_score || 0;

        // Save the apply pack to DB
        let applyPackId: string | undefined;
        if (result.plan.steps.every((s) => s.status !== "error")) {
          const { data: packData } = await supabase.from("apply_packs").insert({
            user_id: userId,
            job_title,
            company,
            job_url,
            cover_letter: docResult?.data?.cover_letter || "",
            resume_bullets: JSON.stringify(docResult?.data?.resume_bullets || []),
            why_good_fit: matchResult?.data?.reason || matchResult?.data?.justification || "",
            common_answers: formResult?.data || {},
            source: "orchestrator",
          }).select("id").single();
          applyPackId = packData?.id;
        }

        // Record application with "queued" status
        const { data: app } = await supabase.from("applications").insert({
          user_id: userId,
          job_title,
          company,
          job_url,
          status: "queued",
        }).select("id").single();

        // Persist plan in application_queue (survives restarts)
        const planId = `plan_${Date.now()}`;
        await supabase.from("application_queue").insert({
          id: planId,
          user_id: userId,
          application_id: app?.id,
          apply_pack_id: applyPackId,
          job_url,
          job_title,
          company,
          match_score: matchScore,
          status: "pending_review",
          form_snapshot: {
            plan_steps: result.plan.steps.map((s) => ({
              agent: s.agent,
              status: s.status,
              data: s.result?.data || {},
            })),
            form_fill_data: formResult?.data || {},
          },
        });

        // Cleanup: delete expired queue items (older than 7 days, failed/rejected)
        await supabase.from("application_queue")
          .delete()
          .eq("user_id", userId)
          .in("status", ["failed", "rejected"])
          .lt("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

        return JSON.stringify({
          plan_id: planId,
          application_id: app?.id,
          needs_confirmation: result.needsConfirmation,
          confirmation_message: result.confirmationMessage,
          steps: result.plan.steps.map((s) => ({
            agent: s.agent,
            action: s.action,
            status: s.status,
            summary: s.result?.message || "",
            data: s.result?.data || {},
          })),
          form_fill_data: formResult?.data,
          match_score: matchScore,
        });
      } catch (err) {
        return JSON.stringify({ error: "Orchestration failed", detail: String(err) });
      }
    }

    case "confirm_application": {
      const { plan_id } = toolInput as { plan_id: string; modifications?: string };

      // Read plan from application_queue (persistent DB storage)
      const { data: queueItem } = await supabase
        .from("application_queue")
        .select("*")
        .eq("id", plan_id)
        .eq("user_id", userId)
        .single();

      if (!queueItem) {
        return JSON.stringify({ error: "No pending plan found. The plan may have expired — run orchestrate_application again." });
      }

      try {
        // Update application status to "ready" (confirmed, awaiting form fill)
        if (queueItem.application_id) {
          await supabase.from("applications")
            .update({ status: "ready" })
            .eq("id", queueItem.application_id);
        }

        // Update queue status to "approved"
        await supabase.from("application_queue")
          .update({ status: "approved", reviewed_at: new Date().toISOString() })
          .eq("id", plan_id);

        const formFillData = queueItem.form_snapshot?.form_fill_data || {};

        // Push to extension via SSE for auto-fill
        extensionEvents.publish(sessionId || userId, {
          type: "form_fill",
          data: {
            queueId: plan_id,
            jobUrl: queueItem.job_url,
            company: queueItem.company,
            jobTitle: queueItem.job_title,
            formFillData: formFillData,
          },
        });

        return JSON.stringify({
          success: true,
          application_id: queueItem.application_id,
          message: `Application confirmed for ${queueItem.job_title} at ${queueItem.company}! The extension will auto-fill the form. Review and click submit when ready.`,
          apply_url: queueItem.job_url,
          form_fill_data: formFillData,
          pack: {
            company: queueItem.company,
            title: queueItem.job_title,
          },
        });
      } catch (err) {
        return JSON.stringify({ error: "Failed to confirm application", detail: String(err) });
      }
    }

    case "delegate_to_subagent": {
      const { agent, task, context } = toolInput as {
        agent: string;
        task: string;
        context?: Record<string, unknown>;
      };

      const enrichedContext = {
        ...context,
        resume: resumeData || context?.resume,
      };

      const result = await runSubAgent(agent, task, enrichedContext);
      return JSON.stringify(result);
    }

    case "scan_gmail": {
      try {
        // Call the gmail scan endpoint internally
        const sessionId = userId.startsWith("anon_") ? userId.slice(5) : "";
        const scanRes = await fetch(`${getBaseUrl()}/api/gmail/scan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
        const scanData = await scanRes.json();

        if (scanData.error) {
          return JSON.stringify({
            error: scanData.error,
            message: scanData.error.includes("not connected")
              ? "Gmail is not connected yet. Tell the user to go to the Dashboard and click 'Connect Gmail' first."
              : scanData.error,
          });
        }

        return JSON.stringify({
          total_emails_scanned: scanData.totalEmails,
          job_related: scanData.jobRelated,
          statuses_updated: scanData.statusesUpdated,
          emails: scanData.classified?.map((e: Record<string, unknown>) => ({
            company: e.company,
            classification: e.classification,
            subject: e.subject,
            action: e.action,
            summary: e.summary,
            date: e.date,
          })),
          message: scanData.jobRelated > 0
            ? `Found ${scanData.jobRelated} job-related emails. Updated ${scanData.statusesUpdated} application statuses.`
            : "No new job-related emails found in the last 30 days.",
        });
      } catch (err) {
        return JSON.stringify({ error: "Gmail scan failed: " + String(err) });
      }
    }

    // ─── Contact discovery ──────────────────────────────────────────────────
    case "find_contacts": {
      const { company, domain, roles } = toolInput as {
        company: string;
        domain?: string;
        roles?: string[];
      };

      try {
        const { discoverContacts } = await import("@/lib/contacts");
        const contacts = await discoverContacts(company, domain, roles);

        // Save to DB
        for (const contact of contacts) {
          if (!contact.email) continue;
          await supabase.from("company_contacts").upsert(
            {
              user_id: userId,
              company,
              company_domain: domain || null,
              person_name: contact.person_name,
              title: contact.title,
              email: contact.email,
              linkedin_url: contact.linkedin_url || null,
              source: contact.source,
              confidence: contact.confidence,
            },
            { onConflict: "user_id,company,email" }
          );
        }

        return JSON.stringify({
          contacts: contacts.slice(0, 15),
          total_found: contacts.length,
          message: contacts.length > 0
            ? `Found ${contacts.length} contacts at ${company}. ${contacts.filter(c => c.email).length} have email addresses. Use write_cold_email to reach out to them.`
            : `No contacts found for ${company}. Try providing the company domain directly.`,
        });
      } catch (err) {
        return JSON.stringify({ error: "Contact discovery failed: " + String(err) });
      }
    }

    // ─── Application queue management ──────────────────────────────────────
    case "review_queue": {
      const { action, queue_id, min_score } = toolInput as {
        action: string;
        queue_id?: string;
        min_score?: number;
      };

      try {
        if (action === "list") {
          const { data: items } = await supabase
            .from("application_queue")
            .select("id, job_title, company, match_score, status, fields_filled, fields_total, resume_uploaded, created_at, error_message")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(20);

          const summary = {
            pending_fill: 0,
            filled: 0,
            pending_review: 0,
            approved: 0,
            submitted: 0,
            failed: 0,
          };
          for (const item of items || []) {
            if (item.status in summary) summary[item.status as keyof typeof summary]++;
          }

          return JSON.stringify({
            items: items || [],
            summary,
            message: `Queue: ${summary.pending_review} ready for review, ${summary.pending_fill} pending fill, ${summary.approved} approved, ${summary.submitted} submitted, ${summary.failed} failed.`,
          });
        }

        if (action === "approve" && queue_id) {
          await supabase
            .from("application_queue")
            .update({ status: "approved", reviewed_at: new Date().toISOString() })
            .eq("id", queue_id)
            .eq("user_id", userId);

          // Get item details for SSE push
          const { data: item } = await supabase
            .from("application_queue")
            .select("*")
            .eq("id", queue_id)
            .single();

          if (item) {
            extensionEvents.publish(userId, {
              type: "submit_approved",
              data: {
                queueId: queue_id,
                jobUrl: item.job_url,
                company: item.company,
                jobTitle: item.job_title,
              },
            });
          }

          return JSON.stringify({ success: true, message: `Approved: ${item?.job_title} at ${item?.company}` });
        }

        if (action === "reject" && queue_id) {
          await supabase
            .from("application_queue")
            .update({ status: "rejected", reviewed_at: new Date().toISOString() })
            .eq("id", queue_id)
            .eq("user_id", userId);

          return JSON.stringify({ success: true, message: "Application rejected." });
        }

        if (action === "approve_all") {
          const threshold = min_score || 70;
          const { data: items } = await supabase
            .from("application_queue")
            .select("id, job_title, company, job_url, match_score")
            .eq("user_id", userId)
            .eq("status", "pending_review")
            .gte("match_score", threshold);

          if (!items || items.length === 0) {
            return JSON.stringify({ message: `No pending_review items with score >= ${threshold}.` });
          }

          const ids = items.map(i => i.id);
          await supabase
            .from("application_queue")
            .update({ status: "approved", reviewed_at: new Date().toISOString() })
            .in("id", ids)
            .eq("user_id", userId);

          // Push submit events for each
          for (const item of items) {
            extensionEvents.publish(userId, {
              type: "submit_approved",
              data: {
                queueId: item.id,
                jobUrl: item.job_url,
                company: item.company,
                jobTitle: item.job_title,
              },
            });
          }

          return JSON.stringify({
            success: true,
            approved: items.length,
            message: `Approved ${items.length} applications with score >= ${threshold}. The extension will submit them.`,
          });
        }

        return JSON.stringify({ error: "Invalid action. Use: list, approve, reject, approve_all" });
      } catch (err) {
        return JSON.stringify({ error: "Queue operation failed: " + String(err) });
      }
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
}

// ─── Main POST handler ──────────────────────────────────────────────────────

export async function POST(request: Request) {
  // Try auth; fall back to session-derived anonymous ID so DB persistence always works
  let userId = "";
  let isOAuthUser = false;
  try {
    const session = await getServerSession(authOptions);
    const uid = (session?.user as { id?: string })?.id;
    if (uid) {
      userId = uid;
      isOAuthUser = true;
    }
  } catch {
    // Auth may be misconfigured — continue with anonymous ID
  }

  const rawBody = await request.json();
  const validated = validateRequest(AgentCommandSchema, rawBody);
  if (!validated.success) return validated.error;
  const { command, resumeData, sessionId, chatHistory } = validated.data;

  // Rate limit: 20 requests/min per user
  const rlKey = userId || request.headers.get("x-forwarded-for") || "anonymous";
  const rl = rateLimit(`agent:${rlKey}`, 20, 60_000);
  if (!rl.success) return rateLimitResponse(rl.resetAt);

  const sid = sessionId || crypto.randomUUID();

  // If no OAuth user, derive a stable anonymous ID from the session so we can
  // still persist conversations, applications, and logs to the database.
  if (!userId) {
    userId = `anon_${sid}`;
  }

  // Daily usage cap: agent messages
  const usage = await checkAndIncrementUsage(userId, "agent_message");
  if (!usage.allowed) return usageLimitResponse("agent_message", usage.used, usage.limit);

  const supabase = getServiceClient();

  try {
    // Always load context from DB — works for both OAuth and anonymous users
    let ctx = {
      sessionMessages: [] as { role: string; content: string }[],
      sessionSummary: "",
      recentApplications: [] as { company: string; job_title: string; status: string }[],
      resumeFromDb: null as Record<string, unknown> | null,
    };

    ctx = await loadSessionContext(userId, sid);

    // Merge resume: prefer DB version → client-sent localStorage data → null
    const resume = (ctx.resumeFromDb || resumeData || null) as {
      summary?: string;
      skills?: string[];
      experience?: unknown[];
    } | null;

    // Build conversation history: prefer DB session messages, fall back to client localStorage
    const dbHistory = (ctx.sessionMessages || []).map((m: { role: string; content?: string; text?: string }) => ({
      role: m.role,
      text: m.text || m.content || "",
    }));
    const clientHistory: { role: string; text: string }[] =
      dbHistory.length > 0 ? dbHistory : (chatHistory || []);

    // Build context-aware system prompt with conversation memory
    const systemPrompt = buildSystemPrompt({
      resumeSummary: resume?.summary,
      skills: resume?.skills,
      recentApplications: ctx.recentApplications,
      sessionSummary: ctx.sessionSummary,
      chatHistory: clientHistory,
    });

    const userMessage = command;

    // Run agentic loop
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: userMessage },
    ];

    let response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      tools: AGENT_TOOLS,
      messages,
    });

    // Handle tool use loop (max 10 iterations)
    // Collect apply packs from tool results to send to frontend
    const collectedApplyPacks: unknown[] = [];
    let iterations = 0;
    while (response.stop_reason === "tool_use" && iterations < 10) {
      iterations++;

      const assistantContent = response.content;
      messages.push({ role: "assistant", content: assistantContent });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of assistantContent) {
        if (block.type === "tool_use") {
          const result = await handleToolCall(
            block.name,
            block.input as Record<string, unknown>,
            userId,
            resume,
            sid
          );

          // Extract apply packs from tool results
          try {
            const parsed = JSON.parse(result);
            if (parsed.apply_packs) {
              collectedApplyPacks.push(...parsed.apply_packs);
            }
            if (parsed.pack) {
              collectedApplyPacks.push({
                company: parsed.pack.company || (block.input as Record<string, unknown>).company,
                title: parsed.pack.title || (block.input as Record<string, unknown>).job_title,
                apply_url: parsed.apply_url || "",
                cover_letter: parsed.pack.cover_letter || "",
                resume_bullets: parsed.pack.resume_bullets || "",
                why_good_fit: parsed.pack.why_good_fit || "",
                outreach_email: parsed.pack.outreach_email || "",
                common_answers: parsed.pack.common_answers || {},
              });
            }
          } catch {
            // Not JSON or no apply packs — that's fine
          }

          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: result,
          });
        }
      }

      messages.push({ role: "user", content: toolResults });

      response = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        tools: AGENT_TOOLS,
        messages,
      });
    }

    // Extract final text response
    const textBlocks = response.content.filter((b) => b.type === "text");
    const agentResponse = textBlocks
      .map((b) => (b as Anthropic.TextBlock).text)
      .join("\n");

    // Always save session state + activity log to DB
    await Promise.all([
      saveSessionState(userId, sid, command, agentResponse),
      supabase.from("agent_logs").insert({
        user_id: userId,
        command,
        action: agentResponse.slice(0, 500),
        result: { iterations, stop_reason: response.stop_reason },
      }),
    ]);

    // Push apply packs to extension via SSE (drops silently if no subscriber)
    if (collectedApplyPacks.length > 0) {
      extensionEvents.publish(sid, {
        type: "apply_pack",
        data: { packs: collectedApplyPacks },
      });
    }

    return Response.json({
      response: agentResponse,
      sessionId: sid,
      userId,
      authenticated: isOAuthUser,
      applyPacks: collectedApplyPacks.length > 0 ? collectedApplyPacks : undefined,
    });
  } catch (err) {
    console.error("Agent error:", err);
    return new Response("Agent processing failed", { status: 500 });
  }
}
