"use client";

import { useEffect, useState, useCallback } from "react";

const statusColors: Record<string, string> = {
  applied: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  ready: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  interview: "bg-green-500/10 text-green-400 border-green-500/30",
  offer: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  rejected: "bg-red-500/10 text-red-400 border-red-500/30",
  ghosted: "bg-gray-500/10 text-gray-400 border-gray-500/30",
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

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="shrink-0 rounded border border-card-border px-2 py-0.5 text-xs text-muted hover:border-accent hover:text-accent transition"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

export default function ApplicationsPage() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [linkStatuses, setLinkStatuses] = useState<Record<string, "live" | "dead" | "checking">>({});

  const fetchApplications = useCallback(async () => {
    setLoading(true);
    try {
      const sessionId = localStorage.getItem("jobagent_session_id") || "";
      const res = await fetch(`/api/dashboard?sessionId=${sessionId}`);
      const data = await res.json();

      let apps = data.applications || [];
      if (filter !== "all") {
        apps = apps.filter((a: Application) => a.status === filter);
      }
      setApplications(apps);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchApplications();
  }, [fetchApplications]);

  // Check job link status
  const checkLink = async (id: string, url: string) => {
    setLinkStatuses((prev) => ({ ...prev, [id]: "checking" }));
    try {
      const res = await fetch(url, { method: "HEAD", mode: "no-cors" });
      // no-cors always returns opaque response, so we can't really check status
      // but if fetch doesn't throw, the domain is reachable
      setLinkStatuses((prev) => ({ ...prev, [id]: "live" }));
    } catch {
      setLinkStatuses((prev) => ({ ...prev, [id]: "dead" }));
    }
  };

  const updateStatus = async (id: string, newStatus: string) => {
    const sessionId = localStorage.getItem("jobagent_session_id") || "";
    await fetch("/api/dashboard/update-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: newStatus, sessionId }),
    });
    fetchApplications();
  };

  const filters = ["all", "ready", "applied", "interview", "offer", "rejected", "ghosted"];

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
        <div className="space-y-3">
          {applications.map((app) => {
            const isExpanded = expandedId === app.id;
            const linkStatus = linkStatuses[app.id];

            return (
              <div
                key={app.id}
                className="rounded-lg border border-card-border overflow-hidden"
              >
                {/* Main row */}
                <div
                  className="flex items-center gap-4 px-4 py-3 hover:bg-card/50 cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : app.id)}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm truncate">{app.company}</p>
                    <p className="text-xs text-muted truncate">{app.job_title}</p>
                  </div>

                  <span
                    className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusColors[app.status] ?? statusColors.applied}`}
                  >
                    {app.status}
                  </span>

                  <span className="shrink-0 text-xs text-muted w-20">
                    {new Date(app.applied_at).toLocaleDateString()}
                  </span>

                  <select
                    className="shrink-0 rounded border border-card-border bg-background px-2 py-1 text-xs text-foreground"
                    value={app.status}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => updateStatus(app.id, e.target.value)}
                  >
                    {["ready", "applied", "interview", "offer", "rejected", "ghosted"].map(
                      (s) => (
                        <option key={s} value={s}>{s}</option>
                      )
                    )}
                  </select>

                  {app.job_url ? (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <a
                        href={app.job_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-background hover:bg-accent/90 transition"
                      >
                        Apply
                      </a>
                      {/* Link status indicator */}
                      {linkStatus === "dead" && (
                        <span className="rounded-full bg-red-500/10 border border-red-500/30 px-2 py-0.5 text-xs text-red-400" title="This link may be expired">
                          expired
                        </span>
                      )}
                      {linkStatus === "checking" && (
                        <span className="text-xs text-muted animate-pulse">...</span>
                      )}
                      {!linkStatus && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            checkLink(app.id, app.job_url!);
                          }}
                          className="text-xs text-muted hover:text-accent"
                          title="Check if link is still active"
                        >
                          check
                        </button>
                      )}
                    </div>
                  ) : (
                    <span className="shrink-0 rounded-full bg-gray-500/10 border border-gray-500/30 px-2 py-0.5 text-xs text-gray-400">
                      no link
                    </span>
                  )}

                  <span className="shrink-0 text-muted text-xs">
                    {isExpanded ? "▾" : "▸"}
                  </span>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t border-card-border bg-card/30 px-4 py-4 space-y-3">
                    {app.notes && (
                      <p className="text-xs text-muted">{app.notes}</p>
                    )}
                    {app.cover_letter ? (
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-xs text-muted">Cover Letter:</p>
                          <CopyBtn text={app.cover_letter} />
                        </div>
                        <pre className="whitespace-pre-wrap font-mono text-xs text-foreground/80 bg-background/50 rounded p-3">
                          {app.cover_letter}
                        </pre>
                      </div>
                    ) : (
                      <p className="text-xs text-muted italic">
                        No cover letter saved. Use the Agent to generate an apply pack for this job.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
