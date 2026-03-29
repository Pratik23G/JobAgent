import { getServiceClient } from "@/lib/db";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

// ─── Application Queue API ──────────────────────────────────────────────────
// GET: List queued applications with filtering
// POST: Batch approve/reject actions

export async function GET(request: Request) {
  const supabase = getServiceClient();
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status"); // pending_fill, filled, pending_review, approved, submitted, failed
  const sessionId = searchParams.get("sessionId");

  // Get user ID from session or sessionId
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string })?.id || (sessionId ? `anon_${sessionId}` : null);

  if (!userId) {
    return Response.json({ error: "No user session" }, { status: 401 });
  }

  let query = supabase
    .from("application_queue")
    .select(`
      id, user_id, application_id, apply_pack_id, job_url, job_title, company,
      match_score, status, form_snapshot, fields_filled, fields_total,
      fields_needing_human, resume_uploaded, auto_fill_attempted_at,
      reviewed_at, submitted_at, error_message, created_at
    `)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query.limit(50);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ items: data || [], total: data?.length || 0 });
}

export async function POST(request: Request) {
  const supabase = getServiceClient();
  const body = await request.json();
  const { action, queue_ids, sessionId } = body as {
    action: "approve_all" | "reject_all";
    queue_ids?: string[];
    sessionId?: string;
  };

  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string })?.id || (sessionId ? `anon_${sessionId}` : null);

  if (!userId) {
    return Response.json({ error: "No user session" }, { status: 401 });
  }

  if (action === "approve_all") {
    // Approve all pending_review items (or specific IDs)
    let query = supabase
      .from("application_queue")
      .update({ status: "approved", reviewed_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("status", "pending_review");

    if (queue_ids?.length) {
      query = query.in("id", queue_ids);
    }

    const { data, error } = await query.select("id");
    if (error) return Response.json({ error: error.message }, { status: 500 });

    return Response.json({ success: true, approved: data?.length || 0 });
  }

  if (action === "reject_all") {
    let query = supabase
      .from("application_queue")
      .update({ status: "rejected", reviewed_at: new Date().toISOString() })
      .eq("user_id", userId)
      .in("status", ["pending_fill", "filled", "pending_review"]);

    if (queue_ids?.length) {
      query = query.in("id", queue_ids);
    }

    const { data, error } = await query.select("id");
    if (error) return Response.json({ error: error.message }, { status: 500 });

    return Response.json({ success: true, rejected: data?.length || 0 });
  }

  return Response.json({ error: "Invalid action" }, { status: 400 });
}
