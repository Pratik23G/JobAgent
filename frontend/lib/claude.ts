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
];

export function buildSystemPrompt(context: {
  resumeSummary?: string;
  skills?: string[];
  recentApplications?: { company: string; job_title: string; status: string }[];
  sessionSummary?: string;
}) {
  const parts = [
    `You are JobAgent, an AI assistant that helps users find and apply for jobs.
You interpret voice and text commands and use your tools to take real actions.
Be concise, efficient, and encouraging. The user wants results, not lengthy explanations.`,
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

  if (context.sessionSummary) {
    parts.push(`
## Earlier in this session
${context.sessionSummary}`);
  }

  parts.push(`
## Guidelines
- When searching jobs, score results against the resume and highlight match quality.
- Before applying, check if the user already applied to that company/role.
- When presenting job results, show match score and why it's a good/bad fit.
- Always confirm before taking irreversible actions (applying, sending emails).`);

  return parts.join("\n");
}

// Keep the old export for backward compat, but prefer buildSystemPrompt
export const AGENT_SYSTEM_PROMPT = buildSystemPrompt({});

export { client as anthropic };
