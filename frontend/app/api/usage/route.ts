import { getUserUsage } from "@/lib/usage";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");

  if (!sessionId) {
    return Response.json({ error: "Missing sessionId" }, { status: 400 });
  }

  const userId = `anon_${sessionId}`;
  const data = await getUserUsage(userId);
  const isPro = data.tier === "pro";

  // Formatted response matching dashboard widget expectations
  return Response.json({
    searches: {
      used: data.usage.job_search.used,
      limit: isPro ? null : data.usage.job_search.limit,
      remaining: isPro ? null : data.usage.job_search.remaining,
    },
    coverLetters: {
      used: data.usage.cover_letter.used,
      limit: isPro ? null : data.usage.cover_letter.limit,
      remaining: isPro ? null : data.usage.cover_letter.remaining,
    },
    emails: {
      used: data.usage.email_sent.used,
      limit: isPro ? null : data.usage.email_sent.limit,
      remaining: isPro ? null : data.usage.email_sent.remaining,
    },
    gmailScans: {
      used: data.usage.gmail_scan.used,
      limit: isPro ? null : data.usage.gmail_scan.limit,
      remaining: isPro ? null : data.usage.gmail_scan.remaining,
    },
    agentMessages: {
      used: data.usage.agent_message.used,
      limit: isPro ? null : data.usage.agent_message.limit,
      remaining: isPro ? null : data.usage.agent_message.remaining,
    },
    resetsAt: data.resetsAt,
    isPro,
    // Also pass raw data for backward compat
    usage: data.usage,
    tier: data.tier,
  });
}
