"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";

const navItems = [
  { href: "/dashboard", label: "Overview", icon: "◈" },
  { href: "/dashboard/applications", label: "Applications", icon: "◉" },
  { href: "/dashboard/emails", label: "Emails", icon: "✉" },
  { href: "/dashboard/agent", label: "Agent", icon: "⬡" },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-56 flex-col border-r border-card-border bg-card">
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

      <div className="border-t border-card-border p-3">
        <button
          onClick={() => signOut({ callbackUrl: "/" })}
          className="w-full rounded-lg px-3 py-2 text-left text-sm text-muted transition hover:bg-card-border/30 hover:text-foreground"
        >
          Sign Out
        </button>
      </div>
    </aside>
  );
}
