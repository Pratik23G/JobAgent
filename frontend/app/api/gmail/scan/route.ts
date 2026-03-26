// POST /api/gmail/scan — Scan Gmail for job-related emails, classify with Claude,
// and update application statuses in the database.
// Per-user tokens from Supabase.

import { fetchRecentEmails, getGmailTokens, refreshAndSaveToken } from "@/lib/gmail";
import { getServiceClient } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

interface ClassifiedEmail {
  emailId: string;
  from: string;
  fromEmail: string;
  subject: string;
  date: string;
  classification: string;
  company: string;
  jobTitle: string;
  action: string;
  confidence: number;
  summary: string;
}

async function classifyEmails(
  emails: { from: string; fromEmail: string; subject: string; body: string; snippet: string; date: string; id: string }[],
  knownCompanies: string[]
): Promise<ClassifiedEmail[]> {
  if (emails.length === 0) return [];

  const emailSummaries = emails.map((e, i) =>
    `[${i}] From: ${e.from}\nSubject: ${e.subject}\nDate: ${e.date}\nSnippet: ${e.snippet}\nBody (first 500 chars): ${e.body.slice(0, 500)}`
  ).join("\n\n---\n\n");

  const resp = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    messages: [{
      role: "user",
      content: `Classify these emails related to job applications. Known companies I've applied to: ${knownCompanies.join(", ") || "unknown"}.

For each email, determine:
1. classification: "application_confirmation", "interview_invitation", "rejection", "offer", "follow_up_request", "recruiter_outreach", or "irrelevant"
2. company: which company sent it
3. jobTitle: the job title if mentioned
4. action: "schedule_interview", "respond", "accept_offer", "none", or "follow_up"
5. confidence: 0-100
6. summary: 1-sentence summary

Return ONLY a JSON array:
[{"index": 0, "classification": "...", "company": "...", "jobTitle": "...", "action": "...", "confidence": 85, "summary": "..."}]

Emails:
${emailSummaries}

Return ONLY valid JSON. Mark spam/newsletters/irrelevant as "irrelevant".`,
    }],
  });

  const text = resp.content[0].type === "text" ? resp.content[0].text : "[]";

  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const results: { index: number; classification: string; company: string; jobTitle: string; action: string; confidence: number; summary: string }[] = JSON.parse(jsonMatch[0]);

    return results
      .filter((r) => r.classification !== "irrelevant")
      .map((r) => ({
        emailId: emails[r.index]?.id || "",
        from: emails[r.index]?.from || "",
        fromEmail: emails[r.index]?.fromEmail || "",
        subject: emails[r.index]?.subject || "",
        date: emails[r.index]?.date || "",
        classification: r.classification,
        company: r.company,
        jobTitle: r.jobTitle,
        action: r.action,
        confidence: r.confidence,
        summary: r.summary,
      }));
  } catch {
    return [];
  }
}

function classificationToStatus(classification: string): string | null {
  switch (classification) {
    case "interview_invitation": return "interview";
    case "rejection": return "rejected";
    case "offer": return "offer";
    default: return null;
  }
}

export async function POST(request: Request) {
  const { sessionId } = await request.json();

  if (!sessionId) {
    return Response.json({ error: "Missing sessionId" }, { status: 400 });
  }

  // Get per-user Gmail tokens from Supabase
  const tokens = await getGmailTokens(sessionId);
  if (!tokens) {
    return Response.json({ error: "Gmail not connected", connected: false }, { status: 401 });
  }

  const supabase = getServiceClient();
  const userId = `anon_${sessionId}`;

  // Get known companies
  const { data: apps } = await supabase
    .from("applications")
    .select("company")
    .eq("user_id", userId);
  const knownCompanies = [...new Set((apps || []).map((a) => a.company).filter(Boolean))];

  // Fetch emails — handle token refresh
  let emails;
  try {
    emails = await fetchRecentEmails(tokens.access_token, tokens.refresh_token);
  } catch {
    if (tokens.refresh_token) {
      const newToken = await refreshAndSaveToken(sessionId, tokens.refresh_token);
      if (newToken) {
        emails = await fetchRecentEmails(newToken, tokens.refresh_token);
      } else {
        return Response.json({ error: "Token refresh failed. Reconnect Gmail.", connected: false }, { status: 401 });
      }
    } else {
      return Response.json({ error: "Gmail fetch failed. Reconnect Gmail.", connected: false }, { status: 500 });
    }
  }

  if (!emails || emails.length === 0) {
    // Still update scan metadata
    await supabase.from("scan_metadata").upsert({
      session_id: sessionId,
      last_scanned_at: new Date().toISOString(),
      emails_scanned: 0,
      job_related: 0,
      statuses_updated: 0,
    }, { onConflict: "session_id" });

    return Response.json({ classified: [], totalEmails: 0, jobRelated: 0, statusesUpdated: 0 });
  }

  // Classify with Claude
  const classified = await classifyEmails(emails, knownCompanies);

  // Update application statuses + persist scan results
  let updated = 0;
  for (const email of classified) {
    const newStatus = classificationToStatus(email.classification);
    let linkedAppId: string | null = null;

    if (email.company) {
      const { data: matchedApps } = await supabase
        .from("applications")
        .select("id, status")
        .eq("user_id", userId)
        .ilike("company", `%${email.company}%`)
        .limit(1);

      const app = matchedApps?.[0];
      linkedAppId = app?.id || null;

      if (app && newStatus && newStatus !== app.status) {
        await supabase
          .from("applications")
          .update({ status: newStatus, last_updated: new Date().toISOString(), notes: email.summary })
          .eq("id", app.id);
        updated++;
      }
    }

    // Persist to email_scans (upsert to deduplicate by sender_email + subject)
    const receivedAt = email.date ? new Date(email.date).toISOString() : new Date().toISOString();
    await supabase.from("email_scans").upsert({
      session_id: sessionId,
      sender: email.from,
      sender_email: email.fromEmail,
      raw_subject: email.subject,
      company: email.company || null,
      role: email.jobTitle || null,
      classification: email.classification,
      confidence: email.confidence,
      summary: email.summary,
      action: email.action,
      received_at: receivedAt,
      linked_application_id: linkedAppId,
    }, { onConflict: "session_id,sender_email,raw_subject" });
  }

  // Save scan metadata
  await supabase.from("scan_metadata").upsert({
    session_id: sessionId,
    last_scanned_at: new Date().toISOString(),
    emails_scanned: emails.length,
    job_related: classified.length,
    statuses_updated: updated,
  }, { onConflict: "session_id" });

  return Response.json({
    classified,
    totalEmails: emails.length,
    jobRelated: classified.length,
    statusesUpdated: updated,
  });
}
