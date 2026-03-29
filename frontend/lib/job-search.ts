// ─── Multi-source job search ─────────────────────────────────────────────────

export interface JobResult {
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

export const LOCATION_MAP: Record<string, string> = {
  "bay area": "San Francisco",
  sf: "San Francisco",
  nyc: "New York",
  la: "Los Angeles",
  dc: "Washington",
  remote: "",
};

// Adzuna search with progressive date relaxation
export async function searchAdzuna(
  query: string,
  location: string,
  options?: { maxDaysWindows?: number[]; resultsPerPage?: number }
): Promise<JobResult[]> {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_API_KEY;
  if (!appId || !appKey) return [];

  const mappedLocation = LOCATION_MAP[location.toLowerCase()] ?? location;
  const dateWindows = options?.maxDaysWindows || [7, 30, 0];
  const resultsPerPage = options?.resultsPerPage || 15;

  for (const maxDays of dateWindows) {
    try {
      const dateParam = maxDays > 0 ? `&max_days_old=${maxDays}` : "";
      const url = `https://api.adzuna.com/v1/api/jobs/us/search/1?app_id=${appId}&app_key=${appKey}&results_per_page=${resultsPerPage}&sort_by=date${dateParam}&what=${encodeURIComponent(query)}&where=${encodeURIComponent(mappedLocation)}&content-type=application/json`;
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
    } catch {
      continue;
    }
  }

  return [];
}

export async function searchRemotive(query: string): Promise<JobResult[]> {
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

export async function searchJSearch(
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

export async function searchArbeitnow(query: string): Promise<JobResult[]> {
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

export async function searchHNHiring(query: string): Promise<JobResult[]> {
  try {
    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 86400;
    const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(`"hiring" ${query}`)}&tags=comment&numericFilters=created_at_i>${thirtyDaysAgo}&hitsPerPage=15`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();

    return (data.hits || [])
      .filter((h: { comment_text?: string }) => {
        const text = (h.comment_text || "").toLowerCase();
        return text.includes("|") && text.includes("http");
      })
      .slice(0, 8)
      .map((h: { comment_text?: string; objectID?: string; created_at_i?: number }) => {
        const raw = (h.comment_text || "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&#x2F;/g, "/").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
        const parts = raw.split("|").map((p: string) => p.trim());

        const company = (parts[0] || "").slice(0, 60) || "Startup";
        const rolePart = parts.find((p: string) =>
          /engineer|developer|designer|manager|scientist|analyst|devops|sre|frontend|backend|fullstack|full.stack/i.test(p)
        );
        const role = rolePart?.slice(0, 80) || (parts[1] || query).slice(0, 80);
        const locationPart = parts.find((p: string) =>
          /remote|onsite|hybrid|sf|nyc|bay area|new york|seattle|austin|london|berlin|usa|us only|eu only|worldwide/i.test(p)
        );
        const location = locationPart?.slice(0, 60) || "";
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

export function buildQueryVariations(title: string, keywords: string[]): string[] {
  const lower = title.toLowerCase();
  const queries: string[] = [];

  const cleaned = lower
    .replace(/\b(find|search|look for|get|me|any|opening|openings|new graduals?|for a?|college students?|please|can you)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const full = [cleaned, ...keywords].join(" ").trim();
  if (full) queries.push(full);

  const isEntryLevel = /\b(new grad|entry.?level|junior|intern|fresh|graduate|college|university|recent grad)\b/i.test(
    title + " " + keywords.join(" ")
  );

  const coreRole = cleaned
    .replace(/\b(new grad|entry.?level|junior|senior|lead|staff|principal|intern|fresh|graduate|recent grad)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  if (coreRole && coreRole !== cleaned) {
    if (isEntryLevel) {
      queries.push(`junior ${coreRole}`);
      queries.push(`entry level ${coreRole}`);
    }
    queries.push(coreRole);
  }

  return [...new Set(queries.filter(Boolean))];
}

// ─── Location filtering constants ───────────────────────────────────────────

const US_INDICATORS = ["usa", "united states", "us", "remote (us)", "remote - us"];
const US_CITIES = [
  "san francisco", "bay area", "sf", "new york", "nyc", "los angeles", "la",
  "seattle", "austin", "boston", "chicago", "denver", "portland", "san jose",
  "palo alto", "mountain view", "sunnyvale", "menlo park", "cupertino",
  "san diego", "washington", "atlanta", "miami", "dallas", "houston",
  "philadelphia", "phoenix", "minneapolis", "raleigh", "charlotte",
];
const US_STATES = [
  "california", "ca", "new york", "ny", "texas", "tx", "washington", "wa",
  "massachusetts", "ma", "colorado", "co", "illinois", "il", "georgia", "ga",
  "florida", "fl", "oregon", "or", "virginia", "va", "maryland", "md",
  "pennsylvania", "pa", "north carolina", "nc", "arizona", "az",
];
const NON_US = [
  "germany", "berlin", "munich", "hamburg", "frankfurt",
  "belgium", "brussels", "netherlands", "amsterdam",
  "france", "paris", "london", "uk", "united kingdom",
  "spain", "madrid", "barcelona", "italy", "milan", "rome",
  "sweden", "stockholm", "denmark", "copenhagen", "norway", "oslo",
  "switzerland", "zurich", "austria", "vienna", "poland", "warsaw",
  "ireland", "dublin", "portugal", "lisbon", "czech", "prague",
  "india", "bangalore", "mumbai", "hyderabad", "singapore", "tokyo", "japan",
  "australia", "sydney", "melbourne", "canada", "toronto", "vancouver",
];

function filterByLocation(jobs: JobResult[], location: string): JobResult[] {
  if (!location || location.toLowerCase() === "remote") return jobs;

  const locLower = location.toLowerCase();
  const mappedLoc = LOCATION_MAP[locLower]?.toLowerCase() || locLower;
  const isUSSearch = US_CITIES.some((c) => mappedLoc.includes(c)) || US_STATES.some((s) => mappedLoc.includes(s));

  if (!isUSSearch) return jobs;

  return jobs.filter((job) => {
    const jobLoc = (job.location || "").toLowerCase();
    if (!jobLoc || jobLoc === "remote") return true;
    if (US_INDICATORS.some((u) => jobLoc.includes(u))) return true;
    if (US_CITIES.some((c) => jobLoc.includes(c))) return true;
    if (US_STATES.some((s) => jobLoc.includes(s))) return true;
    if (NON_US.some((loc) => jobLoc.includes(loc))) return false;
    return true;
  });
}

// ─── Combined multi-source search ───────────────────────────────────────────

export async function searchMultipleSources(
  title: string,
  location: string,
  keywords: string[]
): Promise<JobResult[]> {
  const isRemote = !location || location.toLowerCase() === "remote";
  const queryVariations = buildQueryVariations(title, keywords);
  const primaryQuery = queryVariations[0] || title;
  const broadQuery = queryVariations[queryVariations.length - 1] || title;

  const searches: Promise<JobResult[]>[] = [];

  searches.push(
    (async () => {
      for (const query of queryVariations) {
        const jobs = await searchAdzuna(query, location);
        if (jobs.length > 0) return jobs;
      }
      return [];
    })()
  );

  searches.push(searchJSearch(primaryQuery, location));
  searches.push(searchHNHiring(broadQuery));

  if (isRemote) {
    searches.push(searchArbeitnow(broadQuery));
    searches.push(searchRemotive(broadQuery));
  }

  const results = await Promise.all(searches);
  const allJobs = results.flat();

  // Deduplicate
  const seen = new Set<string>();
  const deduped = allJobs.filter((job) => {
    const key = `${job.company.toLowerCase().trim().slice(0, 30)}::${job.title.toLowerCase().trim().slice(0, 50)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return filterByLocation(deduped, location);
}
