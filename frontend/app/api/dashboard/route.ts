// GET /api/dashboard?sessionId=xxx — returns applications, logs, and stats
// Uses service client to bypass RLS. Works for both auth and anonymous users.

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getServiceClient } from "@/lib/db";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");

  // Determine userId
  let userId = "";
  try {
    const session = await getServerSession(authOptions);
    const uid = (session?.user as { id?: string })?.id;
    if (uid) userId = uid;
  } catch {
    // continue
  }

  if (!userId && sessionId) {
    userId = `anon_${sessionId}`;
  }

  if (!userId) {
    // No way to identify user — return empty but try most recent
    const supabase = getServiceClient();
    const { data: apps } = await supabase
      .from("applications")
      .select("*")
      .order("applied_at", { ascending: false })
      .limit(20);

    const { data: logs } = await supabase
      .from("agent_logs")
      .select("id, command, action, created_at")
      .order("created_at", { ascending: false })
      .limit(10);

    return Response.json({ applications: apps || [], logs: logs || [] });
  }

  const supabase = getServiceClient();

  const [appsRes, logsRes] = await Promise.all([
    supabase
      .from("applications")
      .select("*")
      .eq("user_id", userId)
      .order("applied_at", { ascending: false })
      .limit(50),
    supabase
      .from("agent_logs")
      .select("id, command, action, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  return Response.json({
    applications: appsRes.data || [],
    logs: logsRes.data || [],
  });
}
