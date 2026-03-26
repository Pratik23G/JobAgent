// GET /api/gmail/emails — Fetch recent job-related emails from Gmail
// Uses stored OAuth tokens. Auto-refreshes if expired.

import { fetchRecentEmails, refreshAccessToken } from "@/lib/gmail";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";

const TOKEN_FILE = join(process.cwd(), ".gmail-tokens.json");

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") || "";
  const maxResults = parseInt(searchParams.get("limit") || "20");

  // Load tokens
  let tokens;
  try {
    const raw = await readFile(TOKEN_FILE, "utf-8");
    tokens = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Gmail not connected. Connect first via /api/gmail" }, { status: 401 });
  }

  if (!tokens.access_token) {
    return Response.json({ error: "No access token. Reconnect Gmail." }, { status: 401 });
  }

  try {
    const emails = await fetchRecentEmails(
      tokens.access_token,
      tokens.refresh_token || null,
      query,
      maxResults
    );

    return Response.json({ emails, count: emails.length });
  } catch (err: unknown) {
    // Token might be expired — try refresh
    if (tokens.refresh_token && err instanceof Error && err.message?.includes("invalid_grant")) {
      const newToken = await refreshAccessToken(tokens.refresh_token);
      if (newToken) {
        tokens.access_token = newToken;
        await writeFile(TOKEN_FILE, JSON.stringify(tokens), "utf-8");

        // Retry
        const emails = await fetchRecentEmails(newToken, tokens.refresh_token, query, maxResults);
        return Response.json({ emails, count: emails.length });
      }
    }

    return Response.json({ error: "Failed to fetch emails: " + String(err) }, { status: 500 });
  }
}
