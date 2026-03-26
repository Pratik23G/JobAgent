// GET /api/extension/resume — returns the most recent resume as base64 for the extension to upload to ATS forms

import { getServiceClient } from "@/lib/db";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");
  const supabase = getServiceClient();

  try {
    let query = supabase
      .from("resumes")
      .select("file_url, parsed_json")
      .order("created_at", { ascending: false })
      .limit(1);

    if (sessionId) {
      query = query.eq("user_id", `anon_${sessionId}`);
    }

    const { data } = await query.single();

    if (!data?.file_url) {
      return Response.json({ error: "No resume file found" }, { status: 404 });
    }

    return Response.json({
      fileUrl: data.file_url,
      fileName: "resume.pdf",
      type: "application/pdf",
    });
  } catch {
    return Response.json({ error: "Failed to fetch resume" }, { status: 500 });
  }
}
