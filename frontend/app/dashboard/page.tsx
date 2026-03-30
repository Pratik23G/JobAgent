"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState, useCallback } from "react";
import ResumeUploader from "@/components/ResumeUploader";

interface ClassifiedEmail {
  company: string;
  classification: string;
  subject: string;
  action: string;
  summary: string;
  date: string;
}

interface Application {
  id: string;
  job_title: string;
  company: string;
  job_url: string;
  status: string;
  applied_at: string;
  last_updated: string;
  cover_letter?: string;
  notes?: string;
}

interface AgentLog {
  id: string;
  command: string;
  action: string;
  created_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  ready: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  applied: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  interview: "bg-green-500/10 text-green-400 border-green-500/30",
  offer: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  rejected: "bg-red-500/10 text-red-400 border-red-500/30",
  ghosted: "bg-gray-500/10 text-gray-400 border-gray-500/30",
};

export default function DashboardOverview() {
  const { data: session } = useSession();
  const [applications, setApplications] = useState<Application[]>([]);
  const [recentLogs, setRecentLogs] = useState<AgentLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailEmail, setGmailEmail] = useState("");
  const [gmailAuthUrl, setGmailAuthUrl] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState<ClassifiedEmail[]>([]);
  const [upgrading, setUpgrading] = useState(false);
  const [usageData, setUsageData] = useState<{
    usage: Record<string, { used: number; limit: number; remaining: number }>;
    tier: string;
    resetsAt: string;
  } | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const sessionId = localStorage.getItem("jobagent_session_id") || "";
      const res = await fetch(`/api/dashboard?sessionId=${sessionId}`);
      const data = await res.json();
      setApplications(data.applications || []);
      setRecentLogs(data.logs || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    // Fetch usage data
    const sid = localStorage.getItem("jobagent_session_id") || "";
    if (sid) {
      fetch(`/api/usage?sessionId=${sid}`)
        .then((r) => r.json())
        .then((data) => { if (data.usage) setUsageData(data); })
        .catch(() => {});
    }
  }, [fetchData]);

  // Check Gmail connection status
  useEffect(() => {
    const sid = localStorage.getItem("jobagent_session_id") || "";
    if (!sid) return;
    fetch(`/api/gmail?sessionId=${sid}`)
      .then((r) => r.json())
      .then((data) => {
        setGmailConnected(data.connected);
        if (data.connected) setGmailEmail(data.email || "");
        if (data.authUrl) setGmailAuthUrl(data.authUrl);
      })
      .catch(() => {});
  }, []);

  const scanGmail = async () => {
    setScanning(true);
    setScanResults([]);
    try {
      const sessionId = localStorage.getItem("jobagent_session_id") || "";
      const res = await fetch("/api/gmail/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const data = await res.json();
      if (data.classified) {
        setScanResults(data.classified);
      }
      // Refresh applications after scan (statuses may have changed)
      fetchData();
    } catch {
      // ignore
    } finally {
      setScanning(false);
    }
  };

  const handleUpgrade = async () => {
    setUpgrading(true);
    try {
      const sid = localStorage.getItem("jobagent_session_id") || "";
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sid }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch {
      // ignore
    } finally {
      setUpgrading(false);
    }
  };

  // Check if any usage is at 80%+ (for warning banner)
  const usageWarning = usageData && usageData.tier === "free"
    ? Object.entries(usageData.usage).find(
        ([, v]) => v.limit > 0 && v.used / v.limit >= 0.8
      )
    : null;

  const ready = applications.filter((a) => a.status === "ready").length;
  const applied = applications.filter((a) => a.status === "applied").length;
  const interviews = applications.filter((a) => a.status === "interview").length;
  const offers = applications.filter((a) => a.status === "offer").length;
  const responded = applications.filter(
    (a) => a.status !== "applied" && a.status !== "ready" && a.status !== "ghosted"
  ).length;
  const responseRate = applied > 0 ? `${Math.round((responded / applied) * 100)}%` : "\u2014";

  const statCards = [
    { label: "Ready to Apply", value: String(ready), color: "text-yellow-400" },
    { label: "Applied", value: String(applied), color: "text-accent" },
    { label: "Interviews", value: String(interviews), color: "text-info" },
    { label: "Offers", value: String(offers), color: "text-warning" },
    { label: "Response Rate", value: responseRate, color: "text-muted" },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">
          Welcome back, {session?.user?.name?.split(" ")[0] ?? "there"}
        </h1>
        <p className="mt-1 text-muted">
          Here&apos;s your job search overview.
        </p>
      </div>

      {/* Usage Warning Banner */}
      {usageWarning && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-4 flex items-center justify-between">
          <p className="text-sm text-yellow-200">
            You&apos;ve used {usageWarning[1].used}/{usageWarning[1].limit} daily{" "}
            {usageWarning[0].replace(/_/g, " ")}s — upgrade to Pro for higher limits.
          </p>
          <button
            onClick={handleUpgrade}
            disabled={upgrading}
            className="shrink-0 ml-4 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-background transition hover:bg-accent/90 disabled:opacity-50"
          >
            {upgrading ? "..." : "Upgrade to Pro — $9.99/mo"}
          </button>
        </div>
      )}

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((s) => (
          <div key={s.label} className="glass-card p-5">
            <p className="text-sm text-muted">{s.label}</p>
            <p className={`mt-1 text-3xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Daily Usage */}
      {usageData && (
        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Daily Usage</h2>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted">
                {usageData.tier === "pro" ? (
                  <span className="text-accent font-medium">Pro</span>
                ) : "Free"} tier · Resets at midnight UTC
              </span>
              {usageData.tier === "free" && (
                <button
                  onClick={handleUpgrade}
                  disabled={upgrading}
                  className="rounded-md bg-accent/10 border border-accent/30 px-3 py-1 text-xs font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50"
                >
                  Upgrade to Pro
                </button>
              )}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[
              { key: "agent_message", label: "AI Messages" },
              { key: "job_search", label: "Job Searches" },
              { key: "cover_letter", label: "Cover Letters" },
              { key: "email_sent", label: "Emails Sent" },
              { key: "gmail_scan", label: "Gmail Scans" },
            ].map(({ key, label }) => {
              const u = usageData.usage[key] || { used: 0, limit: 0, remaining: 0 };
              const pct = u.limit > 0 ? (u.used / u.limit) * 100 : 0;
              return (
                <div key={key} className="rounded-lg border border-card-border p-3">
                  <p className="text-xs text-muted mb-1">{label}</p>
                  <p className="text-sm font-semibold">
                    <span className={pct >= 100 ? "text-red-400" : pct >= 80 ? "text-yellow-400" : "text-foreground"}>
                      {u.used}
                    </span>
                    <span className="text-muted font-normal"> / {u.limit}</span>
                  </p>
                  <div className="mt-1.5 h-1.5 rounded-full bg-gray-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-yellow-500" : "bg-accent"
                      }`}
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Applications table */}
      {applications.length > 0 && (
        <div className="glass-card p-6">
          <h2 className="mb-4 text-lg font-semibold">Applications ({applications.length})</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-card-border text-left text-xs text-muted uppercase tracking-wider">
                  <th className="pb-3 pr-4">Company</th>
                  <th className="pb-3 pr-4">Role</th>
                  <th className="pb-3 pr-4">Status</th>
                  <th className="pb-3 pr-4">Applied</th>
                  <th className="pb-3">Link</th>
                </tr>
              </thead>
              <tbody>
                {applications.map((app) => (
                  <tr key={app.id} className="border-b border-card-border/50">
                    <td className="py-3 pr-4 font-medium text-foreground">{app.company}</td>
                    <td className="py-3 pr-4 text-muted">{app.job_title}</td>
                    <td className="py-3 pr-4">
                      <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[app.status] || STATUS_COLORS.applied}`}>
                        {app.status}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-xs text-muted">
                      {new Date(app.applied_at).toLocaleDateString()}
                    </td>
                    <td className="py-3">
                      {app.job_url && (
                        <a
                          href={app.job_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-accent hover:underline"
                        >
                          Open
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Gmail Integration */}
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Email Tracking</h2>
          {gmailConnected ? (
            <div className="flex items-center gap-3">
              <span className="text-xs text-green-400 flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-green-400" />
                {gmailEmail || "Gmail connected"}
              </span>
              <button
                onClick={scanGmail}
                disabled={scanning}
                className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-background transition hover:bg-accent/90 disabled:opacity-50"
              >
                {scanning ? "Scanning..." : "Scan Inbox for Replies"}
              </button>
            </div>
          ) : (
            <a
              href={gmailAuthUrl}
              className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-background transition hover:bg-accent/90"
            >
              Connect Gmail
            </a>
          )}
        </div>

        {!gmailConnected && (
          <p className="text-sm text-muted">
            Connect your Gmail to automatically detect application confirmations, interview invitations, and rejections.
          </p>
        )}

        {/* Scan Results */}
        {scanResults.length > 0 && (
          <div className="space-y-2 mt-3">
            <p className="text-xs text-muted uppercase tracking-wider font-medium">
              Scan Results ({scanResults.length} job-related emails)
            </p>
            {scanResults.map((email, i) => (
              <div key={i} className="flex items-start justify-between rounded-lg border border-card-border p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{email.company || "Unknown"}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                      email.classification === "interview_invitation" ? "bg-green-500/10 text-green-400 border-green-500/30" :
                      email.classification === "offer" ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/30" :
                      email.classification === "rejection" ? "bg-red-500/10 text-red-400 border-red-500/30" :
                      "bg-blue-500/10 text-blue-400 border-blue-500/30"
                    }`}>
                      {email.classification.replace(/_/g, " ")}
                    </span>
                  </div>
                  <p className="text-xs text-muted mt-0.5">{email.summary}</p>
                  {email.action !== "none" && (
                    <p className="text-xs text-accent mt-0.5">Action: {email.action.replace(/_/g, " ")}</p>
                  )}
                </div>
                <p className="text-xs text-muted ml-3 shrink-0">
                  {email.date ? new Date(email.date).toLocaleDateString() : ""}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Resume upload */}
      <div className="glass-card p-6">
        <h2 className="mb-4 text-lg font-semibold">Resume</h2>
        <ResumeUploader />
      </div>

      {/* Recent activity */}
      <div className="glass-card p-6">
        <h2 className="mb-4 text-lg font-semibold">Recent Agent Activity</h2>
        {loading ? (
          <p className="text-sm text-muted">Loading...</p>
        ) : recentLogs.length === 0 ? (
          <p className="text-sm text-muted">
            No activity yet. Head to the Agent tab and give your first voice command.
          </p>
        ) : (
          <div className="space-y-3">
            {recentLogs.map((log) => (
              <div
                key={log.id}
                className="flex items-start justify-between rounded-lg border border-card-border p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-mono text-accent truncate">
                    {log.command}
                  </p>
                  <p className="mt-0.5 text-xs text-muted line-clamp-2">
                    {log.action}
                  </p>
                </div>
                <p className="ml-3 shrink-0 text-xs text-muted">
                  {new Date(log.created_at).toLocaleTimeString()}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
