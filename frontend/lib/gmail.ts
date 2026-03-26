import { google } from "googleapis";
import { getServiceClient } from "@/lib/db";

// Gmail OAuth2 — per-user tokens stored in Supabase gmail_tokens table.
// Uses GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET (same as NextAuth).
// No hardcoded email — user picks which Google account to authorize.

const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

export function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI || "http://localhost:3000/api/gmail/callback"
  );
}

export function getAuthUrl(sessionId: string): string {
  const oauth2Client = getOAuth2Client();
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
    state: sessionId, // Pass sessionId through OAuth flow
  });
}

export async function getTokensFromCode(code: string) {
  const oauth2Client = getOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

// ─── Supabase token storage ─────────────────────────────────────────────────

export async function saveGmailTokens(
  sessionId: string,
  email: string,
  accessToken: string,
  refreshToken: string | null,
  expiry: Date | null
) {
  const supabase = getServiceClient();
  await supabase.from("gmail_tokens").upsert(
    {
      session_id: sessionId,
      gmail_email: email,
      access_token: accessToken,
      refresh_token: refreshToken,
      expiry: expiry?.toISOString() || null,
    },
    { onConflict: "session_id" }
  );
}

export async function getGmailTokens(sessionId: string): Promise<{
  gmail_email: string;
  access_token: string;
  refresh_token: string | null;
  expiry: string | null;
} | null> {
  const supabase = getServiceClient();
  const { data } = await supabase
    .from("gmail_tokens")
    .select("gmail_email, access_token, refresh_token, expiry")
    .eq("session_id", sessionId)
    .maybeSingle();
  return data;
}

export async function deleteGmailTokens(sessionId: string) {
  const supabase = getServiceClient();
  await supabase.from("gmail_tokens").delete().eq("session_id", sessionId);
}

// ─── Gmail API ──────────────────────────────────────────────────────────────

export interface GmailMessage {
  id: string;
  threadId: string;
  from: string;
  fromEmail: string;
  subject: string;
  body: string;
  date: string;
  snippet: string;
}

export async function fetchRecentEmails(
  accessToken: string,
  refreshToken: string | null,
  query: string = "",
  maxResults: number = 20
): Promise<GmailMessage[]> {
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  const searchQuery = query || [
    "subject:(application OR interview OR offer OR position OR hiring OR recruiter)",
    "newer_than:30d",
    "-category:promotions",
    "-category:social",
  ].join(" ");

  const listRes = await gmail.users.messages.list({
    userId: "me",
    q: searchQuery,
    maxResults,
  });

  const messageIds = listRes.data.messages || [];
  if (messageIds.length === 0) return [];

  const messages = await Promise.all(
    messageIds.map(async (msg) => {
      try {
        const full = await gmail.users.messages.get({
          userId: "me",
          id: msg.id!,
          format: "full",
        });

        const headers = full.data.payload?.headers || [];
        const getHeader = (name: string) =>
          headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";

        const from = getHeader("From");
        const fromEmail = from.match(/<(.+)>/)?.[1] || from;
        const subject = getHeader("Subject");
        const date = getHeader("Date");

        let body = "";
        const payload = full.data.payload;

        if (payload?.body?.data) {
          body = Buffer.from(payload.body.data, "base64").toString("utf-8");
        } else if (payload?.parts) {
          for (const part of payload.parts) {
            if (part.mimeType === "text/plain" && part.body?.data) {
              body = Buffer.from(part.body.data, "base64").toString("utf-8");
              break;
            }
            if (part.mimeType === "text/html" && part.body?.data && !body) {
              const html = Buffer.from(part.body.data, "base64").toString("utf-8");
              body = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
            }
          }
        }

        return {
          id: msg.id!,
          threadId: msg.threadId || "",
          from,
          fromEmail,
          subject,
          body: body.slice(0, 2000),
          date,
          snippet: full.data.snippet || "",
        } satisfies GmailMessage;
      } catch {
        return null;
      }
    })
  );

  return messages.filter((m): m is GmailMessage => m !== null);
}

// Refresh access token and save to Supabase
export async function refreshAndSaveToken(sessionId: string, refreshToken: string): Promise<string | null> {
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  try {
    const { credentials } = await oauth2Client.refreshAccessToken();
    const newAccessToken = credentials.access_token;
    if (newAccessToken) {
      // Update in Supabase
      const supabase = getServiceClient();
      await supabase
        .from("gmail_tokens")
        .update({
          access_token: newAccessToken,
          expiry: credentials.expiry_date ? new Date(credentials.expiry_date).toISOString() : null,
        })
        .eq("session_id", sessionId);
    }
    return newAccessToken || null;
  } catch {
    return null;
  }
}
