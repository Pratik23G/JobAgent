// POST /api/extension/confirm-submit — Extension reports that a form was actually submitted
// Updates the application status from "ready" to "applied" in Supabase.

import { getServiceClient } from "@/lib/db";

export async function POST(request: Request) {
  const { company, jobTitle, jobUrl, sessionId, fieldsFilledCount, resumeUploaded } = await request.json();

  if (!company && !jobTitle) {
    return Response.json({ error: "Need company or jobTitle to match application" }, { status: 400 });
  }

  const supabase = getServiceClient();
  const userId = sessionId ? `anon_${sessionId}` : "";

  // Try to find the matching application
  let query = supabase
    .from("applications")
    .select("id, status, company, job_title")
    .in("status", ["ready", "applied"]);

  if (userId) {
    query = query.eq("user_id", userId);
  }

  if (company) {
    query = query.ilike("company", `%${company}%`);
  }

  const { data: matches } = await query.order("applied_at", { ascending: false }).limit(5);

  if (!matches || matches.length === 0) {
    // No matching application found — create one
    const { data: newApp } = await supabase
      .from("applications")
      .insert({
        user_id: userId || "anonymous",
        job_title: jobTitle || "Unknown",
        company: company || "Unknown",
        job_url: jobUrl || "",
        status: "applied",
        notes: `Submitted via extension. Fields filled: ${fieldsFilledCount || 0}. Resume: ${resumeUploaded ? "yes" : "no"}.`,
      })
      .select("id")
      .single();

    return Response.json({
      success: true,
      applicationId: newApp?.id,
      action: "created",
      message: `New application recorded for ${company || jobTitle}`,
    });
  }

  // Update the best match from "ready" to "applied"
  const readyMatch = matches.find((m) => m.status === "ready") || matches[0];

  await supabase
    .from("applications")
    .update({
      status: "applied",
      last_updated: new Date().toISOString(),
      notes: `Submitted via extension. Fields filled: ${fieldsFilledCount || 0}. Resume: ${resumeUploaded ? "yes" : "no"}.`,
    })
    .eq("id", readyMatch.id);

  return Response.json({
    success: true,
    applicationId: readyMatch.id,
    action: "updated",
    message: `${readyMatch.company} — ${readyMatch.job_title} marked as applied`,
  });
}
