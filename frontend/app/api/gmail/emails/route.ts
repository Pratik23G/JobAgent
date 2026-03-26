// GET /api/gmail/emails?sessionId=xxx — Fetch recent job-related emails
// Uses per-user tokens from Supabase. Auto-refreshes if expired.

import { fetchRecentEmails, getGmailTokens, refreshAndSaveToken } from "@/lib/gmail";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");
  const query = searchParams.get("q") || "";
  const maxResults = parseInt(searchParams.get("limit") || "20");

  if (!sessionId) {
    return Response.json({ error: "Missing sessionId" }, { status: 400 });
  }

  const tokens = await getGmailTokens(sessionId);
  if (!tokens) {
    return Response.json({ error: "Gmail not connected", connected: false }, { status: 401 });
  }

  try {
    const emails = await fetchRecentEmails(tokens.access_token, tokens.refresh_token, query, maxResults);
    return Response.json({ emails, count: emails.length });
  } catch {
    // Token might be expired — try refresh
    if (tokens.refresh_token) {
      const newToken = await refreshAndSaveToken(sessionId, tokens.refresh_token);
      if (newToken) {
        const emails = await fetchRecentEmails(newToken, tokens.refresh_token, query, maxResults);
        return Response.json({ emails, count: emails.length });
      }
    }
    return Response.json({ error: "Failed to fetch emails. Try reconnecting Gmail.", connected: false }, { status: 500 });
  }
}
