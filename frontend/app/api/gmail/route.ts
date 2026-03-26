// GET /api/gmail — returns Gmail auth URL to start OAuth flow
// POST /api/gmail — stores tokens after OAuth callback

import { getAuthUrl } from "@/lib/gmail";
import { writeFile, readFile } from "fs/promises";
import { join } from "path";

const TOKEN_FILE = join(process.cwd(), ".gmail-tokens.json");

export async function GET() {
  // Check if already connected
  try {
    const raw = await readFile(TOKEN_FILE, "utf-8");
    const tokens = JSON.parse(raw);
    if (tokens.access_token) {
      return Response.json({ connected: true, email: tokens.email || "connected" });
    }
  } catch {
    // Not connected
  }

  const authUrl = getAuthUrl();
  return Response.json({ connected: false, authUrl });
}

export async function POST(request: Request) {
  const { tokens, email } = await request.json();

  await writeFile(TOKEN_FILE, JSON.stringify({ ...tokens, email }), "utf-8");

  return Response.json({ success: true });
}
