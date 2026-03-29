import { getServiceClient } from "@/lib/db";

export type AuditEventType =
  | "email.sent"
  | "application.created"
  | "application.status_changed"
  | "resume.uploaded"
  | "cron.triggered"
  | "data.deleted"
  | "auth.login"
  | "auth.failed";

export interface AuditEvent {
  eventType: AuditEventType;
  actorId: string;
  actorIp?: string;
  resourceType?: string;
  resourceId?: string;
  outcome: "success" | "failure";
  metadata?: Record<string, unknown>;
}

export async function auditLog(event: AuditEvent): Promise<void> {
  try {
    const supabase = getServiceClient();
    await supabase.from("audit_logs").insert({
      event_type: event.eventType,
      actor_id: event.actorId,
      actor_ip: event.actorIp || null,
      resource_type: event.resourceType || null,
      resource_id: event.resourceId || null,
      outcome: event.outcome,
      metadata: event.metadata || {},
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    // Audit logging should never break the main flow
    console.error("[audit-log] Failed to write:", err instanceof Error ? err.message : String(err));
  }
}

export function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
