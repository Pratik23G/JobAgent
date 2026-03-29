import { complete } from "@/lib/models";

// ─── Resume-aware job scoring ────────────────────────────────────────────────

export interface ScoredJob {
  match_score: number;
  match_reason: string;
}

export type ResumeData = {
  summary?: string;
  skills?: string[];
  experience?: unknown[];
};

export async function scoreJobsAgainstResume<T extends { title: string; company: string; description: string }>(
  jobs: T[],
  resumeData: ResumeData,
  minScore: number
): Promise<(T & ScoredJob)[]> {
  if (!resumeData?.skills?.length || jobs.length === 0)
    return jobs.map((j) => ({ ...j, match_score: 0, match_reason: "" }));

  const resp = await complete(
    {
      system: "You are a job matching assistant. Return ONLY valid JSON arrays.",
      userMessage: `Score how well each job matches this candidate's resume. Return ONLY a JSON array.

Resume skills: ${resumeData.skills.join(", ")}
Resume summary: ${resumeData.summary || "N/A"}

Jobs to score:
${jobs.map((j, i) => `${i}. ${j.title} at ${j.company}: ${j.description}`).join("\n")}

Return JSON array with one object per job:
[{"index": 0, "match_score": 85, "reason": "Strong fit because..."}]

Score 0-100. Be honest — 50 means average fit, 80+ means strong fit. Return ONLY valid JSON.`,
    },
    "job_match"
  );

  try {
    const scores: { index: number; match_score: number; reason: string }[] =
      JSON.parse(resp.text);
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
    return jobs.map((j) => ({ ...j, match_score: 0, match_reason: "" }));
  }
}

// ─── Python RAG microservice integration ────────────────────────────────────

const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL || "http://localhost:5000";
let ragServiceAvailable: boolean | null = null;

async function checkRagService(): Promise<boolean> {
  if (ragServiceAvailable !== null) return ragServiceAvailable;
  try {
    const res = await fetch(`${RAG_SERVICE_URL}/health`, { signal: AbortSignal.timeout(2000) });
    ragServiceAvailable = res.ok;
  } catch {
    ragServiceAvailable = false;
  }
  setTimeout(() => { ragServiceAvailable = null; }, 60000);
  return ragServiceAvailable;
}

export async function scoreJobsWithRagService<T extends { title: string; company: string; description: string }>(
  jobs: T[],
  resumeText: string,
  minScore: number
): Promise<(T & ScoredJob)[] | null> {
  try {
    const isAvailable = await checkRagService();
    if (!isAvailable) return null;

    const scored = await Promise.all(
      jobs.map(async (job) => {
        try {
          const res = await fetch(`${RAG_SERVICE_URL}/similarity`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              resume_text: resumeText,
              job_description: `${job.title} at ${job.company}. ${job.description}`,
            }),
            signal: AbortSignal.timeout(5000),
          });
          if (!res.ok) return { ...job, match_score: 0, match_reason: "" };
          const data = await res.json();
          return {
            ...job,
            match_score: data.match_score ?? 0,
            match_reason: `Semantic similarity: ${data.match_score}%`,
          };
        } catch {
          return { ...job, match_score: 0, match_reason: "" };
        }
      })
    );

    return scored
      .filter((j) => j.match_score >= minScore)
      .sort((a, b) => b.match_score - a.match_score);
  } catch {
    return null;
  }
}

// Unified scorer: tries Python RAG service first, falls back to AI model
export async function scoreJobs<T extends { title: string; company: string; description: string }>(
  jobs: T[],
  resumeData: ResumeData,
  minScore: number
): Promise<(T & ScoredJob)[]> {
  const resumeText = [
    resumeData?.summary || "",
    resumeData?.skills?.length ? `Skills: ${resumeData.skills.join(", ")}` : "",
  ].filter(Boolean).join("\n");

  if (resumeText) {
    const ragResult = await scoreJobsWithRagService(jobs, resumeText, minScore);
    if (ragResult) return ragResult;
  }

  return scoreJobsAgainstResume(jobs, resumeData, minScore);
}
