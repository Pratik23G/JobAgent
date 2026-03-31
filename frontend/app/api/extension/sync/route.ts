// GET|POST /api/extension/sync — Extension pulls latest data from Supabase.
// Filters by sessionId so each user gets their own packs and resume.

import { getServiceClient } from "@/lib/db";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const sessionId = body?.sessionId || "";
    return syncForUser(sessionId);
  } catch {
    return syncForUser("");
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId") || "";
  return syncForUser(sessionId);
}

async function syncForUser(sessionId: string) {
  const supabase = getServiceClient();
  const userId = sessionId ? `anon_${sessionId}` : null;

  try {
    // ── Fetch apply packs ─────────────────────────────────────────────────
    let packsQuery = supabase
      .from("apply_packs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10);

    if (userId) {
      packsQuery = packsQuery.eq("user_id", userId);
    }

    const { data: packs, error: packsError } = await packsQuery;
    if (packsError) {
      console.error("[extension/sync] Packs query error:", packsError.message);
    }

    // ── Fetch resume ──────────────────────────────────────────────────────
    let resumeQuery = supabase
      .from("resumes")
      .select("parsed_json, file_url")
      .order("created_at", { ascending: false })
      .limit(1);

    if (userId) {
      resumeQuery = resumeQuery.eq("user_id", userId);
    }

    const { data: resumeRows, error: resumeError } = await resumeQuery;
    if (resumeError) {
      console.error("[extension/sync] Resume query error:", resumeError.message);
    }

    const resume = resumeRows?.[0] || null;

    // ── Build profile from parsed resume JSON ─────────────────────────────
    const parsed = resume?.parsed_json as {
      name?: string;
      firstName?: string;
      lastName?: string;
      first_name?: string;
      last_name?: string;
      email?: string;
      phone?: string;
      address?: string | { street?: string; city?: string; state?: string; zip?: string; country?: string };
      linkedin?: string;
      website?: string;
      location?: string;
      skills?: string[];
      experience?: { title?: string; company?: string; duration?: string; start_date?: string; end_date?: string; description?: string; location?: string }[];
      education?: { degree?: string; school?: string; field_of_study?: string; graduation_year?: string; gpa?: string }[];
      certifications?: string[];
      work_authorization?: string;
    } | null;

    // Handle multiple name formats the LLM might return
    let firstName = "";
    let lastName = "";
    if (parsed?.firstName || parsed?.first_name) {
      firstName = parsed.firstName || parsed.first_name || "";
      lastName = parsed.lastName || parsed.last_name || "";
    } else if (parsed?.name) {
      const nameParts = parsed.name.split(" ");
      firstName = nameParts[0] || "";
      lastName = nameParts.slice(1).join(" ") || "";
    }

    // Handle address as either string or object
    const addr = typeof parsed?.address === "object" && parsed?.address !== null
      ? parsed.address
      : { street: "", city: "", state: "", zip: "", country: "" };

    const profile = {
      firstName,
      lastName,
      email: parsed?.email || "",
      phone: parsed?.phone || "",
      currentCompany: parsed?.experience?.[0]?.company || "",
      currentTitle: parsed?.experience?.[0]?.title || "",
      skills: parsed?.skills || [],
      linkedin: parsed?.linkedin || "",
      website: parsed?.website || "",
      location: parsed?.location || addr.city || "",
      address: addr.street || "",
      city: addr.city || "",
      state: addr.state || "",
      zip: addr.zip || "",
      country: addr.country || "",
      education: (parsed?.education || []).map(e => ({
        degree: e.degree || "",
        school: e.school || "",
        fieldOfStudy: e.field_of_study || "",
        graduationYear: e.graduation_year || "",
        gpa: e.gpa || "",
      })),
      experience: (parsed?.experience || []).map(e => ({
        title: e.title || "",
        company: e.company || "",
        duration: e.duration || "",
        startDate: e.start_date || "",
        endDate: e.end_date || "",
        description: e.description || "",
        location: e.location || "",
      })),
      certifications: parsed?.certifications || [],
      workAuthorization: parsed?.work_authorization || "",
    };

    const resumeDataUri = resume?.file_url?.startsWith("data:") ? resume.file_url : null;

    return Response.json(
      {
        packs: (packs || []).map((p) => ({
          company: p.company,
          title: p.job_title,
          job_url: p.job_url,
          cover_letter: p.cover_letter,
          resume_bullets: p.resume_bullets,
          why_good_fit: p.why_good_fit,
          common_answers: p.common_answers,
          outreach_email: p.outreach_email,
        })),
        profile,
        resumeFileUrl: resumeDataUri,
        hasResume: !!resumeDataUri,
        needsReupload: !!resume?.file_url && !resumeDataUri,
        source: "supabase",
      },
      { headers: CORS_HEADERS }
    );
  } catch (err) {
    console.error("[extension/sync] Error:", err instanceof Error ? err.message : String(err));
    return Response.json(
      { packs: [], profile: {}, hasResume: false, source: "error" },
      { headers: CORS_HEADERS }
    );
  }
}
