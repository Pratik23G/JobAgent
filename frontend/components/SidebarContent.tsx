"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { UsageMini } from "@/components/UsageCard";

export const navItems = [
  { href: "/dashboard", label: "Overview", icon: "◈" },
  { href: "/dashboard/queue", label: "Auto-Apply Queue", icon: "◇" },
  { href: "/dashboard/jobs", label: "Job Search", icon: "◎" },
  { href: "/dashboard/applications", label: "Applications", icon: "◉" },
  { href: "/dashboard/emails", label: "Emails", icon: "✉" },
  { href: "/dashboard/agent", label: "Agent", icon: "⬡" },
];

export default function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <>
      <div className="flex items-center gap-2 border-b border-card-border px-5 py-4">
        <span className="text-lg font-bold text-accent font-mono">
          JobAgent
        </span>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4 overflow-y-auto">
        {navItems.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
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
        onClick={onNavigate}
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
    </>
  );
}
