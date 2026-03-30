"use client";

import SidebarContent from "./SidebarContent";

export default function Sidebar() {
  return (
    <aside className="flex h-screen w-56 flex-col border-r border-card-border bg-card shrink-0">
      <SidebarContent />
    </aside>
  );
}
