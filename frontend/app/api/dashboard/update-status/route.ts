// POST /api/dashboard/update-status — Update an application's status
// Uses service client to bypass RLS.

import { getServiceClient } from "@/lib/db";

export async function POST(request: Request) {
  const { id, status, sessionId } = await request.json();

  if (!id || !status) {
    return Response.json({ error: "Missing id or status" }, { status: 400 });
  }

  const supabase = getServiceClient();

  const { error } = await supabase
    .from("applications")
    .update({
      status,
      last_updated: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}
