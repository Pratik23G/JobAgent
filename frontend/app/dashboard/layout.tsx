import Sidebar from "@/components/Sidebar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      {/* pb-20 on mobile for bottom nav clearance, p-4 on mobile, p-8 on desktop */}
      <main className="flex-1 overflow-y-auto p-4 pb-20 md:p-8 md:pb-8">
        {children}
      </main>
    </div>
  );
}
