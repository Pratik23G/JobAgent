// POST /api/gmail/scan — Scan Gmail for job-related emails, classify them,
// and update application statuses in the database.
//
// Uses Claude to classify each email and match it to existing applications.

import { fetchRecentEmails, refreshAccessToken } from "@/lib/gmail";
import { getServiceClient } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";

const TOKEN_FILE = join(process.cwd(), ".gmail-tokens.json");
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
      content: `Classify these emails related to job applications. I have applied to these companies: ${knownCompanies.join(", ") || "unknown"}.

For each email, determine:
1. classification: one of "application_confirmation", "interview_invitation", "rejection", "offer", "follow_up_request", "recruiter_outreach", "irrelevant"
2. company: which company sent it (match to known companies if possible)
3. jobTitle: the job title if mentioned
4. action: what the user should do ("schedule_interview", "respond", "accept_offer", "none", "follow_up")
5. confidence: 0-100 how confident you are
6. summary: 1-sentence summary

Return ONLY a JSON array:
[{"index": 0, "classification": "...", "company": "...", "jobTitle": "...", "action": "...", "confidence": 85, "summary": "..."}]

Emails:
${emailSummaries}

Return ONLY valid JSON array. Skip irrelevant emails (spam, newsletters, etc.) — mark them as "irrelevant" with confidence 100.`,
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

// Map email classification to application status
function classificationToStatus(classification: string): string | null {
  switch (classification) {
    case "interview_invitation": return "interview";
    case "rejection": return "rejected";
    case "offer": return "offer";
    case "application_confirmation": return "applied"; // Keep as applied
    default: return null;
  }
}

export async function POST(request: Request) {
  const { sessionId } = await request.json();

  // Load Gmail tokens
  let tokens;
  try {
    const raw = await readFile(TOKEN_FILE, "utf-8");
    tokens = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Gmail not connected" }, { status: 401 });
  }

  if (!tokens.access_token) {
    return Response.json({ error: "No access token" }, { status: 401 });
  }

  const supabase = getServiceClient();
  const userId = sessionId ? `anon_${sessionId}` : "";

  // Get known companies from applications
  let knownCompanies: string[] = [];
  if (userId) {
    const { data: apps } = await supabase
      .from("applications")
      .select("company")
      .eq("user_id", userId);
    knownCompanies = [...new Set((apps || []).map((a) => a.company).filter(Boolean))];
  } else {
    const { data: apps } = await supabase
      .from("applications")
      .select("company")
      .order("applied_at", { ascending: false })
      .limit(50);
    knownCompanies = [...new Set((apps || []).map((a) => a.company).filter(Boolean))];
  }

  // Fetch recent emails
  let emails;
  try {
    emails = await fetchRecentEmails(tokens.access_token, tokens.refresh_token);
  } catch (err: unknown) {
    // Try refresh
    if (tokens.refresh_token) {
      const newToken = await refreshAccessToken(tokens.refresh_token);
      if (newToken) {
        tokens.access_token = newToken;
        await writeFile(TOKEN_FILE, JSON.stringify(tokens), "utf-8");
        emails = await fetchRecentEmails(newToken, tokens.refresh_token);
      } else {
        return Response.json({ error: "Token refresh failed" }, { status: 401 });
      }
    } else {
      return Response.json({ error: "Gmail fetch failed: " + String(err) }, { status: 500 });
    }
  }

  if (!emails || emails.length === 0) {
    return Response.json({ classified: [], message: "No job-related emails found" });
  }

  // Classify with Claude
  const classified = await classifyEmails(emails, knownCompanies);

  // Update application statuses and save email replies
  let updated = 0;
  for (const email of classified) {
    const newStatus = classificationToStatus(email.classification);

    // Try to match to existing application
    if (email.company && userId) {
      const { data: matchedApps } = await supabase
        .from("applications")
        .select("id, status")
        .eq("user_id", userId)
        .ilike("company", `%${email.company}%`)
        .limit(1);

      const app = matchedApps?.[0];

      if (app && newStatus && newStatus !== app.status) {
        await supabase
          .from("applications")
          .update({ status: newStatus, last_updated: new Date().toISOString(), notes: email.summary })
          .eq("id", app.id);
        updated++;
      }

      // Save to email_replies
      await supabase.from("email_replies").insert({
        user_id: userId,
        from_email: email.fromEmail,
        from_name: email.from,
        subject: email.subject,
        body: email.summary,
        received_at: email.date ? new Date(email.date).toISOString() : new Date().toISOString(),
        linked_application_id: app?.id || null,
      });
    }
  }

  return Response.json({
    classified,
    totalEmails: emails.length,
    jobRelated: classified.length,
    statusesUpdated: updated,
    companies: knownCompanies,
  });
}
