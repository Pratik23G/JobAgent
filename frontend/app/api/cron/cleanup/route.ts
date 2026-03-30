import { getServiceClient } from "@/lib/db";
import { validateCronSecret } from "@/lib/cron-auth";
import { auditLog } from "@/lib/audit-log";

// ─── Data Retention Cleanup ────────────────────────────────────────────────
// Trigger via: GET /api/cron/cleanup?secret=YOUR_CRON_SECRET
// Run weekly. Deletes old data per SOC2 retention policy.

export async function GET(request: Request) {
  const authError = validateCronSecret(request);
  if (authError) return authError;

  const supabase = getServiceClient();
  const results: { table: string; deleted: number }[] = [];

  try {
    // Agent logs > 90 days
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const { count: logsDeleted } = await supabase
      .from("agent_logs")
      .delete({ count: "exact" })
      .lt("created_at", ninetyDaysAgo);
    results.push({ table: "agent_logs", deleted: logsDeleted || 0 });

    // Agent sessions > 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { count: sessionsDeleted } = await supabase
      .from("agent_sessions")
      .delete({ count: "exact" })
      .lt("updated_at", thirtyDaysAgo);
    results.push({ table: "agent_sessions", deleted: sessionsDeleted || 0 });

    // Terminal application_queue items > 30 days
    const { count: queueDeleted } = await supabase
      .from("application_queue")
      .delete({ count: "exact" })
      .in("status", ["failed", "rejected", "applied"])
      .lt("created_at", thirtyDaysAgo);
    results.push({ table: "application_queue", deleted: queueDeleted || 0 });

    // Audit logs > 1 year (SOC2 minimum retention)
    const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    const { count: auditDeleted } = await supabase
      .from("audit_logs")
      .delete({ count: "exact" })
      .lt("created_at", oneYearAgo);
    results.push({ table: "audit_logs", deleted: auditDeleted || 0 });

    // Usage tracking records > 30 days
    const { count: usageDeleted } = await supabase
      .from("usage_tracking")
      .delete({ count: "exact" })
      .lt("date", thirtyDaysAgo);
    results.push({ table: "usage_tracking", deleted: usageDeleted || 0 });

    const totalDeleted = results.reduce((sum, r) => sum + r.deleted, 0);

    await auditLog({
      eventType: "data.deleted",
      actorId: "system:cron",
      outcome: "success",
      metadata: { results, totalDeleted },
    });

    return Response.json({
      success: true,
      results,
      totalDeleted,
    });
  } catch (err) {
    console.error("[cleanup] Error:", err);
    return Response.json({ error: "Cleanup failed" }, { status: 500 });
  }
}
