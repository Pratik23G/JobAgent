import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { anthropic, AGENT_TOOLS, AGENT_SYSTEM_PROMPT } from "@/lib/claude";
import { getServiceClient } from "@/lib/db";
import { sendColdEmail } from "@/lib/resend";
import type Anthropic from "@anthropic-ai/sdk";

async function handleToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
  userId: string
): Promise<string> {
  const supabase = getServiceClient();

  switch (toolName) {
    case "search_jobs": {
      const title = toolInput.title as string;
      const location = (toolInput.location as string) || "";
      const keywords = (toolInput.keywords as string[]) || [];

      const appId = process.env.ADZUNA_APP_ID;
      const appKey = process.env.ADZUNA_API_KEY;

      if (!appId || !appKey) {
        return JSON.stringify({
          error: "Job search API not configured. Please set ADZUNA_APP_ID and ADZUNA_API_KEY.",
        });
      }

      const query = [title, ...keywords].join(" ");
      const where = location || "";
      const url = `https://api.adzuna.com/v1/api/jobs/us/search/1?app_id=${appId}&app_key=${appKey}&results_per_page=10&what=${encodeURIComponent(query)}&where=${encodeURIComponent(where)}&content-type=application/json`;

      try {
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
            description: (j.description || "").slice(0, 200),
            salary_min: j.salary_min,
            salary_max: j.salary_max,
          })
        );
        return JSON.stringify({ jobs, count: jobs.length });
      } catch (err) {
        return JSON.stringify({ error: "Failed to search jobs", detail: String(err) });
      }
    }

    case "write_cover_letter": {
      const { job_title, company, job_description, resume_summary } = toolInput as {
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
        return JSON.stringify({ error: "Failed to save application", detail: error.message });
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

      const body = resp.content[0].type === "text" ? resp.content[0].text : "";
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

        // Save to DB
        await supabase.from("recruiter_emails").insert({
          user_id: userId,
          recruiter_name: to_name || null,
          recruiter_email: to_email,
          subject,
          body,
          status: "sent",
        });

        return JSON.stringify({ success: true, message: `Email sent to ${to_email}` });
      } catch (err) {
        return JSON.stringify({ error: "Failed to send email", detail: String(err) });
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
        return JSON.stringify({ error: "Failed to fetch applications", detail: error.message });
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

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const userId = (session.user as { id?: string }).id;
  if (!userId) {
    return new Response("Missing user ID", { status: 400 });
  }

  const { command, resumeData } = await request.json();
  if (!command) {
    return new Response("Missing command", { status: 400 });
  }

  const supabase = getServiceClient();

  // Build user message with resume context if available
  let userMessage = command;
  if (resumeData) {
    userMessage = `[User's resume summary: ${resumeData.summary || JSON.stringify(resumeData)}]\n\nUser command: ${command}`;
  }

  try {
    // Run agentic loop
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: userMessage },
    ];

    let response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: AGENT_SYSTEM_PROMPT,
      tools: AGENT_TOOLS,
      messages,
    });

    // Handle tool use loop (max 10 iterations)
    let iterations = 0;
    while (response.stop_reason === "tool_use" && iterations < 10) {
      iterations++;

      const assistantContent = response.content;
      messages.push({ role: "assistant", content: assistantContent });

      // Process all tool calls
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of assistantContent) {
        if (block.type === "tool_use") {
          const result = await handleToolCall(
            block.name,
            block.input as Record<string, unknown>,
            userId
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
        system: AGENT_SYSTEM_PROMPT,
        tools: AGENT_TOOLS,
        messages,
      });
    }

    // Extract final text response
    const textBlocks = response.content.filter((b) => b.type === "text");
    const agentResponse = textBlocks.map((b) => (b as Anthropic.TextBlock).text).join("\n");

    // Log agent activity
    await supabase.from("agent_logs").insert({
      user_id: userId,
      command,
      action: agentResponse.slice(0, 500),
      result: { iterations, stop_reason: response.stop_reason },
    });

    return Response.json({ response: agentResponse });
  } catch (err) {
    console.error("Agent error:", err);
    return new Response("Agent processing failed", { status: 500 });
  }
}

