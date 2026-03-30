"use client";

import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function LandingPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (session) router.push("/dashboard");
  }, [session, router]);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6">
      {/* Hero */}
      <div className="max-w-2xl text-center">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-card-border bg-card px-4 py-1.5 text-sm text-muted">
          <span className="inline-block h-2 w-2 rounded-full bg-accent animate-pulse" />
          AI-Powered Job Hunting
        </div>

        <h1 className="mb-4 text-5xl font-bold tracking-tight md:text-6xl">
          <span className="text-accent">JobAgent</span>
        </h1>

        <p className="mb-8 text-lg text-muted leading-relaxed">
          Voice-activated AI that finds jobs, writes cover letters, emails
          recruiters, and tracks every application — so you can focus on
          interviewing.
        </p>

        <button
          onClick={() => signIn("google")}
          className="inline-flex items-center gap-3 rounded-lg bg-accent px-8 py-3 text-base font-semibold text-background transition hover:bg-accent-dim"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
          </svg>
          Sign in with Google
        </button>
      </div>

      {/* Feature cards */}
      <div className="mt-20 grid max-w-4xl gap-4 md:grid-cols-3">
        {[
          {
            icon: "🎙️",
            title: "Voice Commands",
            desc: 'Say "find me React jobs in SF" and watch it happen.',
          },
          {
            icon: "📝",
            title: "Auto Applications",
            desc: "Custom cover letters + one-click apply to dozens of jobs.",
          },
          {
            icon: "📧",
            title: "Recruiter Outreach",
            desc: "AI-written cold emails sent directly to hiring managers.",
          },
        ].map((f) => (
          <div key={f.title} className="glass-card p-6">
            <div className="mb-3 text-2xl">{f.icon}</div>
            <h3 className="mb-1 font-semibold">{f.title}</h3>
            <p className="text-sm text-muted">{f.desc}</p>
          </div>
        ))}
      </div>

      {/* Footer */}
      <footer className="mt-20 w-full max-w-4xl border-t border-gray-800 pt-6 pb-8 text-center text-xs text-gray-500">
        <a href="/privacy" className="hover:text-gray-300 transition">Privacy Policy</a>
        <span className="mx-2 text-gray-700">·</span>
        <a href="/terms" className="hover:text-gray-300 transition">Terms of Service</a>
      </footer>
    </div>
  );
}
