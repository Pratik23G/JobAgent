"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState, useCallback } from "react";
import ResumeUploader from "@/components/ResumeUploader";
import { getSupabase } from "@/lib/db";

interface Stats {
  total: number;
  interviews: number;
  offers: number;
  responseRate: string;
}

interface AgentLog {
  id: string;
  command: string;
  action: string;
  created_at: string;
}

export default function DashboardOverview() {
  const { data: session } = useSession();
  const [stats, setStats] = useState<Stats>({
    total: 0,
    interviews: 0,
    offers: 0,
    responseRate: "\u2014",
  });
  const [recentLogs, setRecentLogs] = useState<AgentLog[]>([]);

  const fetchData = useCallback(async () => {
    if (!session?.user) return;
    const userId = (session.user as { id?: string }).id;
    if (!userId) return;

    const supabase = getSupabase();

    const [appsRes, logsRes] = await Promise.all([
      supabase
        .from("applications")
        .select("id, status")
        .eq("user_id", userId),
      supabase
        .from("agent_logs")
        .select("id, command, action, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

    const apps = appsRes.data || [];
    const total = apps.length;
    const interviews = apps.filter((a) => a.status === "interview").length;
    const offers = apps.filter((a) => a.status === "offer").length;
    const responded = apps.filter(
      (a) => a.status !== "applied" && a.status !== "ghosted"
    ).length;
    const responseRate =
      total > 0 ? `${Math.round((responded / total) * 100)}%` : "\u2014";

    setStats({ total, interviews, offers, responseRate });
    setRecentLogs(logsRes.data || []);
  }, [session]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const statCards = [
    { label: "Applications", value: String(stats.total), color: "text-accent" },
    { label: "Interviews", value: String(stats.interviews), color: "text-info" },
    { label: "Offers", value: String(stats.offers), color: "text-warning" },
    { label: "Response Rate", value: stats.responseRate, color: "text-muted" },
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

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((s) => (
          <div key={s.label} className="glass-card p-5">
            <p className="text-sm text-muted">{s.label}</p>
            <p className={`mt-1 text-3xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Resume upload */}
      <div className="glass-card p-6">
        <h2 className="mb-4 text-lg font-semibold">Resume</h2>
        <ResumeUploader />
      </div>

      {/* Recent activity */}
      <div className="glass-card p-6">
        <h2 className="mb-4 text-lg font-semibold">Recent Agent Activity</h2>
        {recentLogs.length === 0 ? (
          <p className="text-sm text-muted">
            No activity yet. Head to the Agent tab and give your first voice
            command.
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
