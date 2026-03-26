// GET /api/jobs/discover?title=...&location=...&keywords=...
// Returns job listings with days_active calculated from posted_date.
// Uses the same multi-source search as the agent.

import { getServiceClient } from "@/lib/db";

const LOCATION_MAP: Record<string, string> = {
  "bay area": "San Francisco",
  sf: "San Francisco",
  nyc: "New York",
  la: "Los Angeles",
  dc: "Washington",
  remote: "",
};

interface JobResult {
  title: string;
  company: string;
  location: string;
  url: string;
  description: string;
  salary_min?: number;
  salary_max?: number;
  source: string;
  posted_date?: string;
  days_active?: number;
}

async function searchAdzuna(query: string, location: string): Promise<JobResult[]> {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_API_KEY;
  if (!appId || !appKey) return [];

  const mappedLocation = LOCATION_MAP[location.toLowerCase()] ?? location;
  const dateWindows = [7, 30, 0];

  for (const maxDays of dateWindows) {
    try {
      const dateParam = maxDays > 0 ? `&max_days_old=${maxDays}` : "";
      const url = `https://api.adzuna.com/v1/api/jobs/us/search/1?app_id=${appId}&app_key=${appKey}&results_per_page=15&sort_by=date${dateParam}&what=${encodeURIComponent(query)}&where=${encodeURIComponent(mappedLocation)}&content-type=application/json`;
      const res = await fetch(url);
      const data = await res.json();
      const jobs: JobResult[] = (data.results || []).map(
        (j: { title: string; company?: { display_name?: string }; location?: { display_name?: string }; redirect_url?: string; description?: string; salary_min?: number; salary_max?: number; created?: string }) => {
          const company = j.company?.display_name || "Unknown";
          const descUrls = (j.description || "").match(/https?:\/\/[^\s<>"]+/);
          const applyUrl = descUrls?.[0] || `https://www.google.com/search?q=${encodeURIComponent(`${company} ${j.title} apply`)}`;
          return {
            title: j.title, company, location: j.location?.display_name || "",
            url: applyUrl, description: (j.description || "").slice(0, 300),
            salary_min: j.salary_min, salary_max: j.salary_max,
            source: "adzuna", posted_date: j.created || "",
          };
        }
      );
      if (jobs.length > 0) return jobs;
    } catch { continue; }
  }
  return [];
}

async function searchRemotive(query: string): Promise<JobResult[]> {
  try {
    const url = `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(query)}&limit=10`;
    const res = await fetch(url);
    const data = await res.json();
    return (data.jobs || []).map(
      (j: { title: string; company_name?: string; candidate_required_location?: string; url?: string; description?: string; publication_date?: string }) => ({
        title: j.title, company: j.company_name || "Unknown",
        location: j.candidate_required_location || "Remote",
        url: j.url || "", description: (j.description || "").replace(/<[^>]*>/g, "").slice(0, 300),
        source: "remotive", posted_date: j.publication_date || "",
      })
    );
  } catch { return []; }
}

async function searchJSearch(query: string, location: string): Promise<JobResult[]> {
  const apiKey = process.env.JSEARCH_API_KEY;
  if (!apiKey) return [];
  const mappedLocation = LOCATION_MAP[location.toLowerCase()] ?? location;
  const locationQuery = mappedLocation ? ` in ${mappedLocation}` : "";
  try {
    const url = `https://jsearch.p.rapidapi.com/search?query=${encodeURIComponent(query + locationQuery)}&page=1&num_pages=1&date_posted=week`;
    const res = await fetch(url, {
      headers: { "X-RapidAPI-Key": apiKey, "X-RapidAPI-Host": "jsearch.p.rapidapi.com" },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.data || []).map(
      (j: { job_title: string; employer_name?: string; job_city?: string; job_state?: string; job_apply_link?: string; job_description?: string; job_min_salary?: number; job_max_salary?: number; job_posted_at_datetime_utc?: string; job_publisher?: string }) => ({
        title: j.job_title, company: j.employer_name || "Unknown",
        location: [j.job_city, j.job_state].filter(Boolean).join(", ") || "Remote",
        url: j.job_apply_link || "", description: (j.job_description || "").slice(0, 300),
        salary_min: j.job_min_salary, salary_max: j.job_max_salary,
        source: `jsearch-${j.job_publisher || "unknown"}`, posted_date: j.job_posted_at_datetime_utc || "",
      })
    );
  } catch { return []; }
}

async function searchArbeitnow(query: string): Promise<JobResult[]> {
  try {
    const url = `https://www.arbeitnow.com/api/job-board-api`;
    const res = await fetch(url);
    const data = await res.json();
    const queryLower = query.toLowerCase();
    const filtered = (data.data || [])
      .filter((j: { title: string; description?: string; tags?: string[] }) => {
        const text = `${j.title} ${j.description || ""} ${(j.tags || []).join(" ")}`.toLowerCase();
        return queryLower.split(" ").some((word: string) => word.length > 2 && text.includes(word));
      })
      .slice(0, 10);
    return filtered.map(
      (j: { title: string; company_name?: string; location?: string; url?: string; description?: string; created_at?: number }) => ({
        title: j.title, company: j.company_name || "Unknown",
        location: j.location || "Remote", url: j.url || "",
        description: (j.description || "").replace(/<[^>]*>/g, "").slice(0, 300),
        source: "arbeitnow", posted_date: j.created_at ? new Date(j.created_at * 1000).toISOString() : "",
      })
    );
  } catch { return []; }
}

function calculateDaysActive(postedDate: string | undefined): number | undefined {
  if (!postedDate) return undefined;
  try {
    const posted = new Date(postedDate);
    if (isNaN(posted.getTime())) return undefined;
    const now = new Date();
    return Math.max(0, Math.floor((now.getTime() - posted.getTime()) / (1000 * 60 * 60 * 24)));
  } catch { return undefined; }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const title = searchParams.get("title") || "";
  const location = searchParams.get("location") || "remote";
  const keywordsParam = searchParams.get("keywords") || "";
  const sessionId = searchParams.get("sessionId") || "";

  if (!title) {
    return Response.json({ error: "Missing 'title' parameter" }, { status: 400 });
  }

  const isRemote = !location || location.toLowerCase() === "remote";

  // Fire all sources in parallel
  const searches: Promise<JobResult[]>[] = [
    searchAdzuna(title, location),
    searchJSearch(title, location),
    searchArbeitnow(title),
  ];
  if (isRemote) searches.push(searchRemotive(title));

  const results = await Promise.all(searches);
  const allJobs = results.flat();

  // Deduplicate
  const seen = new Set<string>();
  const deduplicated = allJobs.filter((job) => {
    const key = `${job.company.toLowerCase().trim().slice(0, 30)}::${job.title.toLowerCase().trim().slice(0, 50)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Calculate days_active and sort by most recent
  const withDays = deduplicated.map((job) => ({
    ...job,
    days_active: calculateDaysActive(job.posted_date),
  }));

  withDays.sort((a, b) => (a.days_active ?? 999) - (b.days_active ?? 999));

  // Check which jobs the user already applied to
  let appliedCompanies: Set<string> = new Set();
  if (sessionId) {
    const supabase = getServiceClient();
    const userId = `anon_${sessionId}`;
    const { data: apps } = await supabase
      .from("applications")
      .select("company, job_title")
      .eq("user_id", userId);
    if (apps) {
      for (const app of apps) {
        appliedCompanies.add(`${(app.company || "").toLowerCase()}::${(app.job_title || "").toLowerCase()}`);
      }
    }
  }

  const jobsWithStatus = withDays.map((job) => ({
    ...job,
    already_applied: appliedCompanies.has(`${job.company.toLowerCase()}::${job.title.toLowerCase()}`),
  }));

  return Response.json({
    jobs: jobsWithStatus,
    count: jobsWithStatus.length,
    sources: [...new Set(jobsWithStatus.map((j) => j.source))],
  });
}
