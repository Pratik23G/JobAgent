import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { anthropic, AGENT_TOOLS, buildSystemPrompt } from "@/lib/claude";
import { getServiceClient } from "@/lib/db";
import { sendColdEmail } from "@/lib/resend";
import type Anthropic from "@anthropic-ai/sdk";

// ─── Resume-aware job scoring ────────────────────────────────────────────────

async function scoreJobsAgainstResume<T extends { title: string; company: string; description: string }>(
  jobs: T[],
  resumeData: { summary?: string; skills?: string[]; experience?: unknown[] },
  minScore: number
): Promise<(T & { match_score: number; match_reason: string })[]> {
  if (!resumeData?.skills?.length || jobs.length === 0)
    return jobs.map((j) => ({ ...j, match_score: 0, match_reason: "" }));

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

// ─── Multi-source job search ─────────────────────────────────────────────────

interface JobResult {
  [k: string]: unknown;
  title: string;
  company: string;
  location: string;
  url: string;
  description: string;
  salary_min?: number;
  salary_max?: number;
  source: string;
  posted_date?: string;
}

const LOCATION_MAP: Record<string, string> = {
  "bay area": "San Francisco",
  sf: "San Francisco",
  nyc: "New York",
  la: "Los Angeles",
  dc: "Washington",
  remote: "",
};

// Adzuna search with progressive date relaxation
// Tries 7 days → 30 days → no limit until it finds results
async function searchAdzuna(
  query: string,
  location: string
): Promise<JobResult[]> {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_API_KEY;
  if (!appId || !appKey) return [];

  const mappedLocation = LOCATION_MAP[location.toLowerCase()] ?? location;

  // Progressive date relaxation: try tight window first, then widen
  const dateWindows = [7, 30, 0]; // 0 = no filter

  for (const maxDays of dateWindows) {
    try {
      const dateParam = maxDays > 0 ? `&max_days_old=${maxDays}` : "";
      const url = `https://api.adzuna.com/v1/api/jobs/us/search/1?app_id=${appId}&app_key=${appKey}&results_per_page=15&sort_by=date${dateParam}&what=${encodeURIComponent(query)}&where=${encodeURIComponent(mappedLocation)}&content-type=application/json`;
      const res = await fetch(url);
      const data = await res.json();
      const jobs: JobResult[] = (data.results || []).map(
        (j: {
          title: string;
          company?: { display_name?: string };
          location?: { display_name?: string };
          redirect_url?: string;
          description?: string;
          salary_min?: number;
          salary_max?: number;
          created?: string;
        }) => {
          const company = j.company?.display_name || "Unknown";
          // Adzuna redirect_url often returns 403.
          // Try to extract a real URL from the description, otherwise
          // build a Google search link to the actual job posting.
          const descUrls = (j.description || "").match(/https?:\/\/[^\s<>"]+/);
          const applyUrl =
            descUrls?.[0] ||
            `https://www.google.com/search?q=${encodeURIComponent(`${company} ${j.title} apply`)}`;

          return {
            title: j.title,
            company,
            location: j.location?.display_name || "",
            url: applyUrl,
            description: (j.description || "").slice(0, 300),
            salary_min: j.salary_min,
            salary_max: j.salary_max,
            source: "adzuna",
            posted_date: j.created || "",
          };
        }
      );

      if (jobs.length > 0) return jobs;
      // No results at this date range — widen
    } catch {
      continue;
    }
  }

  return [];
}

// Search Remotive (free, remote-only jobs)
async function searchRemotive(query: string): Promise<JobResult[]> {
  try {
    const url = `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(query)}&limit=10`;
    const res = await fetch(url);
    const data = await res.json();
    return (data.jobs || []).map(
      (j: {
        title: string;
        company_name?: string;
        candidate_required_location?: string;
        url?: string;
        description?: string;
        salary?: string;
        publication_date?: string;
      }) => ({
        title: j.title,
        company: j.company_name || "Unknown",
        location: j.candidate_required_location || "Remote",
        url: j.url || "",
        description: (j.description || "").replace(/<[^>]*>/g, "").slice(0, 300),
        source: "remotive",
        posted_date: j.publication_date || "",
      })
    );
  } catch {
    return [];
  }
}

// JSearch via RapidAPI (free tier: 500 req/month)
// Aggregates LinkedIn, Indeed, Glassdoor, ZipRecruiter
async function searchJSearch(
  query: string,
  location: string
): Promise<JobResult[]> {
  const apiKey = process.env.JSEARCH_API_KEY;
  if (!apiKey) return [];

  const mappedLocation = LOCATION_MAP[location.toLowerCase()] ?? location;
  const locationQuery = mappedLocation ? ` in ${mappedLocation}` : "";

  try {
    const url = `https://jsearch.p.rapidapi.com/search?query=${encodeURIComponent(query + locationQuery)}&page=1&num_pages=1&date_posted=week`;
    const res = await fetch(url, {
      headers: {
        "X-RapidAPI-Key": apiKey,
        "X-RapidAPI-Host": "jsearch.p.rapidapi.com",
      },
    });
    if (!res.ok) {
      // 403 = not subscribed, 429 = rate limited — fail silently
      console.warn(`[JSearch] HTTP ${res.status} — ${res.status === 403 ? "not subscribed to JSearch on RapidAPI" : "request failed"}`);
      return [];
    }
    const data = await res.json();
    return (data.data || []).map(
      (j: {
        job_title: string;
        employer_name?: string;
        job_city?: string;
        job_state?: string;
        job_apply_link?: string;
        job_description?: string;
        job_min_salary?: number;
        job_max_salary?: number;
        job_posted_at_datetime_utc?: string;
        job_publisher?: string;
      }) => ({
        title: j.job_title,
        company: j.employer_name || "Unknown",
        location: [j.job_city, j.job_state].filter(Boolean).join(", ") || "Remote",
        url: j.job_apply_link || "",
        description: (j.job_description || "").slice(0, 300),
        salary_min: j.job_min_salary,
        salary_max: j.job_max_salary,
        source: `jsearch-${j.job_publisher || "unknown"}`,
        posted_date: j.job_posted_at_datetime_utc || "",
      })
    );
  } catch {
    return [];
  }
}

// Arbeitnow (free, no key, global tech jobs)
async function searchArbeitnow(query: string): Promise<JobResult[]> {
  try {
    const url = `https://www.arbeitnow.com/api/job-board-api`;
    const res = await fetch(url);
    const data = await res.json();
    const queryLower = query.toLowerCase();
    // Filter client-side since API doesn't support search well
    const filtered = (data.data || [])
      .filter((j: { title: string; description?: string; tags?: string[] }) => {
        const text = `${j.title} ${j.description || ""} ${(j.tags || []).join(" ")}`.toLowerCase();
        return queryLower.split(" ").some((word: string) => word.length > 2 && text.includes(word));
      })
      .slice(0, 10);

    return filtered.map(
      (j: {
        title: string;
        company_name?: string;
        location?: string;
        url?: string;
        description?: string;
        tags?: string[];
        created_at?: number;
      }) => ({
        title: j.title,
        company: j.company_name || "Unknown",
        location: j.location || "Remote",
        url: j.url || "",
        description: (j.description || "").replace(/<[^>]*>/g, "").slice(0, 300),
        source: "arbeitnow",
        posted_date: j.created_at ? new Date(j.created_at * 1000).toISOString() : "",
      })
    );
  } catch {
    return [];
  }
}

// Hacker News "Who's Hiring" threads via Algolia (free, no key, high-quality startup jobs)
// HN format is typically: "Company | Role | Location | Remote | URL"
async function searchHNHiring(query: string): Promise<JobResult[]> {
  try {
    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 86400;
    const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(`"hiring" ${query}`)}&tags=comment&numericFilters=created_at_i>${thirtyDaysAgo}&hitsPerPage=15`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();

    return (data.hits || [])
      .filter((h: { comment_text?: string }) => {
        const text = (h.comment_text || "").toLowerCase();
        // HN job posts typically use | as separator and contain a URL
        return text.includes("|") && text.includes("http");
      })
      .slice(0, 8)
      .map((h: { comment_text?: string; objectID?: string; created_at_i?: number }) => {
        const raw = (h.comment_text || "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&#x2F;/g, "/").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
        // Split on | which is the HN convention
        const parts = raw.split("|").map((p: string) => p.trim());

        // Extract company (first part, before any |)
        const company = (parts[0] || "").slice(0, 60) || "Startup";

        // Extract role — usually 2nd part, look for engineering keywords
        const rolePart = parts.find((p: string) =>
          /engineer|developer|designer|manager|scientist|analyst|devops|sre|frontend|backend|fullstack|full.stack/i.test(p)
        );
        const role = rolePart?.slice(0, 80) || (parts[1] || query).slice(0, 80);

        // Extract location — look for location-like parts
        const locationPart = parts.find((p: string) =>
          /remote|onsite|hybrid|sf|nyc|bay area|new york|seattle|austin|london|berlin|usa|us only|eu only|worldwide/i.test(p)
        );
        const location = locationPart?.slice(0, 60) || "";

        // Extract URL from the comment
        const urlMatch = raw.match(/https?:\/\/[^\s<>"]+/);
        const applyUrl = urlMatch?.[0] || `https://news.ycombinator.com/item?id=${h.objectID}`;

        return {
          title: role,
          company,
          location,
          url: applyUrl,
          description: raw.slice(0, 300),
          source: "hackernews",
          posted_date: h.created_at_i ? new Date(h.created_at_i * 1000).toISOString() : "",
        };
      });
  } catch {
    return [];
  }
}

// Build multiple query variations from a title to maximize results
// e.g. "new grad software engineer" → ["software engineer", "junior software engineer", "entry level software engineer"]
function buildQueryVariations(title: string, keywords: string[]): string[] {
  const lower = title.toLowerCase();
  const queries: string[] = [];

  // Clean out conversational filler
  const cleaned = lower
    .replace(/\b(find|search|look for|get|me|any|opening|openings|new graduals?|for a?|college students?|please|can you)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // Full query with keywords
  const full = [cleaned, ...keywords].join(" ").trim();
  if (full) queries.push(full);

  // If it mentions new grad/junior/entry level, add variations
  const isEntryLevel = /\b(new grad|entry.?level|junior|intern|fresh|graduate|college|university|recent grad)\b/i.test(
    title + " " + keywords.join(" ")
  );

  // Extract the core role (e.g. "software engineer" from "new grad software engineer")
  const coreRole = cleaned
    .replace(/\b(new grad|entry.?level|junior|senior|lead|staff|principal|intern|fresh|graduate|recent grad)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  if (coreRole && coreRole !== cleaned) {
    if (isEntryLevel) {
      queries.push(`junior ${coreRole}`);
      queries.push(`entry level ${coreRole}`);
    }
    queries.push(coreRole); // broadest fallback
  }

  // Deduplicate
  return [...new Set(queries.filter(Boolean))];
}

async function searchMultipleSources(
  title: string,
  location: string,
  keywords: string[]
): Promise<JobResult[]> {
  const isRemote = !location || location.toLowerCase() === "remote";
  const queryVariations = buildQueryVariations(title, keywords);
  const primaryQuery = queryVariations[0] || title;
  const broadQuery = queryVariations[queryVariations.length - 1] || title;

  // Fire ALL sources in parallel for speed
  const searches: Promise<JobResult[]>[] = [];

  // Adzuna: try query variations sequentially (it's the primary source)
  searches.push(
    (async () => {
      for (const query of queryVariations) {
        const jobs = await searchAdzuna(query, location);
        if (jobs.length > 0) return jobs;
      }
      return [];
    })()
  );

  // JSearch (LinkedIn/Indeed/Glassdoor aggregator) — use primary query
  searches.push(searchJSearch(primaryQuery, location));

  // HN Who's Hiring — great for startup/tech roles
  searches.push(searchHNHiring(broadQuery));

  // Arbeitnow — global tech jobs
  searches.push(searchArbeitnow(broadQuery));

  // Remotive — for remote searches
  if (isRemote) {
    searches.push(searchRemotive(broadQuery));
  }

  const results = await Promise.all(searches);
  const allJobs = results.flat();

  // Deduplicate by company+title similarity
  const seen = new Set<string>();
  return allJobs.filter((job) => {
    const key = `${job.company.toLowerCase().trim().slice(0, 30)}::${job.title.toLowerCase().trim().slice(0, 50)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
      const scored = await scoreJobsAgainstResume(
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
      const maxApps = Math.min((toolInput.max_applications as number) || 5, 10);
      const minScore = (toolInput.min_match_score as number) || 60;

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
        const scored = await scoreJobsAgainstResume(
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
                  status: "applied",
                  notes: `Auto-pipeline. Score: ${job.match_score}. Source: ${job.source || "adzuna"}`,
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
                source: job.source || "adzuna",
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

        // Log if authenticated
        if (userId !== "anonymous") {
          await supabase.from("agent_logs").insert({
            user_id: userId,
            command: `auto_apply_pipeline: ${title}`,
            action: `Generated ${pipeline.apply_packs.length} apply packs`,
            result: { summary: pipeline },
          });
        }

        return JSON.stringify({
          ...pipeline,
          message: `Pipeline complete! Found ${pipeline.jobs_found} jobs, ${pipeline.jobs_matched} matched your resume (score >= ${minScore}). Generated ${pipeline.apply_packs.length} apply packs with cover letters, tailored resume bullets, and outreach emails. Click each apply link and use the materials to submit your application.`,
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
          const resp = await anthropic.messages.create({
            model: "claude-sonnet-4-20250514",
            max_tokens: 300,
            messages: [
              {
                role: "user",
                content: `Write a brief follow-up email (under 80 words) for a ${app.job_title} role at ${app.company} that was applied to ${daysAgo} days ago. Candidate: ${resumeSummary}. Be polite, express continued interest, ask about timeline. Just the body.`,
              },
            ],
          });

          const body = resp.content[0].type === "text" ? resp.content[0].text : "";
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
          model: "claude-sonnet-4-20250514",
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
              status: "applied",
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

    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
}

// ─── Main POST handler ──────────────────────────────────────────────────────

export async function POST(request: Request) {
  // Try auth, but allow anonymous fallback for development
  let userId = "anonymous";
  try {
    const session = await getServerSession(authOptions);
    const uid = (session?.user as { id?: string })?.id;
    if (uid) userId = uid;
  } catch {
    // Auth may be misconfigured — continue as anonymous
  }

  const { command, resumeData, sessionId, chatHistory } = await request.json();
  if (!command) {
    return new Response("Missing command", { status: 400 });
  }

  const sid = sessionId || crypto.randomUUID();
  const supabase = getServiceClient();
  const isAuthenticated = userId !== "anonymous";

  try {
    // Load context from DB only if authenticated
    let ctx = {
      sessionMessages: [] as { role: string; content: string }[],
      sessionSummary: "",
      recentApplications: [] as { company: string; job_title: string; status: string }[],
      resumeFromDb: null as Record<string, unknown> | null,
    };

    if (isAuthenticated) {
      ctx = await loadSessionContext(userId, sid);
    }

    // Merge resume: prefer DB version → client-sent localStorage data → null
    const resume = ctx.resumeFromDb || resumeData || null;

    // Build conversation history from client localStorage (fallback when auth is broken)
    const clientHistory: { role: string; text: string }[] = chatHistory || [];

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
      model: "claude-sonnet-4-20250514",
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
            resume
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

    // Save session state + activity log (only if authenticated)
    if (isAuthenticated) {
      await Promise.all([
        saveSessionState(userId, sid, command, agentResponse),
        supabase.from("agent_logs").insert({
          user_id: userId,
          command,
          action: agentResponse.slice(0, 500),
          result: { iterations, stop_reason: response.stop_reason },
        }),
      ]);
    }

    return Response.json({
      response: agentResponse,
      sessionId: sid,
      applyPacks: collectedApplyPacks.length > 0 ? collectedApplyPacks : undefined,
    });
  } catch (err) {
    console.error("Agent error:", err);
    return new Response("Agent processing failed", { status: 500 });
  }
}
