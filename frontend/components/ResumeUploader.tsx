"use client";

import { useCallback, useEffect, useState, useRef } from "react";

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
  const [synced, setSynced] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load previously parsed resume from localStorage on mount
  // AND push profile to extension cache immediately
  useEffect(() => {
    const stored = localStorage.getItem("jobagent_resume");
    if (stored) {
      try {
        const r = JSON.parse(stored);
        setParsed(r);

        // Push profile to extension cache on mount so extension gets it
        const nameParts = (r.name || "").split(" ");
        const profile = {
          firstName: nameParts[0] || "",
          lastName: nameParts.slice(1).join(" ") || "",
          email: r.email || "",
          phone: r.phone || "",
          linkedin: r.linkedin || "",
          website: r.website || "",
          location: r.location || "",
          currentCompany: r.experience?.[0]?.company || "",
          currentTitle: r.experience?.[0]?.title || "",
          skills: r.skills || [],
        };

        const resumeBlob = localStorage.getItem("jobagent_resume_blob") || null;
        const packsStr = localStorage.getItem("jobagent_last_packs");
        let packs: unknown[] = [];
        if (packsStr) { try { packs = JSON.parse(packsStr); } catch { /* ignore */ } }

        fetch("/api/extension/push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profile, resumeBlob, packs }),
        }).catch(() => {});
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
      // Include sessionId so anonymous users' resumes are saved to DB
      const sessionId = localStorage.getItem("jobagent_session_id");
      if (sessionId) formData.append("sessionId", sessionId);

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

      // Persist parsed data to localStorage so the agent can access it across pages
      localStorage.setItem("jobagent_resume", JSON.stringify(data.parsed));

      // Read PDF as base64 and push EVERYTHING to the extension sync endpoint
      const reader = new FileReader();
      reader.onload = async () => {
        if (typeof reader.result === "string") {
          const resumeBlob = reader.result;
          localStorage.setItem("jobagent_resume_blob", resumeBlob);
          localStorage.setItem("jobagent_resume_filename", file.name);

          // Build profile from parsed data
          const nameParts = (data.parsed.name || "").split(" ");
          const profile = {
            firstName: nameParts[0] || "",
            lastName: nameParts.slice(1).join(" ") || "",
            email: data.parsed.email || "",
            phone: data.parsed.phone || "",
            linkedin: data.parsed.linkedin || "",
            website: data.parsed.website || "",
            location: data.parsed.location || "",
            currentCompany: data.parsed.experience?.[0]?.company || "",
            currentTitle: data.parsed.experience?.[0]?.title || "",
            skills: data.parsed.skills || [],
          };

          // Push to extension sync cache — this is what the extension reads
          try {
            await fetch("/api/extension/push", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ profile, resumeBlob }),
            });
          } catch {
            // Non-critical — extension can still sync from Supabase
          }
        }
      };
      reader.readAsDataURL(file);

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

          {/* Extension sync + PDF re-attach */}
          <div className="flex gap-2 pt-2 border-t border-card-border">
            <button
              onClick={async () => {
                // Push profile + any existing blob to extension
                const nameParts = (parsed.name || "").split(" ");
                const profile = {
                  firstName: nameParts[0] || "",
                  lastName: nameParts.slice(1).join(" ") || "",
                  email: parsed.email || "",
                  phone: parsed.phone || "",
                  skills: parsed.skills || [],
                  currentCompany: parsed.experience?.[0]?.company || "",
                  currentTitle: parsed.experience?.[0]?.title || "",
                };
                const resumeBlob = localStorage.getItem("jobagent_resume_blob") || null;
                const packsStr = localStorage.getItem("jobagent_last_packs");
                let packs: unknown[] = [];
                if (packsStr) { try { packs = JSON.parse(packsStr); } catch { /* */ } }

                await fetch("/api/extension/push", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ profile, resumeBlob, packs }),
                });
                setSynced(true);
                setTimeout(() => setSynced(false), 3000);
              }}
              className={`rounded-lg px-4 py-2 text-xs font-semibold transition ${
                synced
                  ? "bg-green-500/10 text-green-400 border border-green-500/30"
                  : "bg-accent px-4 py-2 text-background hover:bg-accent/90"
              }`}
            >
              {synced ? "Synced to Extension!" : "Sync to Extension"}
            </button>

            <label className="rounded-lg border border-card-border px-4 py-2 text-xs font-semibold text-muted cursor-pointer transition hover:border-accent hover:text-accent">
              Attach PDF for Extension Upload
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const reader = new FileReader();
                  reader.onload = async () => {
                    if (typeof reader.result === "string") {
                      localStorage.setItem("jobagent_resume_blob", reader.result);
                      localStorage.setItem("jobagent_resume_filename", f.name);

                      // Push to extension cache with the blob
                      const nameParts = (parsed.name || "").split(" ");
                      await fetch("/api/extension/push", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          profile: {
                            firstName: nameParts[0] || "",
                            lastName: nameParts.slice(1).join(" ") || "",
                            email: parsed.email || "",
                            phone: parsed.phone || "",
                            skills: parsed.skills || [],
                          },
                          resumeBlob: reader.result,
                        }),
                      });
                      setSynced(true);
                      setTimeout(() => setSynced(false), 3000);
                    }
                  };
                  reader.readAsDataURL(f);
                }}
              />
            </label>
          </div>
          {!localStorage.getItem("jobagent_resume_blob") && (
            <p className="text-xs text-yellow-400">
              Click &quot;Attach PDF&quot; to enable resume upload on job sites via the extension.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
