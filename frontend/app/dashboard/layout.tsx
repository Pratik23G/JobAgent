import Sidebar from "@/components/Sidebar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      {/* pt-14 on mobile for fixed top bar, p-4 mobile / p-8 desktop */}
      <main className="flex-1 overflow-y-auto p-4 pt-18 md:p-8 md:pt-8">
        {children}
      </main>
    </div>
  );
}
