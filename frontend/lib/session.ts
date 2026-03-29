import { getServiceClient } from "@/lib/db";

export async function loadSessionContext(userId: string, sessionId: string) {
  const supabase = getServiceClient();

  const [sessionRes, appsRes, resumeRes] = await Promise.all([
    supabase
      .from("agent_sessions")
      .select("messages, summary")
      .eq("user_id", userId)
      .eq("session_id", sessionId)
      .single(),
    supabase
      .from("applications")
      .select("company, job_title, status")
      .eq("user_id", userId)
      .order("applied_at", { ascending: false })
      .limit(20),
    supabase
      .from("resumes")
      .select("parsed_json")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single(),
  ]);

  return {
    sessionMessages: sessionRes.data?.messages || [],
    sessionSummary: sessionRes.data?.summary || "",
    recentApplications: appsRes.data || [],
    resumeFromDb: resumeRes.data?.parsed_json || null,
  };
}

export async function saveSessionState(
  userId: string,
  sessionId: string,
  command: string,
  agentResponse: string
) {
  const supabase = getServiceClient();

  const { data: existing } = await supabase
    .from("agent_sessions")
    .select("id, messages")
    .eq("user_id", userId)
    .eq("session_id", sessionId)
    .single();

  const messages = existing?.messages || [];
  messages.push(
    { role: "user", text: command, at: new Date().toISOString() },
    { role: "agent", text: agentResponse.slice(0, 500), at: new Date().toISOString() }
  );

  const trimmed = messages.slice(-20);

  if (existing) {
    await supabase
      .from("agent_sessions")
      .update({ messages: trimmed, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
  } else {
    await supabase.from("agent_sessions").insert({
      user_id: userId,
      session_id: sessionId,
      messages: trimmed,
    });
  }
}
