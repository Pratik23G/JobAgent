import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { anthropic, AGENT_TOOLS, buildSystemPrompt } from "@/lib/claude";
import { getServiceClient } from "@/lib/db";
import { sendColdEmail } from "@/lib/resend";
import type Anthropic from "@anthropic-ai/sdk";

// ─── Resume-aware job scoring ────────────────────────────────────────────────

async function scoreJobsAgainstResume(
  jobs: { title: string; company: string; description: string; [k: string]: unknown }[],
  resumeData: { summary?: string; skills?: string[]; experience?: unknown[] },
  minScore: number
) {
  if (!resumeData?.skills?.length || jobs.length === 0) return jobs;

  const resp = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: `Score how well each job matches this candidate's resume. Return ONLY a JSON array.

Resume skills: ${resumeData.skills.join(", ")}
Resume summary: ${resumeData.summary || "N/A"}

Jobs to score:
${jobs.map((j, i) => `${i}. ${j.title} at ${j.company}: ${j.description}`).join("\n")}

Return JSON array with one object per job:
[{"index": 0, "match_score": 85, "reason": "Strong fit because..."}]

Score 0-100. Be honest — 50 means average fit, 80+ means strong fit. Return ONLY valid JSON.`,
      },
    ],
  });

  const text = resp.content[0].type === "text" ? resp.content[0].text : "[]";
  try {
    const scores: { index: number; match_score: number; reason: string }[] =
      JSON.parse(text);
    const scoredJobs = jobs.map((job, i) => {
      const score = scores.find((s) => s.index === i);
      return {
        ...job,
        match_score: score?.match_score ?? 50,
        match_reason: score?.reason ?? "",
      };
    });

    return scoredJobs
      .filter((j) => j.match_score >= minScore)
      .sort((a, b) => b.match_score - a.match_score);
  } catch {
    // If scoring fails, return jobs unsorted
    return jobs.map((j) => ({ ...j, match_score: 0, match_reason: "" }));
  }
}

// ─── Session state helpers ───────────────────────────────────────────────────

async function loadSessionContext(userId: string, sessionId: string) {
  const supabase = getServiceClient();

  const [sessionRes, appsRes, resumeRes] = await Promise.all([
    // Load current session
    supabase
      .from("agent_sessions")
      .select("messages, summary")
      .eq("user_id", userId)
      .eq("session_id", sessionId)
      .single(),
    // Load recent applications
    supabase
      .from("applications")
      .select("company, job_title, status")
      .eq("user_id", userId)
      .order("applied_at", { ascending: false })
      .limit(20),
    // Load resume from DB
    supabase
      .from("resumes")
      .select("parsed_json")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single(),
  ]);

  return {
    sessionMessages: sessionRes.data?.messages || [],
    sessionSummary: sessionRes.data?.summary || "",
    recentApplications: appsRes.data || [],
    resumeFromDb: resumeRes.data?.parsed_json || null,
  };
}

async function saveSessionState(
  userId: string,
  sessionId: string,
  command: string,
  agentResponse: string
) {
  const supabase = getServiceClient();

  // Load existing session
  const { data: existing } = await supabase
    .from("agent_sessions")
    .select("id, messages")
    .eq("user_id", userId)
    .eq("session_id", sessionId)
    .single();

  const messages = existing?.messages || [];
  messages.push(
    { role: "user", text: command, at: new Date().toISOString() },
    { role: "agent", text: agentResponse.slice(0, 500), at: new Date().toISOString() }
  );

  // Keep only last 20 messages to avoid bloat
  const trimmed = messages.slice(-20);

  if (existing) {
    await supabase
      .from("agent_sessions")
      .update({ messages: trimmed, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
  } else {
    await supabase.from("agent_sessions").insert({
      user_id: userId,
      session_id: sessionId,
      messages: trimmed,
    });
  }
}

// ─── Tool handlers ───────────────────────────────────────────────────────────

async function handleToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
  userId: string,
  resumeData: Record<string, unknown> | null
): Promise<string> {
  const supabase = getServiceClient();

  switch (toolName) {
    case "search_jobs": {
      const title = toolInput.title as string;
      const location = (toolInput.location as string) || "";
      const keywords = (toolInput.keywords as string[]) || [];
      const minScore = (toolInput.min_match_score as number) || 0;

      const appId = process.env.ADZUNA_APP_ID;
      const appKey = process.env.ADZUNA_API_KEY;

      if (!appId || !appKey) {
        return JSON.stringify({
          error:
            "Job search API not configured. Please set ADZUNA_APP_ID and ADZUNA_API_KEY.",
        });
      }

      // Map common location aliases to Adzuna-friendly terms
      const locationMap: Record<string, string> = {
        "bay area": "San Francisco",
        "sf": "San Francisco",
        "nyc": "New York",
        "la": "Los Angeles",
        "dc": "Washington",
        "remote": "",
      };
      const mappedLocation =
        locationMap[location.toLowerCase()] ?? location;

      // Try search with full query first, fall back to broader search
      const queries = [
        [title, ...keywords].join(" "),
        title, // fallback: just the title
      ];

      let allJobs: {
        title: string;
        company: string;
        location: string;
        url: string;
        description: string;
        salary_min?: number;
        salary_max?: number;
      }[] = [];

      try {
        for (const query of queries) {
          const url = `https://api.adzuna.com/v1/api/jobs/us/search/1?app_id=${appId}&app_key=${appKey}&results_per_page=10&what=${encodeURIComponent(query)}&where=${encodeURIComponent(mappedLocation)}&content-type=application/json`;

          const res = await fetch(url);
          const data = await res.json();
          const jobs = (data.results || []).map(
            (j: {
              title: string;
              company?: { display_name?: string };
              location?: { display_name?: string };
              redirect_url?: string;
              description?: string;
              salary_min?: number;
              salary_max?: number;
            }) => ({
              title: j.title,
              company: j.company?.display_name || "Unknown",
              location: j.location?.display_name || "",
              url: j.redirect_url || "",
              description: (j.description || "").slice(0, 300),
              salary_min: j.salary_min,
              salary_max: j.salary_max,
            })
          );

          if (jobs.length > 0) {
            allJobs = jobs;
            break; // Use the first query that returns results
          }
        }

        if (allJobs.length === 0) {
          return JSON.stringify({
            jobs: [],
            count: 0,
            message: `No jobs found for "${title}" in "${location}". Try broader terms like "software engineer" or a major city name.`,
          });
        }

        // RAG: Score jobs against resume
        const scoredJobs = await scoreJobsAgainstResume(
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

      const resp = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: `Write a concise, professional cover letter for a ${job_title} position at ${company}.

Job description: ${job_description}

Candidate resume summary: ${resume_summary}

Write it in first person, keep it under 300 words. Be specific about why this candidate is a fit. No generic filler.`,
          },
        ],
      });

      const letter =
        resp.content[0].type === "text" ? resp.content[0].text : "";
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
          status: "applied",
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
      const { recruiter_name, company, role_interest, resume_summary } =
        toolInput as {
          recruiter_name: string;
          company: string;
          role_interest: string;
          resume_summary?: string;
        };

      const resp = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 512,
        messages: [
          {
            role: "user",
            content: `Write a short, personalized cold email to ${recruiter_name} at ${company} expressing interest in ${role_interest} roles.

${resume_summary ? `Candidate summary: ${resume_summary}` : ""}

Keep it under 150 words. Be genuine, not salesy. Include a clear ask (e.g., 15-minute chat). No subject line — just the body.`,
          },
        ],
      });

      const body =
        resp.content[0].type === "text" ? resp.content[0].text : "";
      return JSON.stringify({
        email_body: body,
        subject: `${role_interest} opportunity at ${company}`,
        to_name: recruiter_name,
      });
    }

    case "send_email": {
      const { to_email, to_name, subject, body } = toolInput as {
        to_email: string;
        to_name?: string;
        subject: string;
        body: string;
      };

      try {
        await sendColdEmail({
          to: to_email,
          toName: to_name,
          subject,
          body,
          fromName: "JobAgent User",
        });

        await supabase.from("recruiter_emails").insert({
          user_id: userId,
          recruiter_name: to_name || null,
          recruiter_email: to_email,
          subject,
          body,
          status: "sent",
        });

        return JSON.stringify({
          success: true,
          message: `Email sent to ${to_email}`,
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

    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
}

// ─── Main POST handler ──────────────────────────────────────────────────────

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const userId = (session.user as { id?: string }).id;
  if (!userId) {
    return new Response("Missing user ID", { status: 400 });
  }

  const { command, resumeData, sessionId } = await request.json();
  if (!command) {
    return new Response("Missing command", { status: 400 });
  }

  const sid = sessionId || crypto.randomUUID();
  const supabase = getServiceClient();

  try {
    // Load context: session history, applications, resume from DB
    const ctx = await loadSessionContext(userId, sid);

    // Merge resume: prefer DB version, fall back to client-sent data
    const resume = ctx.resumeFromDb || resumeData || null;

    // Build context-aware system prompt
    const systemPrompt = buildSystemPrompt({
      resumeSummary: resume?.summary,
      skills: resume?.skills,
      recentApplications: ctx.recentApplications,
      sessionSummary: ctx.sessionSummary,
    });

    const userMessage = command;

    // Run agentic loop
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: userMessage },
    ];

    let response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: systemPrompt,
      tools: AGENT_TOOLS,
      messages,
    });

    // Handle tool use loop (max 10 iterations)
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
            resume
          );
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: result,
          });
        }
      }

      messages.push({ role: "user", content: toolResults });

      response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
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

    // Save session state + activity log in parallel
    await Promise.all([
      saveSessionState(userId, sid, command, agentResponse),
      supabase.from("agent_logs").insert({
        user_id: userId,
        command,
        action: agentResponse.slice(0, 500),
        result: { iterations, stop_reason: response.stop_reason },
      }),
    ]);

    return Response.json({ response: agentResponse, sessionId: sid });
  } catch (err) {
    console.error("Agent error:", err);
    return new Response("Agent processing failed", { status: 500 });
  }
}
