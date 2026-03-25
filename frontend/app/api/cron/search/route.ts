import { anthropic } from "@/lib/claude";
import { getServiceClient } from "@/lib/db";

// ─── Daily Job Digest Endpoint ──────────────────────────────────────────────
// Trigger via: GET /api/cron/search?secret=YOUR_CRON_SECRET
// Set up with cron-job.org, Vercel Cron, or any scheduler to run daily.
//
// What it does:
// 1. Loads all users who have a resume uploaded
// 2. For each user, searches jobs matching their skills
// 3. Scores results against their resume
// 4. Stores top matches in a new "digest" for the user
// 5. Optionally sends email via Resend

const LOCATION_MAP: Record<string, string> = {
  "bay area": "San Francisco",
  sf: "San Francisco",
  nyc: "New York",
  la: "Los Angeles",
  dc: "Washington",
  remote: "",
};

async function searchAdzunaForDigest(query: string, location: string) {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_API_KEY;
  if (!appId || !appKey) return [];

  const mappedLocation = LOCATION_MAP[location.toLowerCase()] ?? location;

  for (const maxDays of [3, 7]) {
    try {
      const url = `https://api.adzuna.com/v1/api/jobs/us/search/1?app_id=${appId}&app_key=${appKey}&results_per_page=10&max_days_old=${maxDays}&sort_by=date&what=${encodeURIComponent(query)}&where=${encodeURIComponent(mappedLocation)}&content-type=application/json`;
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

async function scoreJobs(
  jobs: { title: string; company: string; description: string }[],
  resume: { summary?: string; skills?: string[] }
) {
  if (!resume?.skills?.length || jobs.length === 0) return jobs.map((j) => ({ ...j, match_score: 50, match_reason: "" }));

  try {
    const resp = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      messages: [
        {
          role: "user",
          content: `Score each job 0-100 against this resume. Return ONLY a JSON array.
Resume skills: ${resume.skills.join(", ")}
Summary: ${resume.summary || "N/A"}

Jobs:
${jobs.map((j, i) => `${i}. ${j.title} at ${j.company}: ${j.description}`).join("\n")}

Return: [{"index": 0, "match_score": 85, "reason": "..."}]
ONLY valid JSON.`,
        },
      ],
    });

    const text = resp.content[0].type === "text" ? resp.content[0].text : "[]";
    const scores: { index: number; match_score: number; reason: string }[] = JSON.parse(text);
    return jobs.map((job, i) => {
      const s = scores.find((x) => x.index === i);
      return { ...job, match_score: s?.match_score ?? 50, match_reason: s?.reason ?? "" };
    });
  } catch {
    return jobs.map((j) => ({ ...j, match_score: 50, match_reason: "" }));
  }
}

export async function GET(request: Request) {
  // Verify cron secret to prevent unauthorized access
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && secret !== cronSecret) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = getServiceClient();

  try {
    // Get all users with resumes
    const { data: resumes } = await supabase
      .from("resumes")
      .select("user_id, parsed_json")
      .not("parsed_json", "is", null);

    if (!resumes || resumes.length === 0) {
      return Response.json({ message: "No users with resumes found", digests: 0 });
    }

    const results: { userId: string; jobsFound: number; topMatches: number }[] = [];

    for (const resume of resumes) {
      const parsed = resume.parsed_json as { summary?: string; skills?: string[]; experience?: { title?: string }[] };
      if (!parsed?.skills?.length) continue;

      // Derive search query from resume skills and recent job titles
      const recentTitle = parsed.experience?.[0]?.title || "";
      const topSkills = parsed.skills.slice(0, 3).join(" ");
      const searchQuery = recentTitle || topSkills || "software engineer";

      // Search for jobs
      const jobs = await searchAdzunaForDigest(searchQuery, "");

      if (jobs.length === 0) continue;

      // Score against resume
      const scored = await scoreJobs(jobs, parsed);
      const topMatches = scored
        .filter((j) => j.match_score >= 60)
        .sort((a, b) => (b.match_score as number) - (a.match_score as number))
        .slice(0, 5);

      if (topMatches.length === 0) continue;

      // Store digest
      await supabase.from("agent_logs").insert({
        user_id: resume.user_id,
        command: "daily_digest",
        action: `Found ${topMatches.length} matching jobs`,
        result: {
          type: "daily_digest",
          date: new Date().toISOString().split("T")[0],
          search_query: searchQuery,
          jobs: topMatches,
        },
      });

      results.push({
        userId: resume.user_id,
        jobsFound: jobs.length,
        topMatches: topMatches.length,
      });
    }

    return Response.json({
      message: `Daily digest complete. Processed ${resumes.length} users.`,
      digests: results.length,
      results,
    });
  } catch (err) {
    console.error("Cron search error:", err);
    return new Response("Cron job failed", { status: 500 });
  }
}
