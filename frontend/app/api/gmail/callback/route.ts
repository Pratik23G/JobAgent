// GET /api/gmail/callback — OAuth2 callback from Google
// Exchanges auth code for tokens and stores them

import { getTokensFromCode, getOAuth2Client } from "@/lib/gmail";
import { google } from "googleapis";
import { writeFile } from "fs/promises";
import { join } from "path";

const TOKEN_FILE = join(process.cwd(), ".gmail-tokens.json");

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return new Response("Missing auth code", { status: 400 });
  }

  try {
    const tokens = await getTokensFromCode(code);

    // Get user's email address
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials(tokens);
    const gmail = google.gmail({ version: "v1", auth: oauth2Client });
    const profile = await gmail.users.getProfile({ userId: "me" });
    const email = profile.data.emailAddress || "";

    // Store tokens
    await writeFile(TOKEN_FILE, JSON.stringify({ ...tokens, email }), "utf-8");

    // Redirect back to dashboard
    return new Response(null, {
      status: 302,
      headers: { Location: "/dashboard?gmail=connected" },
    });
  } catch (err) {
    console.error("Gmail OAuth error:", err);
    return new Response(`Gmail connection failed: ${String(err)}`, { status: 500 });
  }
}
