"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import SidebarContent from "./SidebarContent";

export default function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close drawer on route change
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <>
      {/* ── Fixed top bar ── */}
      <div className="fixed top-0 left-0 right-0 z-30 h-14 bg-[#0a0a0a] border-b border-[#1a1a1a] flex items-center px-4">
        <button
          onClick={() => setOpen(true)}
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

      {/* ── Overlay ── */}
      <div
        className={`fixed inset-0 bg-black/60 z-40 transition-opacity duration-200 ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setOpen(false)}
      />

      {/* ── Drawer from left ── */}
      <div
        className={`fixed top-0 left-0 bottom-0 w-[280px] bg-[#0a0a0a] border-r border-[#1a1a1a] z-50 flex flex-col transition-transform duration-200 ease-out ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Close button overlaid on top-right of drawer */}
        <button
          onClick={() => setOpen(false)}
          className="absolute top-3 right-3 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-muted hover:text-foreground z-10"
        >
          <X className="w-5 h-5" />
        </button>

        <SidebarContent onNavigate={() => setOpen(false)} />
      </div>
    </>
  );
}
