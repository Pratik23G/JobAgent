"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState, useCallback } from "react";
import { getSupabase } from "@/lib/db";

const statusColors: Record<string, string> = {
  applied: "bg-info/20 text-info",
  interview: "bg-accent/20 text-accent",
  offer: "bg-warning/20 text-warning",
  rejected: "bg-danger/20 text-danger",
  ghosted: "bg-muted/20 text-muted",
};

interface Application {
  id: string;
  company: string;
  job_title: string;
  status: string;
  applied_at: string;
  job_url: string | null;
  cover_letter: string | null;
  notes: string | null;
}

export default function ApplicationsPage() {
  const { data: session } = useSession();
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchApplications = useCallback(async () => {
    if (!session?.user) return;
    const userId = (session.user as { id?: string }).id;
    if (!userId) return;

    const supabase = getSupabase();
    let query = supabase
      .from("applications")
      .select("*")
      .eq("user_id", userId)
      .order("applied_at", { ascending: false });

    if (filter !== "all") {
      query = query.eq("status", filter);
    }

    const { data } = await query;
    setApplications(data || []);
    setLoading(false);
  }, [session, filter]);

  useEffect(() => {
    fetchApplications();
  }, [fetchApplications]);

  const updateStatus = async (id: string, newStatus: string) => {
    const supabase = getSupabase();
    await supabase
      .from("applications")
      .update({ status: newStatus, last_updated: new Date().toISOString() })
      .eq("id", id);
    fetchApplications();
  };

  const filters = ["all", "applied", "interview", "offer", "rejected", "ghosted"];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Applications</h1>

      {/* Filter tabs */}
      <div className="flex gap-2">
        {filters.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition ${
              filter === f
                ? "bg-accent text-background"
                : "border border-card-border text-muted hover:text-foreground"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="glass-card p-12 text-center">
          <p className="text-muted animate-pulse">Loading applications...</p>
        </div>
      ) : applications.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <p className="text-lg text-muted">No applications yet.</p>
          <p className="mt-1 text-sm text-muted">
            Use the Agent to start applying to jobs.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-card-border">
          <table className="w-full text-sm">
            <thead className="border-b border-card-border bg-card">
              <tr>
                <th className="px-4 py-3 text-left text-muted font-medium">Company</th>
                <th className="px-4 py-3 text-left text-muted font-medium">Role</th>
                <th className="px-4 py-3 text-left text-muted font-medium">Status</th>
                <th className="px-4 py-3 text-left text-muted font-medium">Applied</th>
                <th className="px-4 py-3 text-left text-muted font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {applications.map((app) => (
                <>
                  <tr
                    key={app.id}
                    className="hover:bg-card/50 cursor-pointer"
                    onClick={() =>
                      setExpandedId(expandedId === app.id ? null : app.id)
                    }
                  >
                    <td className="px-4 py-3 font-medium">{app.company}</td>
                    <td className="px-4 py-3">{app.job_title}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColors[app.status] ?? ""}`}
                      >
                        {app.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {new Date(app.applied_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        className="rounded border border-card-border bg-background px-2 py-1 text-xs text-foreground"
                        value={app.status}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => updateStatus(app.id, e.target.value)}
                      >
                        {["applied", "interview", "offer", "rejected", "ghosted"].map(
                          (s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          )
                        )}
                      </select>
                    </td>
                  </tr>
                  {expandedId === app.id && (
                    <tr key={`${app.id}-detail`}>
                      <td colSpan={5} className="bg-card/30 px-4 py-3">
                        <div className="space-y-2 text-sm">
                          {app.job_url && (
                            <p>
                              <span className="text-muted">URL:</span>{" "}
                              <a
                                href={app.job_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-accent hover:underline"
                              >
                                {app.job_url}
                              </a>
                            </p>
                          )}
                          {app.cover_letter && (
                            <div>
                              <p className="text-muted mb-1">Cover Letter:</p>
                              <pre className="whitespace-pre-wrap font-mono text-xs text-foreground/80 bg-background/50 rounded p-3">
                                {app.cover_letter}
                              </pre>
                            </div>
                          )}
                          {app.notes && (
                            <p>
                              <span className="text-muted">Notes:</span> {app.notes}
                            </p>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
