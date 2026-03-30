"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useState } from "react";
import { UsageMini } from "@/components/UsageCard";

const navItems = [
  { href: "/dashboard", label: "Overview", icon: "◈" },
  { href: "/dashboard/queue", label: "Auto-Apply Queue", icon: "◇" },
  { href: "/dashboard/jobs", label: "Job Search", icon: "◎" },
  { href: "/dashboard/applications", label: "Applications", icon: "◉" },
  { href: "/dashboard/emails", label: "Emails", icon: "✉" },
  { href: "/dashboard/agent", label: "Agent", icon: "⬡" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <>
      {/* ── Desktop / Tablet sidebar (hidden on mobile) ── */}
      <aside className="hidden md:flex h-screen w-56 flex-col border-r border-card-border bg-card shrink-0">
        <div className="flex items-center gap-2 border-b border-card-border px-5 py-4">
          <span className="text-lg font-bold text-accent font-mono">
            JobAgent
          </span>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {navItems.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                  active
                    ? "bg-accent/10 text-accent"
                    : "text-muted hover:bg-card-border/30 hover:text-foreground"
                }`}
              >
                <span className="text-base">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Mini usage bars */}
        <Link href="/dashboard" className="border-t border-card-border hover:bg-card-border/20 transition">
          <UsageMini />
        </Link>

        <div className="border-t border-card-border p-3">
          <button
            onClick={() => signOut({ callbackUrl: "/" })}
            className="w-full rounded-lg px-3 py-2 text-left text-sm text-muted transition hover:bg-card-border/30 hover:text-foreground"
          >
            Sign Out
          </button>
        </div>
      </aside>

      {/* ── Mobile bottom navigation bar (visible only on mobile) ── */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 flex md:hidden items-center justify-around border-t border-card-border bg-card/95 backdrop-blur-md px-1 py-1 safe-bottom">
        {navItems.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center justify-center min-w-[44px] min-h-[44px] rounded-lg px-1 py-1 text-xs transition ${
                active
                  ? "text-accent"
                  : "text-muted"
              }`}
            >
              <span className="text-lg leading-none">{item.icon}</span>
              <span className="mt-0.5 text-[10px] leading-none truncate max-w-[56px]">
                {item.label === "Auto-Apply Queue" ? "Queue" : item.label}
              </span>
            </Link>
          );
        })}
        {/* Hamburger for more options */}
        <button
          onClick={() => setDrawerOpen(true)}
          className="flex flex-col items-center justify-center min-w-[44px] min-h-[44px] rounded-lg px-1 py-1 text-xs text-muted"
        >
          <span className="text-lg leading-none">☰</span>
          <span className="mt-0.5 text-[10px] leading-none">More</span>
        </button>
      </nav>

      {/* ── Mobile slide-out drawer ── */}
      {drawerOpen && (
        <div className="fixed inset-0 z-[60] md:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
          />
          {/* Drawer panel */}
          <div className="absolute right-0 top-0 bottom-0 w-64 bg-card border-l border-card-border flex flex-col animate-slide-in">
            <div className="flex items-center justify-between border-b border-card-border px-5 py-4">
              <span className="text-lg font-bold text-accent font-mono">
                JobAgent
              </span>
              <button
                onClick={() => setDrawerOpen(false)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-muted hover:text-foreground"
              >
                ✕
              </button>
            </div>

            <nav className="flex-1 space-y-1 px-3 py-4 overflow-y-auto">
              {navItems.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setDrawerOpen(false)}
                    className={`flex items-center gap-3 rounded-lg px-3 py-3 text-sm transition ${
                      active
                        ? "bg-accent/10 text-accent"
                        : "text-muted hover:bg-card-border/30 hover:text-foreground"
                    }`}
                  >
                    <span className="text-base">{item.icon}</span>
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            <Link
              href="/dashboard"
              onClick={() => setDrawerOpen(false)}
              className="border-t border-card-border hover:bg-card-border/20 transition"
            >
              <UsageMini />
            </Link>

            <div className="border-t border-card-border p-3">
              <button
                onClick={() => signOut({ callbackUrl: "/" })}
                className="w-full rounded-lg px-3 py-3 text-left text-sm text-muted transition hover:bg-card-border/30 hover:text-foreground min-h-[44px]"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
