"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useState, useEffect } from "react";
import { Menu, X } from "lucide-react";
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

  // Close drawer on route change
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  return (
    <>
      {/* ── Desktop sidebar (hidden on mobile) ── */}
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

      {/* ── Mobile top bar ── */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-30 h-14 bg-[#0a0a0a] border-b border-[#1a1a1a] flex items-center px-4">
        <button
          onClick={() => setDrawerOpen(true)}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center -ml-2"
        >
          <Menu className="w-5 h-5 text-accent" />
        </button>
        <span className="flex-1 text-center text-accent font-bold text-lg font-mono">
          JobAgent
        </span>
        {/* Spacer to keep title centered */}
        <div className="w-[44px]" />
      </div>

      {/* ── Mobile drawer overlay ── */}
      <div
        className={`md:hidden fixed inset-0 bg-black/60 z-40 transition-opacity duration-250 ${
          drawerOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setDrawerOpen(false)}
      />

      {/* ── Mobile slide-out drawer (from left) ── */}
      <div
        className={`md:hidden fixed top-0 left-0 bottom-0 w-[280px] bg-[#0a0a0a] border-r border-[#1a1a1a] z-50 flex flex-col transition-transform duration-250 ease-out ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-[#1a1a1a] px-5 py-4">
          <span className="text-lg font-bold text-accent font-mono">
            JobAgent
          </span>
          <button
            onClick={() => setDrawerOpen(false)}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-muted hover:text-foreground"
          >
            <X className="w-5 h-5" />
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
                    : "text-muted hover:bg-[#1a1a1a] hover:text-foreground"
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
          className="border-t border-[#1a1a1a] hover:bg-[#1a1a1a]/50 transition"
        >
          <UsageMini />
        </Link>

        <div className="border-t border-[#1a1a1a] p-3">
          <button
            onClick={() => signOut({ callbackUrl: "/" })}
            className="w-full rounded-lg px-3 py-3 text-left text-sm text-muted transition hover:bg-[#1a1a1a] hover:text-foreground min-h-[44px]"
          >
            Sign Out
          </button>
        </div>
      </div>
    </>
  );
}
