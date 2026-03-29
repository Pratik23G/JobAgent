import { getServiceClient } from "@/lib/db";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { extensionEvents } from "@/lib/events";

// ─── Single Queue Item API ──────────────────────────────────────────────────
// PATCH: Approve, reject, or update a queue item
// DELETE: Remove a queue item

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = getServiceClient();
  const body = await request.json();
  const { action, sessionId } = body as {
    action: "approve" | "reject" | "retry";
    sessionId?: string;
  };

  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string })?.id || (sessionId ? `anon_${sessionId}` : null);

  if (!userId) {
    return Response.json({ error: "No user session" }, { status: 401 });
  }

  // Verify ownership
  const { data: item } = await supabase
    .from("application_queue")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .single();

  if (!item) {
    return Response.json({ error: "Queue item not found" }, { status: 404 });
  }

  if (action === "approve") {
    // Update queue status
    await supabase
      .from("application_queue")
      .update({ status: "approved", reviewed_at: new Date().toISOString() })
      .eq("id", id);

    // Update application status
    if (item.application_id) {
      await supabase
        .from("applications")
        .update({ status: "ready" })
        .eq("id", item.application_id);
    }

    // Send submit_approved event to extension via SSE
    extensionEvents.publish(userId, {
      type: "submit_approved",
      data: {
        queueId: id,
        jobUrl: item.job_url,
        company: item.company,
        jobTitle: item.job_title,
        pack: {
          company: item.company,
          title: item.job_title,
        },
        filledCount: item.fields_filled || 0,
        resumeUploaded: item.resume_uploaded || false,
      },
    });

    // Also try to publish via sessionId (for anonymous users)
    if (sessionId) {
      extensionEvents.publish(sessionId, {
        type: "submit_approved",
        data: {
          queueId: id,
          jobUrl: item.job_url,
          company: item.company,
          jobTitle: item.job_title,
          pack: { company: item.company, title: item.job_title },
          filledCount: item.fields_filled || 0,
          resumeUploaded: item.resume_uploaded || false,
        },
      });
    }

    return Response.json({
      success: true,
      message: `Approved: ${item.job_title} at ${item.company}. The extension will submit the form.`,
    });
  }

  if (action === "reject") {
    await supabase
      .from("application_queue")
      .update({ status: "rejected", reviewed_at: new Date().toISOString() })
      .eq("id", id);

    if (item.application_id) {
      await supabase
        .from("applications")
        .update({ status: "rejected" })
        .eq("id", item.application_id);
    }

    return Response.json({ success: true, message: `Rejected: ${item.job_title} at ${item.company}` });
  }

  if (action === "retry") {
    await supabase
      .from("application_queue")
      .update({ status: "pending_fill", error_message: null, auto_fill_attempted_at: null })
      .eq("id", id);

    return Response.json({ success: true, message: `Retrying: ${item.job_title} at ${item.company}` });
  }

  return Response.json({ error: "Invalid action" }, { status: 400 });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = getServiceClient();
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");

  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string })?.id || (sessionId ? `anon_${sessionId}` : null);

  if (!userId) {
    return Response.json({ error: "No user session" }, { status: 401 });
  }

  const { error } = await supabase
    .from("application_queue")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}
