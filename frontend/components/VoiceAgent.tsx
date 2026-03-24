"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface AgentAction {
  command: string;
  response: string;
  timestamp: Date;
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
  const [isThinking, setIsThinking] = useState(false);
  const [history, setHistory] = useState<AgentAction[]>([]);
  const [textInput, setTextInput] = useState("");
  const [resumeData, setResumeData] = useState<ResumeData | null>(null);
  const [speechSupported, setSpeechSupported] = useState(true);

  const [sessionId] = useState(() => crypto.randomUUID());

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const manualStopRef = useRef(false);
  const listenTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const responseRef = useRef<HTMLDivElement>(null);

  // Load resume data on mount
  useEffect(() => {
    const stored = localStorage.getItem("jobagent_resume");
    if (stored) {
      try {
        setResumeData(JSON.parse(stored));
      } catch {
        // ignore
      }
    }
  }, []);

  // Check speech API support
  useEffect(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSpeechSupported(false);
    }
  }, []);

  // Auto-scroll response area
  useEffect(() => {
    if (responseRef.current) {
      responseRef.current.scrollTop = responseRef.current.scrollHeight;
    }
  }, [agentResponse]);

  const sendCommand = useCallback(
    async (command: string) => {
      if (!command.trim()) return;

      setIsThinking(true);
      setAgentResponse("");
      setTranscript(command);

      try {
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command, resumeData, sessionId }),
        });

        if (!res.ok) {
          throw new Error(`Agent returned ${res.status}`);
        }

        const data = await res.json();
        const response = data.response || "No response from agent.";
        setAgentResponse(response);

        setHistory((prev) => [
          { command, response, timestamp: new Date() },
          ...prev,
        ]);

        // Read aloud
        if ("speechSynthesis" in window) {
          const utterance = new SpeechSynthesisUtterance(response);
          utterance.rate = 1.1;
          utterance.pitch = 1;
          window.speechSynthesis.speak(utterance);
        }
      } catch (err) {
        setAgentResponse(`Error: ${err instanceof Error ? err.message : "Something went wrong"}`);
      } finally {
        setIsThinking(false);
      }
    },
    [resumeData, sessionId]
  );

  const stopListening = useCallback(() => {
    manualStopRef.current = true;
    if (listenTimeoutRef.current) {
      clearTimeout(listenTimeoutRef.current);
      listenTimeoutRef.current = null;
    }
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  const toggleListening = useCallback(async () => {
    if (isListening) {
      stopListening();
      return;
    }

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    manualStopRef.current = false;

    // Request microphone permission first
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      alert("Microphone access denied. Please allow microphone access and try again.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    let silenceTimer: ReturnType<typeof setTimeout> | null = null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      let interim = "";
      let final = "";
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          final += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }
      setTranscript(final || interim);

      // When we get a final result, wait 2s of silence then send
      if (final) {
        if (silenceTimer) clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => {
          stopListening();
          sendCommand(final);
        }, 2000);
      }
    };

    recognition.onerror = (event: any) => {
      console.log("[Voice] error:", event.error);
      // These errors are recoverable — let onend handle restart
      if (event.error === "no-speech" || event.error === "aborted") return;
      // Fatal errors
      stopListening();
    };

    recognition.onend = () => {
      console.log("[Voice] onend, manualStop:", manualStopRef.current);
      // Auto-restart unless user manually stopped or command was sent
      if (!manualStopRef.current) {
        try {
          setTimeout(() => {
            if (!manualStopRef.current) {
              recognition.start();
              console.log("[Voice] restarted");
            }
          }, 100);
        } catch {
          setIsListening(false);
        }
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
    setTranscript("");
    setAgentResponse("");

    // Safety timeout: stop after 30s
    listenTimeoutRef.current = setTimeout(() => {
      stopListening();
    }, 30000);
  }, [isListening, sendCommand, stopListening]);

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (textInput.trim()) {
      sendCommand(textInput.trim());
      setTextInput("");
    }
  };

  const quickCommands = [
    "Find me remote React developer jobs",
    "Apply to the top 3 results",
    "What's my application status?",
    "Email recruiters at Google",
  ];

  return (
    <div className="space-y-6">
      {/* Mic Button */}
      <div className="flex flex-col items-center gap-4">
        <button
          onClick={toggleListening}
          disabled={!speechSupported && isListening}
          className={`relative flex h-24 w-24 items-center justify-center rounded-full text-3xl transition-all ${
            isListening
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
          <p className="mb-1 text-xs font-medium text-muted uppercase tracking-wider">
            Agent Response
          </p>
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
