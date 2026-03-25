// API endpoint for the Chrome extension to sync apply packs and user profile
// GET /api/extension/sync — returns latest apply packs + parsed resume profile

import { getServiceClient } from "@/lib/db";

export async function GET() {
  // For now, return data from localStorage sync (sent via query params or extension storage)
  // In production, this would use auth. For dev, we return the most recent data.
  const supabase = getServiceClient();

  try {
    // Get the most recent apply packs (across all users for dev; scoped by user in production)
    const { data: packs } = await supabase
      .from("apply_packs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10);

    // Get the most recent resume for profile extraction
    const { data: resume } = await supabase
      .from("resumes")
      .select("parsed_json")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    const parsed = resume?.parsed_json as {
      name?: string;
      email?: string;
      phone?: string;
      skills?: string[];
      experience?: { title?: string; company?: string }[];
      education?: { degree?: string; school?: string }[];
    } | null;

    // Build a profile object the extension can use to fill forms
    const nameParts = (parsed?.name || "").split(" ");
    const profile = {
      firstName: nameParts[0] || "",
      lastName: nameParts.slice(1).join(" ") || "",
      email: parsed?.email || "",
      phone: parsed?.phone || "",
      currentCompany: parsed?.experience?.[0]?.company || "",
      currentTitle: parsed?.experience?.[0]?.title || "",
      skills: parsed?.skills || [],
      linkedin: "", // User should set this in extension settings
      website: "",
      location: "",
    };

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
    });
  } catch (err) {
    console.error("Extension sync error:", err);
    return Response.json({ packs: [], profile: {} });
  }
}
