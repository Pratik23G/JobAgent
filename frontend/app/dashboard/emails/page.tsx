"use client";

import { useEffect, useState, useCallback, useRef } from "react";

interface ClassifiedEmail {
  from: string;
  fromEmail: string;
  subject: string;
  date: string;
  classification: string;
  company: string;
  jobTitle: string;
  action: string;
  confidence: number;
  summary: string;
}

const CLASSIFICATION_STYLES: Record<string, string> = {
  interview_invitation: "bg-green-500/10 text-green-400 border-green-500/30",
  offer: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  rejection: "bg-red-500/10 text-red-400 border-red-500/30",
  application_confirmation: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  recruiter_outreach: "bg-purple-500/10 text-purple-400 border-purple-500/30",
  follow_up_request: "bg-orange-500/10 text-orange-400 border-orange-500/30",
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function EmailsPage() {
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailEmail, setGmailEmail] = useState("");
  const [gmailAuthUrl, setGmailAuthUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState<ClassifiedEmail[]>([]);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const sessionId = typeof window !== "undefined"
    ? localStorage.getItem("jobagent_session_id") || ""
    : "";

  // Check Gmail connection
  const checkGmail = useCallback(async () => {
    if (!sessionId) { setLoading(false); return; }
    try {
      const res = await fetch(`/api/gmail?sessionId=${sessionId}`);
      const data = await res.json();
      setGmailConnected(data.connected);
      if (data.connected) setGmailEmail(data.email || "");
      if (data.authUrl) setGmailAuthUrl(data.authUrl);
    } catch {
      // ignore
    }
  }, [sessionId]);

  // Load persisted scan results from DB
  const loadResults = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/gmail/results?sessionId=${sessionId}`);
      const data = await res.json();
      if (data.results?.length > 0) {
        setScanResults(data.results);
      }
      if (data.lastScannedAt) {
        setLastScanned(data.lastScannedAt);
      }
    } catch {
      // ignore
    }
  }, [sessionId]);

  // Initial load: check Gmail + load persisted results
  useEffect(() => {
    Promise.all([checkGmail(), loadResults()]).finally(() => setLoading(false));
  }, [checkGmail, loadResults]);

  // Auto-poll: trigger background scan every 30 minutes
  useEffect(() => {
    if (!gmailConnected) return;

    // Trigger cron scan immediately if last scan was > 30 min ago
    const triggerIfStale = async () => {
      if (lastScanned) {
        const age = Date.now() - new Date(lastScanned).getTime();
        if (age < 30 * 60 * 1000) return; // Less than 30 min, skip
      }
      try {
        await fetch("/api/cron/gmail-scan");
        await loadResults(); // Refresh UI
      } catch {
        // ignore
      }
    };

    triggerIfStale();

    // Poll every 30 minutes
    pollRef.current = setInterval(() => {
      fetch("/api/cron/gmail-scan").then(() => loadResults()).catch(() => {});
    }, 30 * 60 * 1000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [gmailConnected, lastScanned, loadResults]);

  // Manual scan
  const scanInbox = async () => {
    setScanning(true);
    try {
      const res = await fetch("/api/gmail/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const data = await res.json();

      if (data.error) {
        if (!data.connected) {
          setGmailConnected(false);
          checkGmail();
        }
        return;
      }

      // Reload from DB to get deduped results
      await loadResults();
    } catch {
      // ignore
    } finally {
      setScanning(false);
    }
  };

  const disconnectGmail = async () => {
    setDisconnecting(true);
    try {
      await fetch(`/api/gmail?sessionId=${sessionId}`, { method: "DELETE" });
      setGmailConnected(false);
      setGmailEmail("");
      setScanResults([]);
      setLastScanned(null);
      checkGmail();
    } catch {
      // ignore
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Emails</h1>
        {lastScanned && (
          <span className="text-xs text-muted">
            Last scanned: {timeAgo(lastScanned)}
          </span>
        )}
      </div>

      {/* Gmail Connection Card */}
      <div className="glass-card p-6">
        <h2 className="text-lg font-semibold mb-3">Gmail Integration</h2>

        {loading ? (
          <p className="text-sm text-muted animate-pulse">Checking connection...</p>
        ) : gmailConnected ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-green-400" />
                <div>
                  <p className="text-sm font-medium text-foreground">Connected</p>
                  <p className="text-xs text-muted">{gmailEmail}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={scanInbox}
                  disabled={scanning}
                  className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-background transition hover:bg-accent/90 disabled:opacity-50"
                >
                  {scanning ? "Scanning..." : "Scan Now"}
                </button>
                <button
                  onClick={disconnectGmail}
                  disabled={disconnecting}
                  className="rounded-lg border border-red-500/30 px-4 py-2 text-xs font-medium text-red-400 transition hover:bg-red-500/10 disabled:opacity-50"
                >
                  {disconnecting ? "..." : "Disconnect"}
                </button>
              </div>
            </div>
            <p className="text-xs text-muted">
              Auto-scans every 30 minutes. Click &quot;Scan Now&quot; for immediate results.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              Connect your Gmail to automatically scan for recruiter replies, interview invitations, and application confirmations.
            </p>
            {gmailAuthUrl ? (
              <a
                href={gmailAuthUrl}
                className="inline-block rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-background transition hover:bg-accent/90"
              >
                Connect Gmail
              </a>
            ) : (
              <p className="text-xs text-red-400">
                Gmail OAuth not configured. Check .env.local for GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Scan Results — always shown if we have persisted data */}
      {scanResults.length > 0 && (
        <div className="glass-card p-6">
          <h2 className="text-lg font-semibold mb-3">
            Job-Related Emails ({scanResults.length})
          </h2>
          <div className="space-y-3">
            {scanResults.map((email, i) => (
              <div key={`${email.fromEmail}-${email.subject}-${i}`} className="rounded-lg border border-card-border p-4 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-foreground">
                        {email.company || "Unknown Company"}
                      </span>
                      <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                        CLASSIFICATION_STYLES[email.classification] || "bg-gray-500/10 text-gray-400 border-gray-500/30"
                      }`}>
                        {email.classification.replace(/_/g, " ")}
                      </span>
                    </div>
                    {email.jobTitle && (
                      <p className="text-xs text-muted mt-0.5">{email.jobTitle}</p>
                    )}
                  </div>
                  <p className="text-xs text-muted shrink-0">
                    {email.date ? timeAgo(email.date) : ""}
                  </p>
                </div>

                <p className="text-xs text-muted">
                  From: {email.from}
                </p>
                <p className="text-xs text-foreground/80">
                  {email.subject}
                </p>
                <p className="text-xs text-muted italic">
                  {email.summary}
                </p>

                {email.action && email.action !== "none" && (
                  <div className="rounded bg-accent/10 px-3 py-1.5 text-xs text-accent font-medium">
                    Action needed: {email.action.replace(/_/g, " ")}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && scanResults.length === 0 && (
        <div className="glass-card p-12 text-center">
          <p className="text-lg text-muted">
            {gmailConnected ? "No job-related emails found yet." : "No email activity yet."}
          </p>
          <p className="mt-1 text-sm text-muted">
            {gmailConnected
              ? "Click \"Scan Now\" to check for recruiter replies, or wait for the auto-scan."
              : "Connect Gmail above to scan for recruiter replies."}
          </p>
        </div>
      )}
    </div>
  );
}
