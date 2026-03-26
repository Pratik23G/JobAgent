// GET /api/cron/gmail-scan — Auto-scan Gmail for all connected users
// Called periodically (every 30 min) by the frontend polling mechanism.
// Scans each session that has Gmail tokens and hasn't been scanned recently.

import { getServiceClient } from "@/lib/db";

export async function GET() {
  const supabase = getServiceClient();

  // Find all sessions with Gmail connected
  const { data: sessions } = await supabase
    .from("gmail_tokens")
    .select("session_id, gmail_email");

  if (!sessions || sessions.length === 0) {
    return Response.json({ message: "No Gmail connections found", scanned: 0 });
  }

  // Check which ones need scanning (not scanned in last 30 min)
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  let scanned = 0;
  for (const session of sessions) {
    // Check last scan time
    const { data: meta } = await supabase
      .from("scan_metadata")
      .select("last_scanned_at")
      .eq("session_id", session.session_id)
      .maybeSingle();

    if (meta?.last_scanned_at && meta.last_scanned_at > thirtyMinAgo) {
      continue; // Scanned recently, skip
    }

    // Trigger scan via internal API call
    try {
      const res = await fetch(`http://localhost:${process.env.PORT || 3000}/api/gmail/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.session_id }),
      });

      if (res.ok) scanned++;
    } catch {
      // Skip failed scans
    }
  }

  return Response.json({ message: `Scanned ${scanned} account(s)`, scanned });
}
