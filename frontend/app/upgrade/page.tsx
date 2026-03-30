"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { PRO_FEATURES } from "@/lib/stripe";

export default function UpgradePage() {
  const { data: session } = useSession();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleUpgrade() {
    setLoading(true);
    setError("");

    try {
      const sessionId =
        typeof window !== "undefined"
          ? localStorage.getItem("jobagent_session_id") || ""
          : "";

      if (!sessionId) {
        setError("No session found. Please visit the dashboard first.");
        setLoading(false);
        return;
      }

      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Something went wrong");
        setLoading(false);
        return;
      }

      if (data.url) {
        window.location.href = data.url;
      }
    } catch {
      setError("Failed to start checkout. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 sm:px-6">
      <div className="w-full max-w-md">
        {/* Back link */}
        <Link
          href="/dashboard"
          className="mb-8 inline-flex items-center gap-1 text-sm text-muted hover:text-foreground transition"
        >
          &larr; Back to Dashboard
        </Link>

        {/* Pricing card */}
        <div className="glass-card p-8">
          {/* Badge */}
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
            PRO
          </div>

          <h1 className="mb-1 text-2xl font-bold">{PRO_FEATURES.name}</h1>

          <div className="mb-6">
            <span className="text-4xl font-bold text-accent">$9.99</span>
            <span className="text-muted">/month</span>
          </div>

          {/* Features list */}
          <ul className="mb-8 space-y-3">
            {PRO_FEATURES.features.map((feature) => (
              <li key={feature} className="flex items-start gap-3 text-sm">
                <svg
                  className="mt-0.5 h-4 w-4 shrink-0 text-accent"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                <span>{feature}</span>
              </li>
            ))}
          </ul>

          {/* Error message */}
          {error && (
            <div className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-4 py-2 text-sm text-danger">
              {error}
            </div>
          )}

          {/* CTA */}
          <button
            onClick={handleUpgrade}
            disabled={loading}
            className="w-full rounded-lg bg-accent px-6 py-3 text-base font-semibold text-background transition hover:bg-accent-dim disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
          >
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-background border-t-transparent" />
                Redirecting to Stripe...
              </span>
            ) : (
              "Upgrade to Pro"
            )}
          </button>

          <p className="mt-4 text-center text-xs text-muted">
            Cancel anytime. Powered by Stripe.
          </p>
        </div>

        {/* Signed-in notice */}
        {session?.user?.name && (
          <p className="mt-4 text-center text-xs text-muted">
            Signed in as {session.user.name}
          </p>
        )}
      </div>
    </div>
  );
}
