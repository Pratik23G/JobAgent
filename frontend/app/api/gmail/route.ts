// GET /api/gmail?sessionId=xxx — Check Gmail connection status for this user
// DELETE /api/gmail?sessionId=xxx — Disconnect Gmail for this user

import { getAuthUrl, getGmailTokens, deleteGmailTokens } from "@/lib/gmail";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");

  if (!sessionId) {
    return Response.json({ connected: false, error: "Missing sessionId" });
  }

  const tokens = await getGmailTokens(sessionId);

  if (tokens) {
    return Response.json({
      connected: true,
      email: tokens.gmail_email,
    });
  }

  const authUrl = getAuthUrl(sessionId);
  return Response.json({ connected: false, authUrl });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");

  if (!sessionId) {
    return Response.json({ error: "Missing sessionId" }, { status: 400 });
  }

  await deleteGmailTokens(sessionId);
  return Response.json({ success: true });
}
