"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import ApplyPackCard from "./ApplyPackCard";

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

interface AgentAction {
  command: string;
  response: string;
  timestamp: Date;
  applyPacks?: ApplyPack[];
}

interface ResumeData {
  name?: string;
  summary?: string;
  skills?: string[];
  [key: string]: unknown;
}

export default function VoiceAgent() {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [agentResponse, setAgentResponse] = useState("");
  const [applyPacks, setApplyPacks] = useState<ApplyPack[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [history, setHistory] = useState<AgentAction[]>([]);
  const [textInput, setTextInput] = useState("");
  const [resumeData, setResumeData] = useState<ResumeData | null>(null);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  // Voice output controls — default OFF (text only)
  const [voiceEnabled, setVoiceEnabled] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("jobagent_voice_enabled") === "true";
  });
  const [selectedVoice, setSelectedVoice] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("jobagent_selected_voice") || "";
  });
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);

  // Persistent session ID — survives page navigation
  const [sessionId] = useState(() => {
    if (typeof window === "undefined") return "ssr";
    const existing = localStorage.getItem("jobagent_session_id");
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem("jobagent_session_id", id);
    return id;
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const manualStopRef = useRef(false);
  const commandSentRef = useRef(false);
  const listenTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const responseRef = useRef<HTMLDivElement>(null);

  // Load previous chat history, last response, and apply packs on mount
  useEffect(() => {
    try {
      // Restore visible command history
      const storedHistory = localStorage.getItem("jobagent_visible_history");
      if (storedHistory) {
        const parsed = JSON.parse(storedHistory);
        setHistory(
          parsed.map((h: { command: string; response: string; timestamp: string }) => ({
            ...h,
            timestamp: new Date(h.timestamp),
          }))
        );
      }
      // Restore last agent response
      const lastResponse = localStorage.getItem("jobagent_last_response");
      if (lastResponse) setAgentResponse(lastResponse);
      // Restore last apply packs
      const lastPacks = localStorage.getItem("jobagent_last_packs");
      if (lastPacks) setApplyPacks(JSON.parse(lastPacks));
    } catch {
      // ignore
    }
  }, []);

  // Load resume data on mount + listen for updates from ResumeUploader
  useEffect(() => {
    const loadResume = () => {
      const stored = localStorage.getItem("jobagent_resume");
      if (stored) {
        try {
          setResumeData(JSON.parse(stored));
        } catch {
          // ignore
        }
      }
    };
    loadResume();
    window.addEventListener("resume-updated", loadResume);
    // Also pick up changes from other tabs
    window.addEventListener("storage", (e) => {
      if (e.key === "jobagent_resume") loadResume();
    });
    return () => {
      window.removeEventListener("resume-updated", loadResume);
    };
  }, []);

  // On mount, push existing localStorage data to extension sync cache
  // This ensures the extension has data even from previous sessions
  useEffect(() => {
    const resumeStr = localStorage.getItem("jobagent_resume");
    const resumeBlob = localStorage.getItem("jobagent_resume_blob");
    const packsStr = localStorage.getItem("jobagent_last_packs");

    if (resumeStr || packsStr) {
      let profile = {};
      if (resumeStr) {
        try {
          const r = JSON.parse(resumeStr);
          const nameParts = (r.name || "").split(" ");
          profile = {
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
        } catch { /* ignore */ }
      }

      let packs: unknown[] = [];
      if (packsStr) {
        try { packs = JSON.parse(packsStr); } catch { /* ignore */ }
      }

      fetch("/api/extension/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile, resumeBlob, packs }),
      }).catch(() => {});
    }
  }, []);

  // Load available speech synthesis voices
  useEffect(() => {
    if (!("speechSynthesis" in window)) return;

    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length === 0) return;

      // Filter for natural-sounding English voices
      // Prefer: Google voices, Microsoft Neural voices, Apple voices
      const englishVoices = voices.filter((v) =>
        v.lang.startsWith("en") &&
        !v.name.toLowerCase().includes("espeak") // exclude robotic espeak
      );

      // Rank by quality: Neural/Natural > Google > Microsoft > Others
      const ranked = englishVoices.sort((a, b) => {
        const score = (v: SpeechSynthesisVoice) => {
          const n = v.name.toLowerCase();
          if (n.includes("neural") || n.includes("natural")) return 4;
          if (n.includes("google")) return 3;
          if (n.includes("microsoft") && (n.includes("aria") || n.includes("jenny") || n.includes("guy"))) return 3;
          if (n.includes("samantha") || n.includes("karen") || n.includes("daniel")) return 2; // Apple
          return 1;
        };
        return score(b) - score(a);
      });

      setAvailableVoices(ranked.slice(0, 8)); // Show top 8 options

      // Auto-select best voice if none saved
      if (!selectedVoice && ranked.length > 0) {
        setSelectedVoice(ranked[0].name);
        localStorage.setItem("jobagent_selected_voice", ranked[0].name);
      }
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, [selectedVoice]);

  // Check speech API support + HTTPS requirement
  useEffect(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSpeechSupported(false);
      setVoiceError(
        "Speech Recognition is not supported in this browser. Use Chrome or Edge."
      );
      return;
    }
    // SpeechRecognition requires secure context (HTTPS or localhost)
    if (!window.isSecureContext) {
      setSpeechSupported(false);
      setVoiceError(
        "Voice requires HTTPS or localhost. Current page is not a secure context."
      );
    }
  }, []);

  // Auto-scroll response area
  useEffect(() => {
    if (responseRef.current) {
      responseRef.current.scrollTop = responseRef.current.scrollHeight;
    }
  }, [agentResponse]);

  // Clear voice error after 6 seconds
  useEffect(() => {
    if (voiceError) {
      const t = setTimeout(() => setVoiceError(null), 6000);
      return () => clearTimeout(t);
    }
  }, [voiceError]);

  // Speak text with selected voice
  const speakText = useCallback((text: string) => {
    if (!("speechSynthesis" in window)) return;

    window.speechSynthesis.cancel();
    setIsSpeaking(true);

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05; // Slightly faster than default, but not robotic
    utterance.pitch = 1.0;
    utterance.volume = 0.9;

    // Apply selected voice
    if (selectedVoice) {
      const voice = window.speechSynthesis.getVoices().find((v) => v.name === selectedVoice);
      if (voice) utterance.voice = voice;
    }

    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    window.speechSynthesis.speak(utterance);
  }, [selectedVoice]);

  const stopSpeaking = useCallback(() => {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
  }, []);

  const sendCommand = useCallback(
    async (command: string) => {
      if (!command.trim()) return;

      setIsThinking(true);
      setAgentResponse("");
      setApplyPacks([]);
      setTranscript(command);

      try {
        // Load chat history from localStorage to send with request
        let chatHistory: { role: string; text: string }[] = [];
        try {
          const stored = localStorage.getItem("jobagent_chat_history");
          if (stored) chatHistory = JSON.parse(stored);
        } catch { /* ignore */ }

        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command, resumeData, sessionId, chatHistory }),
        });

        if (!res.ok) {
          throw new Error(`Agent returned ${res.status}`);
        }

        const data = await res.json();
        const response = data.response || "No response from agent.";
        setAgentResponse(response);
        // Persist last response so it survives page navigation
        localStorage.setItem("jobagent_last_response", response);

        // If user just authenticated, migrate anonymous data (one-time)
        if (data.authenticated && !localStorage.getItem("jobagent_migrated")) {
          fetch("/api/auth/migrate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId }),
          }).then(() => {
            localStorage.setItem("jobagent_migrated", "true");
          }).catch(() => {}); // Non-critical
        }

        // Check if response contains apply packs (from auto_apply_pipeline or generate_apply_pack)
        const packs = data.applyPacks || [];
        if (packs.length > 0) {
          setApplyPacks(packs);
          localStorage.setItem("jobagent_last_packs", JSON.stringify(packs));

          // Push packs to extension sync cache so extension gets them immediately
          const resumeBlob = localStorage.getItem("jobagent_resume_blob") || null;
          const resumeStr = localStorage.getItem("jobagent_resume");
          let profile = {};
          if (resumeStr) {
            try {
              const r = JSON.parse(resumeStr);
              const nameParts = (r.name || "").split(" ");
              profile = {
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
            } catch { /* ignore */ }
          }
          fetch("/api/extension/push", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ packs, profile, resumeBlob }),
          }).catch(() => {}); // Non-critical
        } else {
          localStorage.removeItem("jobagent_last_packs");
        }

        // Persist chat history to localStorage (keep last 20 exchanges)
        chatHistory.push(
          { role: "user", text: command },
          { role: "agent", text: response.slice(0, 500) }
        );
        const trimmed = chatHistory.slice(-40); // 20 exchanges = 40 entries
        localStorage.setItem("jobagent_chat_history", JSON.stringify(trimmed));

        // Update visible history + persist it
        const newHistory = [
          { command, response, timestamp: new Date() },
        ];
        setHistory((prev) => {
          const updated = [...newHistory, ...prev].slice(0, 20);
          localStorage.setItem(
            "jobagent_visible_history",
            JSON.stringify(updated.map((h) => ({ ...h, timestamp: h.timestamp.toISOString() })))
          );
          return updated;
        });

        // Only speak if voice output is enabled
        if (voiceEnabled && "speechSynthesis" in window) {
          speakText(response);
        }
      } catch (err) {
        setAgentResponse(`Error: ${err instanceof Error ? err.message : "Something went wrong"}`);
      } finally {
        setIsThinking(false);
      }
    },
    [resumeData, sessionId, voiceEnabled, speakText]
  );

  const stopListening = useCallback(() => {
    manualStopRef.current = true;
    if (listenTimeoutRef.current) {
      clearTimeout(listenTimeoutRef.current);
      listenTimeoutRef.current = null;
    }
    try {
      recognitionRef.current?.stop();
    } catch {
      // already stopped
    }
    recognitionRef.current = null;
    setIsListening(false);
  }, []);

  const toggleListening = useCallback(async () => {
    if (isListening) {
      stopListening();
      return;
    }

    setVoiceError(null);

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setVoiceError("Speech Recognition API not available in this browser.");
      return;
    }

    manualStopRef.current = false;
    commandSentRef.current = false;

    // Request microphone permission first
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Release the stream immediately — we just needed permission
      stream.getTracks().forEach((t) => t.stop());
    } catch (err) {
      const msg =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Microphone access denied. Click the lock icon in your address bar to allow mic access, then try again."
          : err instanceof DOMException && err.name === "NotFoundError"
            ? "No microphone found. Please connect a microphone and try again."
            : "Could not access microphone. Check browser permissions.";
      setVoiceError(msg);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    let silenceTimer: ReturnType<typeof setTimeout> | null = null;
    let finalTranscript = "";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      let interim = "";
      finalTranscript = "";
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }
      setTranscript(finalTranscript || interim);

      // When we get a final result, wait 2s of silence then send
      if (finalTranscript && !commandSentRef.current) {
        if (silenceTimer) clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => {
          if (!commandSentRef.current) {
            commandSentRef.current = true;
            stopListening();
            sendCommand(finalTranscript);
          }
        }, 2000);
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onerror = (event: any) => {
      console.warn("[Voice] error:", event.error);
      if (event.error === "no-speech") {
        // Recoverable — onend will restart
        return;
      }
      if (event.error === "aborted") {
        // We aborted it ourselves
        return;
      }
      if (event.error === "not-allowed") {
        setVoiceError("Microphone permission was revoked. Please re-allow and try again.");
        stopListening();
        return;
      }
      if (event.error === "network") {
        setVoiceError("Network error — speech recognition requires an internet connection (Edge sends audio to Microsoft servers).");
        stopListening();
        return;
      }
      // Other fatal errors
      setVoiceError(`Speech recognition error: ${event.error}`);
      stopListening();
    };

    recognition.onend = () => {
      console.log("[Voice] onend, manualStop:", manualStopRef.current, "commandSent:", commandSentRef.current);
      // Auto-restart only if user hasn't stopped and we haven't sent a command
      if (!manualStopRef.current && !commandSentRef.current) {
        setTimeout(() => {
          if (!manualStopRef.current && !commandSentRef.current && recognitionRef.current) {
            try {
              recognition.start();
              console.log("[Voice] restarted");
            } catch {
              setIsListening(false);
            }
          }
        }, 200);
      }
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch (err) {
      setVoiceError("Failed to start speech recognition. Try refreshing the page.");
      console.error("[Voice] start failed:", err);
      return;
    }

    setIsListening(true);
    setTranscript("");
    setAgentResponse("");

    // Safety timeout: stop after 30s
    listenTimeoutRef.current = setTimeout(() => {
      if (!commandSentRef.current) {
        setVoiceError("Listening timed out after 30s. Click the mic to try again.");
      }
      stopListening();
    }, 30000);
  }, [isListening, sendCommand, stopListening]);

  const handleTextSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (textInput.trim()) {
      sendCommand(textInput.trim());
      setTextInput("");
    }
  };

  const quickCommands = [
    "Find me remote React developer jobs",
    "Auto-apply to the best matching jobs for me",
    "What's my application status?",
    "Follow up on my pending applications",
    "Email recruiters at Google",
  ];

  return (
    <div className="space-y-6">
      {/* Resume status indicator */}
      <div className={`rounded-lg border px-4 py-2 text-sm ${
        resumeData
          ? "border-accent/30 bg-accent/10 text-accent"
          : "border-yellow-500/30 bg-yellow-500/10 text-yellow-400"
      }`}>
        {resumeData
          ? `Resume loaded: ${resumeData.name || "Unknown"} — ${(resumeData.skills as string[] | undefined)?.slice(0, 5).join(", ") || "no skills parsed"}`
          : "No resume uploaded. Upload one on the Dashboard for better job matching."}
      </div>

      {/* Voice Error Toast */}
      {voiceError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {voiceError}
        </div>
      )}

      {/* Mic Button */}
      <div className="flex flex-col items-center gap-4">
        <button
          onClick={toggleListening}
          disabled={!speechSupported || isThinking}
          className={`relative flex h-24 w-24 items-center justify-center rounded-full text-3xl transition-all ${
            !speechSupported
              ? "bg-card border border-card-border text-muted opacity-50 cursor-not-allowed"
              : isListening
                ? "bg-accent text-background"
                : "bg-card border border-card-border text-accent hover:bg-accent/10"
          }`}
        >
          {isListening && (
            <>
              <span className="pulse-ring absolute inset-0 rounded-full border-2 border-accent" />
              <span
                className="pulse-ring absolute inset-0 rounded-full border-2 border-accent"
                style={{ animationDelay: "0.5s" }}
              />
            </>
          )}
          {isThinking ? (
            <span className="animate-spin text-2xl">&#9881;</span>
          ) : (
            <span>{isListening ? "&#9632;" : "&#127908;"}</span>
          )}
        </button>

        <p className="text-sm text-muted">
          {isListening
            ? "Listening... speak your command"
            : isThinking
              ? "Agent is thinking..."
              : speechSupported
                ? "Click to speak or type below"
                : "Voice not supported — type your command below"}
        </p>
      </div>

      {/* Text Input (fallback / alternative) */}
      <form onSubmit={handleTextSubmit} className="flex gap-2">
        <input
          type="text"
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          placeholder="Type a command... e.g. 'Find me React jobs in NYC'"
          className="flex-1 rounded-lg border border-card-border bg-card px-4 py-2.5 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none"
          disabled={isThinking}
        />
        <button
          type="submit"
          disabled={isThinking || !textInput.trim()}
          className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-background transition hover:bg-accent/90 disabled:opacity-50"
        >
          Send
        </button>
      </form>

      {/* Live Transcript */}
      {transcript && (
        <div className="glass-card p-4">
          <p className="mb-1 text-xs font-medium text-muted uppercase tracking-wider">
            You said
          </p>
          <p className="font-mono text-sm text-foreground">{transcript}</p>
        </div>
      )}

      {/* Agent Response */}
      {(agentResponse || isThinking) && (
        <div className="glass-card p-4" ref={responseRef}>
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-medium text-muted uppercase tracking-wider">
              Agent Response
            </p>
            {/* Read aloud button — only shows after response, not while thinking */}
            {agentResponse && !isThinking && (
              <button
                onClick={() => isSpeaking ? stopSpeaking() : speakText(agentResponse)}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition ${
                  isSpeaking
                    ? "bg-accent/20 text-accent"
                    : "bg-card border border-card-border text-muted hover:text-accent hover:border-accent"
                }`}
              >
                {isSpeaking ? (
                  <>
                    <span className="inline-block h-2.5 w-2.5 rounded-full bg-accent animate-pulse" />
                    Stop
                  </>
                ) : (
                  <>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                    </svg>
                    Read Aloud
                  </>
                )}
              </button>
            )}
          </div>
          {isThinking ? (
            <p className="font-mono text-sm text-accent">
              Processing
              <span className="typewriter-cursor">|</span>
            </p>
          ) : (
            <pre className="whitespace-pre-wrap font-mono text-sm text-foreground leading-relaxed">
              {agentResponse}
            </pre>
          )}
        </div>
      )}

      {/* Voice Settings Bar */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Auto-speak toggle */}
        <button
          onClick={() => {
            const next = !voiceEnabled;
            setVoiceEnabled(next);
            localStorage.setItem("jobagent_voice_enabled", String(next));
            if (!next) stopSpeaking();
          }}
          className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition ${
            voiceEnabled
              ? "bg-accent/15 text-accent border border-accent/30"
              : "bg-card border border-card-border text-muted hover:text-foreground"
          }`}
        >
          {voiceEnabled ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <line x1="23" y1="9" x2="17" y2="15" />
              <line x1="17" y1="9" x2="23" y2="15" />
            </svg>
          )}
          {voiceEnabled ? "Auto-Speak On" : "Auto-Speak Off"}
        </button>

        {/* Voice selector */}
        {availableVoices.length > 0 && (
          <select
            value={selectedVoice}
            onChange={(e) => {
              setSelectedVoice(e.target.value);
              localStorage.setItem("jobagent_selected_voice", e.target.value);
              // Preview the voice
              if ("speechSynthesis" in window) {
                window.speechSynthesis.cancel();
                const utt = new SpeechSynthesisUtterance("Hey, I'm your JobAgent.");
                const voice = window.speechSynthesis.getVoices().find((v) => v.name === e.target.value);
                if (voice) utt.voice = voice;
                utt.rate = 1.05;
                window.speechSynthesis.speak(utt);
              }
            }}
            className="rounded-full border border-card-border bg-card px-3 py-1.5 text-xs text-muted focus:border-accent focus:outline-none"
          >
            {availableVoices.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name.replace(/Microsoft |Google |Apple /, "").replace(/ Online \(Natural\)/, "")}
                {v.name.toLowerCase().includes("neural") || v.name.toLowerCase().includes("natural") ? " *" : ""}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Action buttons after job search results (when no apply packs yet) */}
      {agentResponse && !isThinking && applyPacks.length === 0 && /\b(jobs?|positions?|roles?|openings?)\b/i.test(agentResponse) && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => sendCommand("Generate apply packs for the top 3 jobs you just showed me")}
            disabled={isThinking}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-background transition hover:bg-accent/90 disabled:opacity-50"
          >
            Generate Apply Packs for Top 3
          </button>
          <button
            onClick={() => sendCommand("Auto-apply to all the matching jobs you found")}
            disabled={isThinking}
            className="rounded-lg border border-accent px-4 py-2 text-sm font-medium text-accent transition hover:bg-accent/10 disabled:opacity-50"
          >
            Auto-Apply to All Matches
          </button>
        </div>
      )}

      {/* Apply Pack Cards */}
      {applyPacks.length > 0 && (
        <div>
          <p className="mb-3 text-xs font-medium text-muted uppercase tracking-wider">
            Apply Packs ({applyPacks.length})
          </p>
          <div className="space-y-4">
            {applyPacks.map((pack, i) => (
              <ApplyPackCard key={`${pack.company}-${i}`} pack={pack} />
            ))}
          </div>
        </div>
      )}

      {/* Quick Commands */}
      <div>
        <p className="mb-2 text-xs font-medium text-muted uppercase tracking-wider">
          Quick Commands
        </p>
        <div className="flex flex-wrap gap-2">
          {quickCommands.map((cmd) => (
            <button
              key={cmd}
              onClick={() => sendCommand(cmd)}
              disabled={isThinking}
              className="rounded-full border border-card-border px-3 py-1.5 text-xs text-muted transition hover:border-accent hover:text-accent disabled:opacity-50"
            >
              {cmd}
            </button>
          ))}
        </div>
      </div>

      {/* History */}
      {history.length > 0 && (
        <div>
          <p className="mb-3 text-xs font-medium text-muted uppercase tracking-wider">
            Recent Commands
          </p>
          <div className="space-y-3">
            {history.slice(0, 5).map((item, i) => (
              <div key={i} className="glass-card p-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-accent font-mono">{item.command}</p>
                  <p className="text-xs text-muted">
                    {item.timestamp.toLocaleTimeString()}
                  </p>
                </div>
                <p className="mt-1 text-xs text-muted line-clamp-2">
                  {item.response}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Extend Window for Web Speech API
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}
