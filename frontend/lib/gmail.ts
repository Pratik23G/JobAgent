import { google } from "googleapis";

// Gmail OAuth2 configuration
// Requires: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (same as NextAuth)
// Additional: GMAIL_REDIRECT_URI (defaults to localhost callback)

const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

export function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI || "http://localhost:3000/api/gmail/callback"
  );
}

export function getAuthUrl(): string {
  const oauth2Client = getOAuth2Client();

  // login_hint directs Google to the correct account (e.g., work email, not login email)
  const targetEmail = process.env.GMAIL_TARGET_EMAIL;

  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
    ...(targetEmail ? { login_hint: targetEmail } : {}),
  });
}

export async function getTokensFromCode(code: string) {
  const oauth2Client = getOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

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

  // Search for job-related emails if no specific query
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

  // Fetch full messages in parallel
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

        // Extract body text
        let body = "";
        const payload = full.data.payload;

        if (payload?.body?.data) {
          body = Buffer.from(payload.body.data, "base64").toString("utf-8");
        } else if (payload?.parts) {
          // Look for text/plain or text/html part
          for (const part of payload.parts) {
            if (part.mimeType === "text/plain" && part.body?.data) {
              body = Buffer.from(part.body.data, "base64").toString("utf-8");
              break;
            }
            if (part.mimeType === "text/html" && part.body?.data && !body) {
              // Strip HTML tags for plain text
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
          body: body.slice(0, 2000), // Limit body size
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

// Refresh access token if expired
export async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  try {
    const { credentials } = await oauth2Client.refreshAccessToken();
    return credentials.access_token || null;
  } catch {
    return null;
  }
}
