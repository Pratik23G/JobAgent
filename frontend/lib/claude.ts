import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

export const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: "search_jobs",
    description:
      "Search for job listings matching a title, location, and keywords",
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
      "Submit a job application (saves to DB, triggers form fill or email apply)",
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

export const AGENT_SYSTEM_PROMPT = `You are JobAgent, an AI assistant that helps users find and apply for jobs.
You have access to the user's resume data.
When a user gives you a voice command, you interpret it and use your tools to take real actions.
Always confirm what you're about to do before doing it, and report back clearly.
Be concise, efficient, and encouraging. The user wants results, not lengthy explanations.`;

export { client as anthropic };
