"use client";

import { useState } from "react";

interface ApplyPack {
  company: string;
  title: string;
  apply_url: string;
  score?: number;
  source?: string;
  cover_letter: string;
  resume_bullets: string;
  why_good_fit: string;
  outreach_email: string;
  common_answers?: Record<string, string>;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="shrink-0 rounded border border-card-border px-2 py-1 text-xs text-muted transition hover:border-accent hover:text-accent"
    >
      {copied ? "Copied!" : `Copy ${label}`}
    </button>
  );
}

function Section({ title, content, label }: { title: string; content: string; label: string }) {
  const [expanded, setExpanded] = useState(false);

  if (!content) return null;

  return (
    <div className="border-t border-card-border pt-3">
      <div className="flex items-center justify-between mb-1">
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs font-medium text-muted uppercase tracking-wider hover:text-accent transition"
        >
          {expanded ? "▾" : "▸"} {title}
        </button>
        <CopyButton text={content} label={label} />
      </div>
      {expanded && (
        <pre className="whitespace-pre-wrap text-xs text-foreground leading-relaxed mt-1">
          {content}
        </pre>
      )}
    </div>
  );
}

export default function ApplyPackCard({ pack }: { pack: ApplyPack }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-card-border bg-card p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-sm text-foreground truncate">
            {pack.title}
          </h3>
          <p className="text-xs text-muted">{pack.company}</p>
          {pack.score != null && (
            <span className={`inline-block mt-1 rounded-full px-2 py-0.5 text-xs font-medium ${
              pack.score >= 80 ? "bg-green-500/10 text-green-400" :
              pack.score >= 60 ? "bg-yellow-500/10 text-yellow-400" :
              "bg-red-500/10 text-red-400"
            }`}>
              {pack.score}% match
            </span>
          )}
          {pack.source && (
            <span className="inline-block ml-2 mt-1 rounded-full bg-accent/10 px-2 py-0.5 text-xs text-accent">
              {pack.source}
            </span>
          )}
        </div>
        <a
          href={pack.apply_url}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-background transition hover:bg-accent/90"
        >
          Apply Now
        </a>
      </div>

      {/* Why good fit (always visible) */}
      {pack.why_good_fit && (
        <p className="text-xs text-muted italic">{pack.why_good_fit}</p>
      )}

      {/* Expand/collapse materials */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-accent font-medium hover:underline"
      >
        {expanded ? "Hide application materials" : "Show application materials (cover letter, resume bullets, outreach email)"}
      </button>

      {expanded && (
        <div className="space-y-3">
          <Section title="Cover Letter" content={pack.cover_letter} label="letter" />
          <Section title="Tailored Resume Bullets" content={pack.resume_bullets} label="bullets" />
          <Section title="Outreach Email" content={pack.outreach_email} label="email" />
          {pack.common_answers && Object.keys(pack.common_answers).length > 0 && (
            <div className="border-t border-card-border pt-3">
              <p className="text-xs font-medium text-muted uppercase tracking-wider mb-2">
                Common Application Answers
              </p>
              {Object.entries(pack.common_answers).map(([q, a]) => (
                <div key={q} className="mb-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-accent font-medium">
                      {q.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                    </p>
                    <CopyButton text={a} label="" />
                  </div>
                  <p className="text-xs text-foreground mt-0.5">{a}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
