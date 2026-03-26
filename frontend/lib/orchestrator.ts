import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

// ─── Sub-agent definitions ──────────────────────────────────────────────────

export interface SubAgentResult {
  agent: string;
  status: "success" | "error" | "needs_confirmation";
  data: Record<string, unknown>;
  message: string;
}

interface SubAgentConfig {
  name: string;
  systemPrompt: string;
  tools: Anthropic.Tool[];
  maxTokens: number;
}

// ─── Resume Parser Sub-Agent ────────────────────────────────────────────────

const resumeParserAgent: SubAgentConfig = {
  name: "resume_parser",
  systemPrompt: `You are the Resume Parser sub-agent. Your job is to extract structured data from resume text.

Extract:
- Full name
- Email, phone, LinkedIn URL, website/portfolio
- Professional summary (2-3 sentences)
- Skills (categorized: technical, soft, tools/frameworks)
- Work experience (company, title, dates, bullet points)
- Education (school, degree, dates)
- Certifications
- Location / willingness to relocate

Return ONLY valid JSON. No explanations.`,
  tools: [],
  maxTokens: 2048,
};

// ─── Job Matcher Sub-Agent ──────────────────────────────────────────────────

const jobMatcherAgent: SubAgentConfig = {
  name: "job_matcher",
  systemPrompt: `You are the Job Matcher sub-agent. Your job is to analyze job listings against a candidate's resume and produce detailed match assessments.

For each job:
1. Score 0-100 based on skills overlap, experience level, and role fit
2. List matching skills and missing skills
3. Identify deal-breakers (e.g., requires 10 years but candidate has 2)
4. Write a 1-2 sentence justification
5. Suggest which resume bullets to emphasize for this specific role

Return ONLY valid JSON array. Be brutally honest — a 50 is average, 80+ is strong.`,
  tools: [],
  maxTokens: 4096,
};

// ─── Form Filler Sub-Agent ──────────────────────────────────────────────────

const formFillerAgent: SubAgentConfig = {
  name: "form_filler",
  systemPrompt: `You are the Form Filler sub-agent. Your job is to map candidate data to application form fields.

Given:
- Candidate profile (parsed resume JSON)
- Apply pack (cover letter, Q&A answers, resume bullets)
- Form field list from the ATS (field names, types, required/optional)

Produce a field mapping:
- Map each form field to the best candidate data
- For open-ended questions, generate tailored answers using the apply pack
- For "Why this company?" or "Why this role?" questions, use the apply pack's why_good_fit
- Flag any required fields that cannot be filled (needs human input)

Return ONLY valid JSON with field mappings and any fields needing human input.`,
  tools: [],
  maxTokens: 2048,
};

// ─── Document Manager Sub-Agent ─────────────────────────────────────────────

const documentManagerAgent: SubAgentConfig = {
  name: "document_manager",
  systemPrompt: `You are the Document Manager sub-agent. Your job is to select and prepare documents for job applications.

Given a job description and available documents (resume, cover letters, etc.):
1. Select the most relevant resume version (or suggest edits to the base resume)
2. Tailor the cover letter opening and closing for this specific company
3. Prepare any additional documents mentioned in the job posting
4. Return a document checklist with status (ready / needs_edit / missing)

Return ONLY valid JSON.`,
  tools: [],
  maxTokens: 2048,
};

// ─── Sub-agent registry ─────────────────────────────────────────────────────

const SUB_AGENTS: Record<string, SubAgentConfig> = {
  resume_parser: resumeParserAgent,
  job_matcher: jobMatcherAgent,
  form_filler: formFillerAgent,
  document_manager: documentManagerAgent,
};

// ─── Execute a sub-agent ────────────────────────────────────────────────────

export async function runSubAgent(
  agentName: string,
  userMessage: string,
  context?: Record<string, unknown>
): Promise<SubAgentResult> {
  const config = SUB_AGENTS[agentName];
  if (!config) {
    return {
      agent: agentName,
      status: "error",
      data: {},
      message: `Unknown sub-agent: ${agentName}`,
    };
  }

  // Build context-enriched prompt
  const contextStr = context
    ? `\n\nContext:\n${JSON.stringify(context, null, 2)}`
    : "";

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: config.maxTokens,
      system: config.systemPrompt,
      tools: config.tools.length > 0 ? config.tools : undefined,
      messages: [
        { role: "user", content: userMessage + contextStr },
      ],
    });

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as Anthropic.TextBlock).text)
      .join("\n");

    // Try to parse as JSON
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw_response: text };
    }

    return {
      agent: agentName,
      status: "success",
      data,
      message: `${config.name} completed successfully`,
    };
  } catch (err) {
    return {
      agent: agentName,
      status: "error",
      data: { error: String(err) },
      message: `${config.name} failed: ${String(err)}`,
    };
  }
}

// ─── Orchestrate a full application flow ────────────────────────────────────

export interface ApplicationPlan {
  jobTitle: string;
  company: string;
  jobUrl: string;
  jobDescription: string;
  steps: ApplicationStep[];
}

export interface ApplicationStep {
  id: string;
  agent: string;
  action: string;
  status: "pending" | "running" | "done" | "needs_confirmation" | "error";
  result?: SubAgentResult;
}

export async function orchestrateApplication(
  plan: ApplicationPlan,
  resumeData: Record<string, unknown>,
  applyPack?: Record<string, unknown>
): Promise<{
  plan: ApplicationPlan;
  needsConfirmation: boolean;
  confirmationMessage: string;
}> {
  // Step 1: Parse/validate resume if needed
  const parseStep = plan.steps.find((s) => s.agent === "resume_parser");
  if (parseStep && parseStep.status === "pending") {
    parseStep.status = "running";
    parseStep.result = await runSubAgent("resume_parser", "Parse this resume data and extract structured fields.", {
      resume: resumeData,
    });
    parseStep.status = parseStep.result.status === "success" ? "done" : "error";
  }

  const parsedResume = parseStep?.result?.data || resumeData;

  // Step 2: Match job
  const matchStep = plan.steps.find((s) => s.agent === "job_matcher");
  if (matchStep && matchStep.status === "pending") {
    matchStep.status = "running";
    matchStep.result = await runSubAgent("job_matcher", `Score this job against the candidate:\n\nJob: ${plan.jobTitle} at ${plan.company}\nDescription: ${plan.jobDescription}`, {
      candidate: parsedResume,
    });
    matchStep.status = matchStep.result.status === "success" ? "done" : "error";
  }

  // Step 3: Prepare documents
  const docStep = plan.steps.find((s) => s.agent === "document_manager");
  if (docStep && docStep.status === "pending") {
    docStep.status = "running";
    docStep.result = await runSubAgent("document_manager", `Prepare documents for: ${plan.jobTitle} at ${plan.company}\n\nJob description: ${plan.jobDescription}`, {
      candidate: parsedResume,
      applyPack,
    });
    docStep.status = docStep.result.status === "success" ? "done" : "error";
  }

  // Step 4: Map form fields (needs confirmation before submit)
  const formStep = plan.steps.find((s) => s.agent === "form_filler");
  if (formStep && formStep.status === "pending") {
    formStep.status = "running";
    formStep.result = await runSubAgent("form_filler", `Map candidate data to application form for: ${plan.jobTitle} at ${plan.company}`, {
      candidate: parsedResume,
      applyPack,
      jobDescription: plan.jobDescription,
    });
    formStep.status = "needs_confirmation";
  }

  // Check if any step needs human confirmation
  const needsConfirmation = plan.steps.some((s) => s.status === "needs_confirmation");
  const errors = plan.steps.filter((s) => s.status === "error");

  let confirmationMessage = "";
  if (errors.length > 0) {
    confirmationMessage = `${errors.length} step(s) failed. Review errors before proceeding.`;
  } else if (needsConfirmation) {
    const matchScore = matchStep?.result?.data?.match_score || matchStep?.result?.data?.score || "N/A";
    confirmationMessage = `Application ready for ${plan.jobTitle} at ${plan.company} (match: ${matchScore}/100). Documents prepared, form fields mapped. Review and confirm to submit.`;
  } else {
    confirmationMessage = `All steps completed for ${plan.jobTitle} at ${plan.company}.`;
  }

  return { plan, needsConfirmation, confirmationMessage };
}

// ─── Create a standard application plan ─────────────────────────────────────

export function createApplicationPlan(
  jobTitle: string,
  company: string,
  jobUrl: string,
  jobDescription: string
): ApplicationPlan {
  return {
    jobTitle,
    company,
    jobUrl,
    jobDescription,
    steps: [
      { id: "parse", agent: "resume_parser", action: "Parse and validate resume", status: "pending" },
      { id: "match", agent: "job_matcher", action: "Score job match", status: "pending" },
      { id: "docs", agent: "document_manager", action: "Prepare documents", status: "pending" },
      { id: "form", agent: "form_filler", action: "Map form fields", status: "pending" },
    ],
  };
}
