// GET /api/extension/sync — Extension pulls latest data from Supabase.
// No file cache — reads directly from database (safe for serverless/Vercel).

import { getServiceClient } from "@/lib/db";

export async function GET() {
  const supabase = getServiceClient();

  try {
    const { data: packs } = await supabase
      .from("apply_packs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10);

    const { data: resume } = await supabase
      .from("resumes")
      .select("parsed_json, file_url")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const parsed = resume?.parsed_json as {
      name?: string;
      email?: string;
      phone?: string;
      linkedin?: string;
      website?: string;
      location?: string;
      skills?: string[];
      experience?: { title?: string; company?: string }[];
    } | null;

    const nameParts = (parsed?.name || "").split(" ");
    const profile = {
      firstName: nameParts[0] || "",
      lastName: nameParts.slice(1).join(" ") || "",
      email: parsed?.email || "",
      phone: parsed?.phone || "",
      currentCompany: parsed?.experience?.[0]?.company || "",
      currentTitle: parsed?.experience?.[0]?.title || "",
      skills: parsed?.skills || [],
      linkedin: parsed?.linkedin || "",
      website: parsed?.website || "",
      location: parsed?.location || "",
    };

    const resumeDataUri = resume?.file_url?.startsWith("data:") ? resume.file_url : null;

    return Response.json({
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
      source: "supabase",
    });
  } catch (err) {
    console.error("[extension/sync] Error:", err instanceof Error ? err.message : String(err));
    return Response.json({ packs: [], profile: {}, hasResume: false, source: "error" });
  }
}
