"use client";

import { useCallback, useEffect, useState } from "react";

interface ParsedResume {
  name: string;
  email: string;
  phone?: string;
  skills: string[];
  experience: { title: string; company: string; duration: string }[];
  education: { degree: string; school: string }[];
  summary: string;
}

export default function ResumeUploader() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [parsed, setParsed] = useState<ParsedResume | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load previously parsed resume from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem("jobagent_resume");
    if (stored) {
      try {
        setParsed(JSON.parse(stored));
      } catch {
        // ignore
      }
    }
  }, []);

  const handleUpload = useCallback(async () => {
    if (!file) return;
    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/resume", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || "Upload failed");
      }

      const data = await res.json();
      setParsed(data.parsed);

      // Persist to localStorage so the agent can access it across pages
      localStorage.setItem("jobagent_resume", JSON.stringify(data.parsed));
      // Dispatch event so VoiceAgent picks it up immediately if on same page
      window.dispatchEvent(new Event("resume-updated"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setUploading(false);
    }
  }, [file]);

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-card-border p-8 transition hover:border-accent/50">
        <input
          type="file"
          accept=".pdf"
          className="hidden"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setParsed(null);
          }}
        />
        <span className="text-3xl mb-2">📄</span>
        <span className="text-sm text-muted">
          {file ? file.name : "Click to upload your resume (PDF)"}
        </span>
      </label>

      {file && !parsed && (
        <button
          onClick={handleUpload}
          disabled={uploading}
          className="rounded-lg bg-accent px-6 py-2 text-sm font-semibold text-background transition hover:bg-accent-dim disabled:opacity-50"
        >
          {uploading ? "Parsing with AI..." : "Upload & Parse Resume"}
        </button>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}

      {/* Parsed result */}
      {parsed && (
        <div className="space-y-3 rounded-lg border border-card-border bg-card p-4">
          <h3 className="font-semibold text-accent">
            Parsed Successfully
          </h3>
          <div className="grid gap-2 text-sm">
            <p>
              <span className="text-muted">Name:</span> {parsed.name}
            </p>
            <p>
              <span className="text-muted">Email:</span> {parsed.email}
            </p>
            {parsed.phone && (
              <p>
                <span className="text-muted">Phone:</span> {parsed.phone}
              </p>
            )}
            <div>
              <span className="text-muted">Skills:</span>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {parsed.skills.map((s) => (
                  <span
                    key={s}
                    className="rounded-full bg-accent/10 px-2.5 py-0.5 text-xs text-accent"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
            <p>
              <span className="text-muted">Summary:</span> {parsed.summary}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
