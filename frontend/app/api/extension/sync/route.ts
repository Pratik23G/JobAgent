// GET /api/extension/sync — Extension pulls latest data
// Reads from file cache first (written by POST /api/extension/push),
// falls back to Supabase if cache is missing or stale.

import { readFile } from "fs/promises";
import { join } from "path";
import { getServiceClient } from "@/lib/db";

const CACHE_FILE = join(process.cwd(), ".extension-cache.json");

export async function GET() {
  // Try file cache first (written by frontend via /api/extension/push)
  try {
    const raw = await readFile(CACHE_FILE, "utf-8");
    const cache = JSON.parse(raw);

    // Cache is valid if less than 1 hour old
    if (cache.updatedAt && Date.now() - cache.updatedAt < 3600000) {
      return Response.json({
        packs: cache.packs || [],
        profile: cache.profile || {},
        resumeFileUrl: cache.resumeBlob || null,
        hasResume: !!cache.resumeBlob,
        source: "cache",
      });
    }
  } catch {
    // No cache file or invalid — fall through to Supabase
  }

  // Fall back to Supabase
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
      address?: { street?: string; city?: string; state?: string; zip?: string; country?: string };
      linkedin?: string;
      website?: string;
      location?: string;
      skills?: string[];
      experience?: { title?: string; company?: string; duration?: string; start_date?: string; end_date?: string; description?: string; location?: string }[];
      education?: { degree?: string; school?: string; field_of_study?: string; graduation_year?: string; gpa?: string }[];
      certifications?: string[];
      work_authorization?: string;
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
      location: parsed?.location || parsed?.address?.city || "",
      // Address fields
      address: parsed?.address?.street || "",
      city: parsed?.address?.city || "",
      state: parsed?.address?.state || "",
      zip: parsed?.address?.zip || "",
      country: parsed?.address?.country || "",
      // Education & experience arrays
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

    return Response.json({
      packs: (packs || []).map(p => ({
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
    console.error("Extension sync error:", err);
    return Response.json({ packs: [], profile: {}, hasResume: false, source: "error" });
  }
}
