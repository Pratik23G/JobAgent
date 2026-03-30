"use client";

import { useState, useCallback } from "react";

interface Job {
  title: string;
  company: string;
  location: string;
  url: string;
  description: string;
  salary_min?: number;
  salary_max?: number;
  source: string;
  posted_date?: string;
  days_active?: number;
  already_applied: boolean;
}

interface AutoApplyResult {
  company: string;
  title: string;
  url: string;
  status: string;
  error?: string;
}

const SOURCE_BADGES: Record<string, string> = {
  adzuna: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  remotive: "bg-purple-500/10 text-purple-400 border-purple-500/30",
  arbeitnow: "bg-orange-500/10 text-orange-400 border-orange-500/30",
  hackernews: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
};

function getSourceBadge(source: string) {
  for (const [key, cls] of Object.entries(SOURCE_BADGES)) {
    if (source.includes(key)) return cls;
  }
  // jsearch sources
  if (source.includes("jsearch")) return "bg-green-500/10 text-green-400 border-green-500/30";
  return "bg-gray-500/10 text-gray-400 border-gray-500/30";
}

function getDaysColor(days: number | undefined) {
  if (days === undefined) return "text-muted";
  if (days <= 1) return "text-green-400";
  if (days <= 3) return "text-green-300";
  if (days <= 7) return "text-yellow-400";
  if (days <= 14) return "text-orange-400";
  return "text-red-400";
}

function formatDays(days: number | undefined) {
  if (days === undefined) return "N/A";
  if (days === 0) return "Today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

export default function JobSearchPage() {
  const [searchTitle, setSearchTitle] = useState("");
  const [searchLocation, setSearchLocation] = useState("remote");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [applying, setApplying] = useState(false);
  const [applyResults, setApplyResults] = useState<AutoApplyResult[]>([]);
  const [expandedJob, setExpandedJob] = useState<number | null>(null);

  const searchJobs = useCallback(async () => {
    if (!searchTitle.trim()) return;
    setLoading(true);
    setSearched(true);
    setSelected(new Set());
    setApplyResults([]);

    try {
      const sessionId = localStorage.getItem("jobagent_session_id") || "";
      const params = new URLSearchParams({
        title: searchTitle,
        location: searchLocation,
        sessionId,
      });
      const res = await fetch(`/api/jobs/discover?${params}`);
      const data = await res.json();
      setJobs(data.jobs || []);
    } catch {
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, [searchTitle, searchLocation]);

  const toggleSelect = (idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const selectAll = () => {
    const selectable = jobs
      .map((j, i) => (!j.already_applied ? i : -1))
      .filter((i) => i >= 0);
    if (selected.size === selectable.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(selectable));
    }
  };

  const autoApplySelected = async () => {
    const selectedJobs = Array.from(selected).map((i) => jobs[i]).filter(Boolean);
    if (selectedJobs.length === 0) return;

    setApplying(true);
    setApplyResults([]);

    try {
      const sessionId = localStorage.getItem("jobagent_session_id") || "";
      const res = await fetch("/api/jobs/auto-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobs: selectedJobs,
          sessionId,
          mode: "review", // Always review mode — pause before submit
        }),
      });
      const data = await res.json();
      setApplyResults(data.results || []);

      // Update applied status in local state
      const queuedCompanies = new Set(
        (data.results || [])
          .filter((r: AutoApplyResult) => r.status === "queued")
          .map((r: AutoApplyResult) => `${r.company.toLowerCase()}::${r.title.toLowerCase()}`)
      );

      setJobs((prev) =>
        prev.map((j) =>
          queuedCompanies.has(`${j.company.toLowerCase()}::${j.title.toLowerCase()}`)
            ? { ...j, already_applied: true }
            : j
        )
      );
      setSelected(new Set());
    } catch {
      // ignore
    } finally {
      setApplying(false);
    }
  };

  const selectableCount = jobs.filter((j) => !j.already_applied).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Job Search</h1>
        <p className="mt-1 text-sm text-muted">
          Discover jobs, see how long they&apos;ve been active, and auto-apply
          to multiple at once.
        </p>
      </div>

      {/* Search Bar */}
      <div className="glass-card p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            placeholder="Job title (e.g. Software Engineer, Data Scientist)"
            value={searchTitle}
            onChange={(e) => setSearchTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && searchJobs()}
            className="flex-1 rounded-lg border border-card-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none min-h-[44px]"
          />
          <input
            type="text"
            placeholder="Location"
            value={searchLocation}
            onChange={(e) => setSearchLocation(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && searchJobs()}
            className="w-full sm:w-40 rounded-lg border border-card-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none min-h-[44px]"
          />
          <button
            onClick={searchJobs}
            disabled={loading || !searchTitle.trim()}
            className="w-full sm:w-auto rounded-lg bg-accent px-6 py-2.5 text-sm font-semibold text-background transition hover:bg-accent/90 disabled:opacity-50 min-h-[44px]"
          >
            {loading ? "Searching..." : "Search"}
          </button>
        </div>
      </div>

      {/* Apply Results Banner */}
      {applyResults.length > 0 && (
        <div className="glass-card border-accent/30 p-4">
          <h3 className="text-sm font-semibold text-accent mb-2">
            Auto-Apply Results
          </h3>
          <div className="space-y-1">
            {applyResults.map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span
                  className={
                    r.status === "queued"
                      ? "text-green-400"
                      : r.status === "skipped_duplicate"
                        ? "text-yellow-400"
                        : "text-red-400"
                  }
                >
                  {r.status === "queued"
                    ? "\u2713"
                    : r.status === "skipped_duplicate"
                      ? "\u25CB"
                      : "\u2717"}
                </span>
                <span className="text-foreground">
                  {r.company} - {r.title}
                </span>
                <span className="text-muted">
                  {r.status === "queued"
                    ? "Queued for auto-apply"
                    : r.status === "skipped_duplicate"
                      ? "Already applied"
                      : r.error || "Failed"}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">
            The extension will open each job, fill the form, and pause for your
            review before submitting.
          </p>
        </div>
      )}

      {/* Action Bar */}
      {jobs.length > 0 && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <button
              onClick={selectAll}
              className="text-xs text-accent hover:underline min-h-[44px] sm:min-h-0"
            >
              {selected.size === selectableCount && selectableCount > 0
                ? "Deselect All"
                : `Select All (${selectableCount})`}
            </button>
            {selected.size > 0 && (
              <span className="text-xs text-muted">
                {selected.size} selected
              </span>
            )}
          </div>

          <button
            onClick={autoApplySelected}
            disabled={selected.size === 0 || applying}
            className="w-full sm:w-auto rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-background transition hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed min-h-[44px]"
          >
            {applying
              ? "Generating Apply Packs..."
              : `Auto-Apply (${selected.size})`}
          </button>
        </div>
      )}

      {/* Jobs Table */}
      {loading ? (
        <div className="glass-card p-12 text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          <p className="mt-3 text-sm text-muted">
            Searching across Adzuna, JSearch, Remotive, Arbeitnow...
          </p>
        </div>
      ) : searched && jobs.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <p className="text-muted">
            No jobs found. Try a different title or location.
          </p>
        </div>
      ) : jobs.length > 0 ? (
        <div className="glass-card overflow-hidden overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="border-b border-card-border text-left text-xs text-muted uppercase tracking-wider">
                <th className="p-3 w-10">
                  <input
                    type="checkbox"
                    checked={
                      selected.size === selectableCount && selectableCount > 0
                    }
                    onChange={selectAll}
                    className="accent-accent"
                  />
                </th>
                <th className="p-3">Job</th>
                <th className="p-3">Company</th>
                <th className="p-3">Location</th>
                <th className="p-3 text-center">Active</th>
                <th className="p-3">Source</th>
                <th className="p-3">Salary</th>
                <th className="p-3 w-16">Status</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job, idx) => (
                <>
                  <tr
                    key={idx}
                    className={`border-b border-card-border/50 transition cursor-pointer ${
                      selected.has(idx) ? "bg-accent/5" : "hover:bg-card-border/20"
                    } ${job.already_applied ? "opacity-50" : ""}`}
                    onClick={() => setExpandedJob(expandedJob === idx ? null : idx)}
                  >
                    <td
                      className="p-3"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!job.already_applied) toggleSelect(idx);
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(idx)}
                        disabled={job.already_applied}
                        onChange={() => toggleSelect(idx)}
                        className="accent-accent"
                      />
                    </td>
                    <td className="p-3">
                      <div className="font-medium text-foreground max-w-[250px] truncate">
                        {job.title}
                      </div>
                    </td>
                    <td className="p-3 text-muted max-w-[150px] truncate">
                      {job.company}
                    </td>
                    <td className="p-3 text-xs text-muted max-w-[120px] truncate">
                      {job.location || "Remote"}
                    </td>
                    <td
                      className={`p-3 text-center text-xs font-semibold ${getDaysColor(job.days_active)}`}
                    >
                      {formatDays(job.days_active)}
                    </td>
                    <td className="p-3">
                      <span
                        className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium ${getSourceBadge(job.source)}`}
                      >
                        {job.source.replace("jsearch-", "")}
                      </span>
                    </td>
                    <td className="p-3 text-xs text-muted">
                      {job.salary_min || job.salary_max
                        ? `$${(job.salary_min || 0).toLocaleString()}${job.salary_max ? ` - $${job.salary_max.toLocaleString()}` : "+"}`
                        : "\u2014"}
                    </td>
                    <td className="p-3">
                      {job.already_applied ? (
                        <span className="text-xs text-yellow-400">Applied</span>
                      ) : (
                        <a
                          href={job.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-accent hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Open
                        </a>
                      )}
                    </td>
                  </tr>
                  {expandedJob === idx && (
                    <tr key={`exp-${idx}`} className="border-b border-card-border/50">
                      <td colSpan={8} className="p-4 bg-card/50">
                        <div className="space-y-2">
                          <p className="text-xs text-muted leading-relaxed">
                            {job.description || "No description available."}
                          </p>
                          <div className="flex items-center gap-3">
                            <a
                              href={job.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-accent hover:underline"
                            >
                              Open Job Listing
                            </a>
                            {job.posted_date && (
                              <span className="text-xs text-muted">
                                Posted:{" "}
                                {new Date(job.posted_date).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>

          <div className="border-t border-card-border p-3 text-xs text-muted flex justify-between">
            <span>{jobs.length} jobs found</span>
            <span>
              Sources:{" "}
              {[...new Set(jobs.map((j) => j.source.replace("jsearch-", "")))]
                .join(", ")}
            </span>
          </div>
        </div>
      ) : !searched ? (
        <div className="glass-card p-12 text-center">
          <p className="text-lg font-semibold text-foreground mb-2">
            Search for jobs to get started
          </p>
          <p className="text-sm text-muted mb-6">
            We&apos;ll search across Adzuna, LinkedIn, Indeed, Glassdoor,
            Remotive, and more.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {[
              "Software Engineer",
              "Data Scientist",
              "Product Manager",
              "Frontend Developer",
              "DevOps Engineer",
            ].map((t) => (
              <button
                key={t}
                onClick={() => {
                  setSearchTitle(t);
                  setSearchLocation("remote");
                }}
                className="rounded-full border border-card-border px-3 py-1.5 text-xs text-muted hover:text-foreground hover:border-accent transition"
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
