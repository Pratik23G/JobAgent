import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

export const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: "search_jobs",
    description:
      "Search for job listings matching a title, location, and keywords. Returns results scored against the user's resume for fit.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "Job title to search for" },
        location: { type: "string", description: "City or 'remote'" },
        keywords: {
          type: "array",
          items: { type: "string" },
          description: "Additional keywords",
        },
        min_match_score: {
          type: "number",
          description:
            "Minimum resume match score 0-100 to include (default: 0). Set higher to only show strong fits.",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "write_cover_letter",
    description:
      "Write a custom cover letter for a specific job using the user's resume",
    input_schema: {
      type: "object" as const,
      properties: {
        job_title: { type: "string" },
        company: { type: "string" },
        job_description: { type: "string" },
        resume_summary: { type: "string" },
      },
      required: ["job_title", "company", "job_description", "resume_summary"],
    },
  },
  {
    name: "apply_to_job",
    description:
      "Submit a job application (saves to DB). Check existing applications first to avoid duplicates.",
    input_schema: {
      type: "object" as const,
      properties: {
        job_title: { type: "string" },
        company: { type: "string" },
        job_url: { type: "string" },
        cover_letter: { type: "string" },
      },
      required: ["job_title", "company", "job_url"],
    },
  },
  {
    name: "write_cold_email",
    description:
      "Write a personalized cold email to a recruiter at a target company",
    input_schema: {
      type: "object" as const,
      properties: {
        recruiter_name: { type: "string" },
        company: { type: "string" },
        role_interest: { type: "string" },
        resume_summary: { type: "string" },
      },
      required: ["recruiter_name", "company", "role_interest"],
    },
  },
  {
    name: "send_email",
    description: "Send an email to a recruiter via Resend",
    input_schema: {
      type: "object" as const,
      properties: {
        to_email: { type: "string" },
        to_name: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
      },
      required: ["to_email", "subject", "body"],
    },
  },
  {
    name: "get_application_status",
    description:
      "Check the status of all job applications or a specific one",
    input_schema: {
      type: "object" as const,
      properties: {
        company: {
          type: "string",
          description: "Filter by company name (optional)",
        },
      },
    },
  },
  {
    name: "search_jobs_multi",
    description:
      "Search multiple job sources (Adzuna + Remotive for remote roles) in parallel. Returns deduplicated results scored against the user's resume. Use this instead of search_jobs for broader coverage.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "Job title to search for" },
        location: {
          type: "string",
          description: "City name or 'remote'. When 'remote', also searches Remotive API.",
        },
        keywords: {
          type: "array",
          items: { type: "string" },
          description: "Additional keywords to refine search",
        },
        min_match_score: {
          type: "number",
          description: "Minimum resume match score 0-100 (default: 0)",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "auto_apply_pipeline",
    description:
      "Automated apply pipeline: searches jobs across sources, scores against resume, generates cover letters, records applications, and optionally drafts outreach emails. Returns a summary of all actions taken. Use when the user says things like 'apply to jobs for me', 'auto apply', or 'find and apply to jobs'.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "Target job title" },
        location: { type: "string", description: "City or 'remote'" },
        keywords: {
          type: "array",
          items: { type: "string" },
          description: "Additional keywords",
        },
        max_applications: {
          type: "number",
          description: "Max number of jobs to apply to (default: 5, max: 10)",
        },
        min_match_score: {
          type: "number",
          description: "Minimum resume match score to auto-apply (default: 60)",
        },
        send_outreach_emails: {
          type: "boolean",
          description: "Also draft cold outreach emails to recruiters at each company (default: false)",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "follow_up_applications",
    description:
      "Check applications that were submitted more than N days ago with no status update, and draft follow-up emails for them.",
    input_schema: {
      type: "object" as const,
      properties: {
        days_since_applied: {
          type: "number",
          description: "Only follow up on apps older than this many days (default: 5)",
        },
      },
    },
  },
  {
    name: "generate_apply_pack",
    description:
      "Generate a complete apply package for a specific job: tailored cover letter, resume bullet points matched to the job description, 'why I'm a good fit' paragraph, answers to common application questions, and a cold outreach email draft. Use this when the user wants to apply to a specific job and needs materials prepared.",
    input_schema: {
      type: "object" as const,
      properties: {
        job_title: { type: "string", description: "Job title" },
        company: { type: "string", description: "Company name" },
        job_url: { type: "string", description: "Direct apply URL" },
        job_description: { type: "string", description: "Job description text" },
        resume_summary: { type: "string", description: "User's resume summary" },
        resume_skills: {
          type: "array",
          items: { type: "string" },
          description: "User's skills from resume",
        },
      },
      required: ["job_title", "company", "job_description", "resume_summary"],
    },
  },
  // ─── Orchestration tools (Mother Agent → Sub-Agents) ──────────────────────
  {
    name: "orchestrate_application",
    description:
      "Launch the full application orchestration pipeline for a specific job. Sub-agents will: parse resume, score match, prepare documents, and map form fields. Returns a plan that needs human confirmation before final submit. Use this when the user wants to apply to a specific job with full automation.",
    input_schema: {
      type: "object" as const,
      properties: {
        job_title: { type: "string", description: "Job title" },
        company: { type: "string", description: "Company name" },
        job_url: { type: "string", description: "Direct apply URL" },
        job_description: { type: "string", description: "Job description text" },
      },
      required: ["job_title", "company", "job_url", "job_description"],
    },
  },
  {
    name: "confirm_application",
    description:
      "User has reviewed and confirmed the application plan. Proceed with recording the application and sending data to the browser extension for form filling. Only call this AFTER orchestrate_application and the user has confirmed.",
    input_schema: {
      type: "object" as const,
      properties: {
        plan_id: { type: "string", description: "The session-based plan ID to confirm" },
        modifications: {
          type: "string",
          description: "Any modifications the user requested before confirming (optional)",
        },
      },
      required: ["plan_id"],
    },
  },
  {
    name: "delegate_to_subagent",
    description:
      "Delegate a specific task to a specialized sub-agent. Available agents: resume_parser (extract structured data from resume), job_matcher (score and rank jobs against resume), form_filler (map candidate data to form fields), document_manager (select and prepare documents). Use this for one-off sub-agent tasks outside the full orchestration pipeline.",
    input_schema: {
      type: "object" as const,
      properties: {
        agent: {
          type: "string",
          enum: ["resume_parser", "job_matcher", "form_filler", "document_manager"],
          description: "Which sub-agent to delegate to",
        },
        task: { type: "string", description: "What to ask the sub-agent to do" },
        context: {
          type: "object",
          description: "Additional context to pass to the sub-agent (resume data, job info, etc.)",
        },
      },
      required: ["agent", "task"],
    },
  },
  {
    name: "auto_apply_to_jobs",
    description:
      "FULLY AUTONOMOUS job application agent. Searches jobs, scores against resume, generates apply packs, then sends each job to the browser extension which automatically navigates to the apply page, fills the form, uploads resume, and optionally submits. The user can choose 'review' mode (extension fills but waits for user to click submit) or 'auto' mode (extension fills and submits automatically). Use when the user says 'automatically apply to jobs', 'apply without me doing anything', 'hands-free apply', etc.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "Target job title" },
        location: { type: "string", description: "City or 'remote'" },
        keywords: {
          type: "array",
          items: { type: "string" },
          description: "Additional keywords",
        },
        max_applications: {
          type: "number",
          description: "Max number of jobs to apply to (default: 5, max: 10)",
        },
        min_match_score: {
          type: "number",
          description: "Minimum resume match score to auto-apply (default: 60)",
        },
        mode: {
          type: "string",
          enum: ["review", "auto"],
          description: "review = fill forms but wait for user to submit (default). auto = fill and submit automatically.",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "scan_gmail",
    description:
      "Scan the user's Gmail inbox for job-related emails (application confirmations, interview invitations, rejections, offers). Classifies each email and auto-updates application statuses. Use when the user says 'check my email', 'any replies?', 'scan my inbox', etc. Requires Gmail to be connected first.",
    input_schema: {
      type: "object" as const,
      properties: {},
    },
  },
];

export function buildSystemPrompt(context: {
  resumeSummary?: string;
  skills?: string[];
  recentApplications?: { company: string; job_title: string; status: string }[];
  sessionSummary?: string;
  chatHistory?: { role: string; text: string }[];
}) {
  const parts = [
    `You are JobAgent, an AI assistant that helps users find and apply for jobs.
You interpret voice and text commands and use your tools to take real actions.
Be concise, efficient, and encouraging. The user wants results, not lengthy explanations.
You remember all previous conversations in this session.`,
  ];

  if (context.resumeSummary) {
    parts.push(`
## User's Resume
Summary: ${context.resumeSummary}
${context.skills?.length ? `Key Skills: ${context.skills.join(", ")}` : ""}`);
  }

  if (context.recentApplications?.length) {
    const appList = context.recentApplications
      .slice(0, 15)
      .map((a) => `- ${a.company} — ${a.job_title} (${a.status})`)
      .join("\n");
    parts.push(`
## Previous Applications (avoid duplicates)
${appList}`);
  }

  // Inject conversation history for memory
  const history = context.chatHistory || [];
  if (history.length > 0) {
    const formatted = history
      .slice(-20) // last 10 exchanges
      .map((m) => `${m.role === "user" ? "User" : "Agent"}: ${m.text}`)
      .join("\n");
    parts.push(`
## Conversation History (remember this context)
${formatted}`);
  } else if (context.sessionSummary) {
    parts.push(`
## Earlier in this session
${context.sessionSummary}`);
  }

  parts.push(`
## Guidelines
- When searching jobs, prefer search_jobs_multi over search_jobs for broader coverage across sources.
- When the user wants to auto-apply or says "apply to jobs for me", use auto_apply_pipeline for prepare-only mode.
- When the user wants FULLY AUTONOMOUS hands-free applying (extension auto-fills + submits), use auto_apply_to_jobs. This sends jobs directly to the extension for navigation, form fill, and submission.
- auto_apply_to_jobs has two modes: "review" (fills forms, user clicks submit) and "auto" (fills and auto-submits). Default to "review" for safety.
- Score results against the resume and highlight match quality.
- Before applying to a single job, check if the user already applied to that company/role.
- When presenting job results, show match score, source, and why it's a good/bad fit.
- Always confirm before taking irreversible actions (applying, sending emails) unless the user explicitly asked for auto-apply.
- For auto-apply, present a summary of what was done: how many jobs found, how many applied to, which companies.
- Present each applied job with its direct apply URL so the user can complete any manual steps.
- When a user hasn't heard back on applications, suggest using follow_up_applications.
- You have memory of prior messages. If the user references something from earlier (like "those jobs" or "the first one"), look at the conversation history to understand what they mean.
- IMPORTANT: After showing job search results, ALWAYS ask the user if they want you to generate apply packs. Say something like "Want me to generate apply packs for any of these? Just say 'apply to the top 3' or 'prepare apply pack for [company name]'."
- When the user says "find jobs" or "search jobs", search first, show results, then IMMEDIATELY call generate_apply_pack for the top 3 results automatically. The user wants to apply, not just browse.
- When generating apply packs, always use generate_apply_pack (for single jobs) or auto_apply_pipeline (for batch). These create the rich apply pack cards the user can interact with.

## Agent Orchestration
You are the MOTHER AGENT. You coordinate specialized sub-agents to automate the job application process end-to-end.

Sub-agents available:
- **resume_parser**: Extracts structured data from resumes (skills, experience, education)
- **job_matcher**: Scores jobs against candidate profile with detailed justification
- **form_filler**: Maps candidate data to ATS form fields for auto-fill
- **document_manager**: Selects and prepares documents (resume, cover letter) per job

Orchestration rules:
1. When user wants to apply to a specific job, use orchestrate_application — it runs all sub-agents in sequence
2. ALWAYS pause for human confirmation before final submission (confirm_application)
3. Show the user what will be filled and any fields needing manual input
4. For one-off tasks (e.g., "parse my resume"), use delegate_to_subagent directly
5. The extension will receive form-fill data via the apply pack — tell the user to click "Auto-Fill" in the extension after confirming`);

  return parts.join("\n");
}

// Keep the old export for backward compat, but prefer buildSystemPrompt
export const AGENT_SYSTEM_PROMPT = buildSystemPrompt({});

export { client as anthropic };
