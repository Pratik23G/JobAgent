import { getServiceClient } from "@/lib/db";

// ─── Fill Result Endpoint ───────────────────────────────────────────────────
// Called by the Chrome extension after auto-filling a form (fill_only mode)
// Updates the queue item with fill results and form snapshot

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = getServiceClient();
  const body = await request.json();

  const {
    success,
    fields_filled,
    fields_total,
    resume_uploaded,
    form_snapshot,
    error,
  } = body as {
    success: boolean;
    fields_filled?: number;
    fields_total?: number;
    resume_uploaded?: boolean;
    form_snapshot?: Record<string, unknown>;
    error?: string;
    tab_id?: number;
  };

  if (success) {
    // Determine if any fields need human attention
    const fieldsNeedingHuman: { field_name: string; reason: string }[] = [];
    if (form_snapshot?.fields && Array.isArray(form_snapshot.fields)) {
      for (const field of form_snapshot.fields as { label: string; required: boolean; filled: boolean }[]) {
        if (field.required && !field.filled) {
          fieldsNeedingHuman.push({
            field_name: field.label || "Unknown",
            reason: "Required field not auto-filled",
          });
        }
      }
    }

    await supabase
      .from("application_queue")
      .update({
        status: fieldsNeedingHuman.length > 0 ? "filled" : "pending_review",
        fields_filled: fields_filled || 0,
        fields_total: fields_total || 0,
        resume_uploaded: resume_uploaded || false,
        form_snapshot: form_snapshot || null,
        fields_needing_human: fieldsNeedingHuman.length > 0 ? fieldsNeedingHuman : null,
        auto_fill_attempted_at: new Date().toISOString(),
      })
      .eq("id", id);

    return Response.json({
      success: true,
      status: fieldsNeedingHuman.length > 0 ? "filled" : "pending_review",
      needs_human_review: fieldsNeedingHuman.length > 0,
      fields_needing_human: fieldsNeedingHuman,
    });
  } else {
    // Fill failed
    await supabase
      .from("application_queue")
      .update({
        status: "failed",
        error_message: error || "Auto-fill failed",
        auto_fill_attempted_at: new Date().toISOString(),
      })
      .eq("id", id);

    return Response.json({ success: false, error: error || "Fill failed" });
  }
}
