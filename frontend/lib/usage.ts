import { getServiceClient } from "@/lib/db";

// ─── Action types and their daily limits ────────────────────────────────────

export type UsageAction =
  | "job_search"
  | "cover_letter"
  | "email_sent"
  | "gmail_scan"
  | "agent_message";

const FREE_LIMITS: Record<UsageAction, number> = {
  job_search: 10,
  cover_letter: 5,
  email_sent: 10,
  gmail_scan: 3,
  agent_message: 20,
};

const PRO_LIMITS: Record<UsageAction, number> = {
  job_search: 9999,   // unlimited
  cover_letter: 50,
  email_sent: 100,
  gmail_scan: 9999,   // unlimited
  agent_message: 200,
};

function getLimit(action: UsageAction, tier: "free" | "pro"): number {
  return tier === "pro" ? PRO_LIMITS[action] : FREE_LIMITS[action];
}

// ─── Get user tier ──────────────────────────────────────────────────────────

async function getUserTier(userId: string): Promise<"free" | "pro"> {
  const supabase = getServiceClient();
  const { data } = await supabase
    .from("resumes")
    .select("user_tier")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data?.user_tier as "free" | "pro") || "free";
}

// ─── Check and increment usage ──────────────────────────────────────────────

export async function checkAndIncrementUsage(
  userId: string,
  action: UsageAction
): Promise<{ allowed: boolean; used: number; limit: number; remaining: number }> {
  const supabase = getServiceClient();
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  const tier = await getUserTier(userId);
  const limit = getLimit(action, tier);

  // Try to get existing record for today
  const { data: existing } = await supabase
    .from("usage_tracking")
    .select("id, count")
    .eq("user_id", userId)
    .eq("action_type", action)
    .eq("date", today)
    .maybeSingle();

  if (existing) {
    if (existing.count >= limit) {
      return { allowed: false, used: existing.count, limit, remaining: 0 };
    }

    // Increment
    await supabase
      .from("usage_tracking")
      .update({ count: existing.count + 1, updated_at: new Date().toISOString() })
      .eq("id", existing.id);

    return {
      allowed: true,
      used: existing.count + 1,
      limit,
      remaining: limit - existing.count - 1,
    };
  }

  // Create new record for today
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);

  await supabase.from("usage_tracking").insert({
    user_id: userId,
    action_type: action,
    count: 1,
    date: today,
    reset_at: tomorrow.toISOString(),
  });

  return { allowed: true, used: 1, limit, remaining: limit - 1 };
}

// ─── Get all usage for a user (for dashboard) ───────────────────────────────

export async function getUserUsage(userId: string): Promise<{
  usage: Record<UsageAction, { used: number; limit: number; remaining: number }>;
  tier: "free" | "pro";
  resetsAt: string;
}> {
  const supabase = getServiceClient();
  const today = new Date().toISOString().split("T")[0];
  const tier = await getUserTier(userId);

  const { data: records } = await supabase
    .from("usage_tracking")
    .select("action_type, count")
    .eq("user_id", userId)
    .eq("date", today);

  const usageMap = new Map<string, number>();
  for (const r of records || []) {
    usageMap.set(r.action_type, r.count);
  }

  const actions: UsageAction[] = ["job_search", "cover_letter", "email_sent", "gmail_scan", "agent_message"];
  const usage = {} as Record<UsageAction, { used: number; limit: number; remaining: number }>;

  for (const action of actions) {
    const limit = getLimit(action, tier);
    const used = usageMap.get(action) || 0;
    usage[action] = { used, limit, remaining: Math.max(0, limit - used) };
  }

  // Reset time: next midnight UTC
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);

  return { usage, tier, resetsAt: tomorrow.toISOString() };
}

// ─── Usage exceeded response ────────────────────────────────────────────────

export function usageLimitResponse(action: UsageAction, used: number, limit: number): Response {
  const labels: Record<UsageAction, string> = {
    job_search: "job searches",
    cover_letter: "cover letters",
    email_sent: "emails",
    gmail_scan: "Gmail scans",
    agent_message: "AI messages",
  };

  return Response.json(
    {
      error: "Daily limit exceeded",
      message: `You've used all ${limit} daily ${labels[action]}. Limits reset at midnight UTC.`,
      used,
      limit,
      action,
    },
    { status: 429 }
  );
}
