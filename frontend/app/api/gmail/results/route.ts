// GET /api/gmail/results?sessionId=xxx — Fetch persisted scan results from DB
// Returns previously classified emails + last scan timestamp.

import { getServiceClient } from "@/lib/db";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");

  if (!sessionId) {
    return Response.json({ error: "Missing sessionId" }, { status: 400 });
  }

  const supabase = getServiceClient();

  const [scansRes, metaRes] = await Promise.all([
    supabase
      .from("email_scans")
      .select("*")
      .eq("session_id", sessionId)
      .order("received_at", { ascending: false })
      .limit(50),
    supabase
      .from("scan_metadata")
      .select("*")
      .eq("session_id", sessionId)
      .maybeSingle(),
  ]);

  // Deduplicate: keep most recent per company+classification
  const seen = new Map<string, (typeof results)[0]>();
  const results = (scansRes.data || []).map((s) => ({
    from: s.sender || "",
    fromEmail: s.sender_email || "",
    subject: s.raw_subject || "",
    date: s.received_at || "",
    classification: s.classification,
    company: s.company || "",
    jobTitle: s.role || "",
    action: s.action || "none",
    confidence: s.confidence || 0,
    summary: s.summary || "",
  }));

  // Dedup: one entry per company+classification, keep newest
  const deduped: typeof results = [];
  for (const r of results) {
    const key = `${(r.company || r.fromEmail).toLowerCase()}_${r.classification}`;
    if (!seen.has(key)) {
      seen.set(key, r);
      deduped.push(r);
    }
  }

  return Response.json({
    results: deduped,
    lastScannedAt: metaRes.data?.last_scanned_at || null,
    totalStored: scansRes.data?.length || 0,
  });
}
