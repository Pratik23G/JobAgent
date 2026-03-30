"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Search,
  FileText,
  Mail,
  Inbox,
  Bot,
  Lock,
  Zap,
  TrendingUp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface UsageMeter {
  used: number;
  limit: number | null;
  remaining: number | null;
}

interface UsageData {
  searches: UsageMeter;
  coverLetters: UsageMeter;
  emails: UsageMeter;
  gmailScans: UsageMeter;
  agentMessages: UsageMeter;
  resetsAt: string;
  isPro: boolean;
}

const METERS: { key: string; label: string; icon: LucideIcon; dailyLimit: number }[] = [
  { key: "searches", label: "Job Searches", icon: Search, dailyLimit: 10 },
  { key: "coverLetters", label: "Cover Letters", icon: FileText, dailyLimit: 5 },
  { key: "emails", label: "Recruiter Emails", icon: Mail, dailyLimit: 10 },
  { key: "gmailScans", label: "Gmail Scans", icon: Inbox, dailyLimit: 3 },
  { key: "agentMessages", label: "AI Messages", icon: Bot, dailyLimit: 20 },
];

function getBarColor(used: number, limit: number | null): string {
  if (limit === null) return "bg-[#00e87a]";
  const remaining = limit - used;
  const pct = remaining / limit;
  if (pct <= 0) return "bg-gray-600";
  if (pct < 0.2) return "bg-red-500";
  if (pct < 0.5) return "bg-amber-500";
  return "bg-[#00e87a]";
}

function getTimeUntilReset(resetsAt: string): string {
  const diff = new Date(resetsAt).getTime() - Date.now();
  if (diff <= 0) return "Resetting now...";
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  return `Resets in ${hours}h ${mins}m`;
}

export default function UsageCard() {
  const [data, setData] = useState<UsageData | null>(null);
  const [countdown, setCountdown] = useState("");

  const fetchUsage = useCallback(async () => {
    const sid = typeof window !== "undefined" ? localStorage.getItem("jobagent_session_id") || "" : "";
    if (!sid) return;
    try {
      const res = await fetch(`/api/usage?sessionId=${sid}`);
      const json = await res.json();
      if (json.searches) setData(json);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchUsage();
    const interval = setInterval(fetchUsage, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchUsage]);

  useEffect(() => {
    if (!data?.resetsAt) return;
    const tick = () => setCountdown(getTimeUntilReset(data.resetsAt));
    tick();
    const interval = setInterval(tick, 60_000);
    return () => clearInterval(interval);
  }, [data?.resetsAt]);

  if (!data) return null;

  return (
    <div className="glass-card p-6">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Daily Usage</h2>
          {data.isPro && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#00e87a]/10 border border-[#00e87a]/30 px-2.5 py-0.5 text-xs font-semibold text-[#00e87a]">
              <Zap className="w-3 h-3 fill-[#00e87a]" />
              Pro
            </span>
          )}
        </div>
        <span className="text-xs text-gray-500">{countdown}</span>
      </div>

      <div className="space-y-4">
        {METERS.map(({ key, label, icon: Icon, dailyLimit }) => {
          const meter = data[key as keyof UsageData] as UsageMeter;
          const limit = meter.limit;
          const used = meter.used;
          const isUnlimited = limit === null;
          const isExhausted = !isUnlimited && used >= (limit ?? dailyLimit);
          const pct = isUnlimited ? 0 : Math.min(100, (used / (limit ?? dailyLimit)) * 100);

          return (
            <div key={key}>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  {isExhausted ? (
                    <Lock className="w-4 h-4 text-gray-500" />
                  ) : (
                    <Icon className="w-4 h-4 text-[#00e87a]" />
                  )}
                  <span className={`text-sm ${isExhausted ? "text-gray-500" : "text-gray-300"}`}>{label}</span>
                </div>
                <span className="text-xs font-medium">
                  {isUnlimited ? (
                    <span className="text-[#00e87a]">Unlimited</span>
                  ) : isExhausted ? (
                    <span className="text-gray-500 flex items-center gap-1">
                      <Lock className="w-3 h-3" />
                      {used}/{limit} used
                    </span>
                  ) : (
                    <span className="text-gray-400">
                      {(limit ?? dailyLimit) - used} of {limit ?? dailyLimit} remaining
                    </span>
                  )}
                </span>
              </div>
              <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
                {isUnlimited ? (
                  <div className="h-full w-full bg-[#00e87a]/20 rounded-full" />
                ) : (
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      isExhausted ? "bg-gray-600" : getBarColor(used, limit)
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {!data.isPro && (
        <div className="mt-5 pt-4 border-t border-gray-800">
          <a
            href="/upgrade"
            className="flex items-center justify-center gap-2 w-full rounded-lg bg-[#00e87a]/10 border border-[#00e87a]/30 py-2.5 text-sm font-medium text-[#00e87a] transition hover:bg-[#00e87a]/20"
          >
            <TrendingUp className="w-4 h-4" />
            Upgrade to Pro for higher limits
          </a>
        </div>
      )}
    </div>
  );
}

// ─── Compact version for sidebar ────────────────────────────────────────────

export function UsageMini() {
  const [data, setData] = useState<UsageData | null>(null);
  const [hasCritical, setHasCritical] = useState(false);

  useEffect(() => {
    const sid = typeof window !== "undefined" ? localStorage.getItem("jobagent_session_id") || "" : "";
    if (!sid) return;
    fetch(`/api/usage?sessionId=${sid}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.searches) {
          setData(json);
          const critical = METERS.some(({ key, dailyLimit }) => {
            const m = json[key] as UsageMeter;
            if (m.limit === null) return false;
            return (m.limit - m.used) / (m.limit || dailyLimit) < 0.2;
          });
          setHasCritical(critical);
        }
      })
      .catch(() => {});
  }, []);

  if (!data) return null;

  return (
    <div className="px-3 py-2 space-y-1.5 relative">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs text-gray-500 font-medium">Usage</span>
        {hasCritical && (
          <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
        )}
      </div>
      {METERS.map(({ key, icon: Icon, dailyLimit }) => {
        const meter = data[key as keyof UsageData] as UsageMeter;
        const limit = meter.limit;
        const used = meter.used;
        const isUnlimited = limit === null;
        const pct = isUnlimited ? 0 : Math.min(100, (used / (limit ?? dailyLimit)) * 100);

        return (
          <div key={key} className="flex items-center gap-2">
            <Icon className="w-3 h-3 text-gray-500 shrink-0" />
            <div className="flex-1 h-[3px] rounded-full bg-gray-800 overflow-hidden">
              {isUnlimited ? (
                <div className="h-full w-full bg-[#00e87a]/20 rounded-full" />
              ) : (
                <div
                  className={`h-full rounded-full ${getBarColor(used, limit)}`}
                  style={{ width: `${pct}%` }}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
