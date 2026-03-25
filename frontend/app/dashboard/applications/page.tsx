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

interface ApplyPack {
  id: string;
  application_id: string | null;
  job_title: string;
  company: string;
  job_url: string | null;
  cover_letter: string | null;
  resume_bullets: string | null;
  why_good_fit: string | null;
  common_answers: Record<string, string> | null;
  outreach_email: string | null;
  source: string | null;
  created_at: string;
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

function PackSection({ label, text }: { label: string; text: string | null }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <div className="border-t border-card-border/50 pt-2">
      <div className="flex items-center justify-between">
        <button onClick={() => setOpen(!open)} className="text-xs font-medium text-muted hover:text-accent">
          {open ? "▾" : "▸"} {label}
        </button>
        <CopyBtn text={text} />
      </div>
      {open && (
        <pre className="mt-1 whitespace-pre-wrap font-mono text-xs text-foreground/80 bg-background/50 rounded p-2">
          {text}
        </pre>
      )}
    </div>
  );
}

export default function ApplicationsPage() {
  const { data: session } = useSession();
  const [applications, setApplications] = useState<Application[]>([]);
  const [applyPacks, setApplyPacks] = useState<Record<string, ApplyPack>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchApplications = useCallback(async () => {
    if (!session?.user) {
      setLoading(false);
      return;
    }
    const userId = (session.user as { id?: string }).id;
    if (!userId) {
      setLoading(false);
      return;
    }

    const supabase = getSupabase();

    // Fetch applications and apply packs in parallel
    let appQuery = supabase
      .from("applications")
      .select("*")
      .eq("user_id", userId)
      .order("applied_at", { ascending: false });

    if (filter !== "all") {
      appQuery = appQuery.eq("status", filter);
    }

    const [appsRes, packsRes] = await Promise.all([
      appQuery,
      supabase
        .from("apply_packs")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),
    ]);

    setApplications(appsRes.data || []);

    // Index packs by application_id for quick lookup
    const packMap: Record<string, ApplyPack> = {};
    for (const pack of (packsRes.data || []) as ApplyPack[]) {
      if (pack.application_id) {
        packMap[pack.application_id] = pack;
      }
    }
    setApplyPacks(packMap);
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
        <div className="space-y-3">
          {applications.map((app) => {
            const pack = applyPacks[app.id];
            const isExpanded = expandedId === app.id;

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
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm truncate">{app.company}</p>
                      {pack && (
                        <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-xs text-accent">
                          Apply Pack
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted truncate">{app.job_title}</p>
                  </div>

                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColors[app.status] ?? ""}`}
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
                    {["applied", "interview", "offer", "rejected", "ghosted"].map(
                      (s) => (
                        <option key={s} value={s}>{s}</option>
                      )
                    )}
                  </select>

                  {app.job_url && (
                    <a
                      href={app.job_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-background hover:bg-accent/90 transition"
                    >
                      Apply
                    </a>
                  )}

                  <span className="shrink-0 text-muted text-xs">
                    {isExpanded ? "▾" : "▸"}
                  </span>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t border-card-border bg-card/30 px-4 py-4 space-y-3">
                    {/* Notes */}
                    {app.notes && (
                      <p className="text-xs text-muted">{app.notes}</p>
                    )}

                    {/* Apply Pack materials */}
                    {pack ? (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-accent uppercase tracking-wider">
                          Application Materials
                        </p>
                        {pack.why_good_fit && (
                          <p className="text-xs text-foreground/80 italic">
                            {pack.why_good_fit}
                          </p>
                        )}
                        <PackSection label="Cover Letter" text={pack.cover_letter} />
                        <PackSection label="Tailored Resume Bullets" text={pack.resume_bullets} />
                        <PackSection label="Outreach Email" text={pack.outreach_email} />
                        {pack.common_answers && Object.keys(pack.common_answers).length > 0 && (
                          <div className="border-t border-card-border/50 pt-2">
                            <p className="text-xs font-medium text-muted mb-1">Common Q&A</p>
                            {Object.entries(pack.common_answers).map(([q, a]) => (
                              <div key={q} className="mb-1.5 flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="text-xs text-accent">
                                    {q.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                                  </p>
                                  <p className="text-xs text-foreground/80">{a}</p>
                                </div>
                                <CopyBtn text={a} />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : app.cover_letter ? (
                      <div>
                        <p className="text-xs text-muted mb-1">Cover Letter:</p>
                        <pre className="whitespace-pre-wrap font-mono text-xs text-foreground/80 bg-background/50 rounded p-3">
                          {app.cover_letter}
                        </pre>
                      </div>
                    ) : (
                      <p className="text-xs text-muted italic">
                        No application materials generated. Use the Agent to generate an apply pack for this job.
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
