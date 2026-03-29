"use client";

import { useEffect, useState, useCallback } from "react";

interface QueueItem {
  id: string;
  application_id: string | null;
  apply_pack_id: string | null;
  job_url: string;
  job_title: string;
  company: string;
  match_score: number;
  status: string;
  form_snapshot: Record<string, unknown> | null;
  fields_filled: number;
  fields_total: number;
  fields_needing_human: { field_name: string; reason: string }[] | null;
  resume_uploaded: boolean;
  auto_fill_attempted_at: string | null;
  reviewed_at: string | null;
  submitted_at: string | null;
  error_message: string | null;
  created_at: string;
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending_fill: { label: "Pending Fill", color: "bg-gray-500/10 text-gray-400 border-gray-500/30" },
  filled: { label: "Filled (Needs Review)", color: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30" },
  pending_review: { label: "Ready for Approval", color: "bg-blue-500/10 text-blue-400 border-blue-500/30" },
  approved: { label: "Approved", color: "bg-green-500/10 text-green-400 border-green-500/30" },
  submitted: { label: "Submitted", color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" },
  failed: { label: "Failed", color: "bg-red-500/10 text-red-400 border-red-500/30" },
  rejected: { label: "Rejected", color: "bg-red-500/10 text-red-300 border-red-500/30" },
};

export default function QueueDashboard() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const sessionId = typeof window !== "undefined"
    ? localStorage.getItem("agent_session_id") || ""
    : "";

  const fetchQueue = useCallback(async () => {
    try {
      const statusParam = filter !== "all" ? `&status=${filter}` : "";
      const res = await fetch(`/api/queue?sessionId=${sessionId}${statusParam}`);
      const data = await res.json();
      setItems(data.items || []);
    } catch (err) {
      console.error("Failed to fetch queue:", err);
    } finally {
      setLoading(false);
    }
  }, [sessionId, filter]);

  useEffect(() => {
    fetchQueue();
    const interval = setInterval(fetchQueue, 10000); // Poll every 10s
    return () => clearInterval(interval);
  }, [fetchQueue]);

  async function handleAction(id: string, action: "approve" | "reject" | "retry") {
    setActionLoading(id);
    try {
      const res = await fetch(`/api/queue/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, sessionId }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchQueue();
      }
    } catch (err) {
      console.error(`Failed to ${action}:`, err);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleBatchAction(action: "approve_all" | "reject_all") {
    setActionLoading("batch");
    try {
      const res = await fetch("/api/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, sessionId }),
      });
      await res.json();
      await fetchQueue();
    } finally {
      setActionLoading(null);
    }
  }

  const pendingReviewCount = items.filter(i => i.status === "pending_review").length;
  const filledCount = items.filter(i => i.status === "filled").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Application Queue</h1>
          <p className="text-sm text-neutral-400 mt-1">
            Review and approve auto-filled job applications
          </p>
        </div>
        <div className="flex gap-2">
          {pendingReviewCount > 0 && (
            <button
              onClick={() => handleBatchAction("approve_all")}
              disabled={actionLoading === "batch"}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
            >
              Approve All ({pendingReviewCount})
            </button>
          )}
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 border-b border-neutral-800 pb-2">
        {[
          { key: "all", label: "All" },
          { key: "pending_review", label: `Ready (${pendingReviewCount})` },
          { key: "filled", label: `Needs Review (${filledCount})` },
          { key: "pending_fill", label: "Pending Fill" },
          { key: "approved", label: "Approved" },
          { key: "submitted", label: "Submitted" },
          { key: "failed", label: "Failed" },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              filter === tab.key
                ? "bg-indigo-500/20 text-indigo-400"
                : "text-neutral-400 hover:text-neutral-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Queue items */}
      {loading ? (
        <div className="text-center text-neutral-500 py-12">Loading queue...</div>
      ) : items.length === 0 ? (
        <div className="text-center text-neutral-500 py-12">
          <p className="text-lg">No items in queue</p>
          <p className="text-sm mt-2">
            The auto-apply pipeline will queue applications here when it finds matching jobs.
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {items.map(item => (
            <div
              key={item.id}
              className="bg-neutral-900 border border-neutral-800 rounded-xl p-5 hover:border-neutral-700 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="text-white font-semibold">{item.job_title}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_CONFIG[item.status]?.color || "text-neutral-400"}`}>
                      {STATUS_CONFIG[item.status]?.label || item.status}
                    </span>
                  </div>
                  <p className="text-neutral-400 text-sm">{item.company}</p>

                  <div className="flex items-center gap-4 mt-3 text-xs text-neutral-500">
                    <span className="flex items-center gap-1">
                      Score: <span className={`font-medium ${item.match_score >= 80 ? "text-green-400" : item.match_score >= 60 ? "text-yellow-400" : "text-red-400"}`}>{item.match_score}</span>
                    </span>
                    {item.fields_filled > 0 && (
                      <span>Fields: {item.fields_filled}/{item.fields_total}</span>
                    )}
                    {item.resume_uploaded && (
                      <span className="text-green-400">Resume uploaded</span>
                    )}
                    <span>{new Date(item.created_at).toLocaleDateString()}</span>
                  </div>

                  {/* Show fields needing human attention */}
                  {item.fields_needing_human && item.fields_needing_human.length > 0 && (
                    <div className="mt-3 p-2 bg-yellow-500/5 border border-yellow-500/20 rounded-lg">
                      <p className="text-xs text-yellow-400 font-medium mb-1">Fields needing attention:</p>
                      <ul className="text-xs text-yellow-300/70 space-y-0.5">
                        {item.fields_needing_human.map((f, i) => (
                          <li key={i}>{f.field_name} - {f.reason}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {item.error_message && (
                    <p className="mt-2 text-xs text-red-400">{item.error_message}</p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-2 ml-4">
                  {item.job_url && (
                    <a
                      href={item.job_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg"
                    >
                      Review
                    </a>
                  )}

                  {["filled", "pending_review"].includes(item.status) && (
                    <>
                      <button
                        onClick={() => handleAction(item.id, "approve")}
                        disabled={actionLoading === item.id}
                        className="px-3 py-1.5 text-xs bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-50"
                      >
                        {actionLoading === item.id ? "..." : "Approve"}
                      </button>
                      <button
                        onClick={() => handleAction(item.id, "reject")}
                        disabled={actionLoading === item.id}
                        className="px-3 py-1.5 text-xs bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </>
                  )}

                  {item.status === "failed" && (
                    <button
                      onClick={() => handleAction(item.id, "retry")}
                      disabled={actionLoading === item.id}
                      className="px-3 py-1.5 text-xs bg-yellow-600/20 hover:bg-yellow-600/30 text-yellow-400 rounded-lg disabled:opacity-50"
                    >
                      Retry
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
