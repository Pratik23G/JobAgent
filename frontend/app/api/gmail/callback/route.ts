// GET /api/gmail/callback — OAuth2 callback from Google
// Exchanges auth code for tokens, gets user email, saves to Supabase per session.

import { getTokensFromCode, getOAuth2Client, saveGmailTokens } from "@/lib/gmail";
import { google } from "googleapis";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const sessionId = searchParams.get("state"); // sessionId passed via OAuth state param

  if (!code) {
    return new Response("Missing auth code", { status: 400 });
  }

  if (!sessionId) {
    return new Response("Missing session state — try connecting again from the dashboard", { status: 400 });
  }

  try {
    const tokens = await getTokensFromCode(code);

    // Get the authorized user's email address
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials(tokens);
    const gmail = google.gmail({ version: "v1", auth: oauth2Client });
    const profile = await gmail.users.getProfile({ userId: "me" });
    const email = profile.data.emailAddress || "unknown";

    // Save tokens to Supabase keyed by sessionId
    await saveGmailTokens(
      sessionId,
      email,
      tokens.access_token || "",
      tokens.refresh_token || null,
      tokens.expiry_date ? new Date(tokens.expiry_date) : null
    );

    // Redirect back to emails page
    return new Response(null, {
      status: 302,
      headers: { Location: "/dashboard/emails?gmail=connected" },
    });
  } catch (err) {
    console.error("Gmail OAuth error:", err);
    return new Response(
      `Gmail connection failed. Make sure http://localhost:3000/api/gmail/callback is in your Google Cloud Console authorized redirect URIs.\n\nError: ${String(err)}`,
      { status: 500 }
    );
  }
}
