import Sidebar from "@/components/Sidebar";
import MobileNav from "@/components/MobileNav";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex flex-col min-h-screen md:flex-row md:h-screen md:overflow-hidden">
      {/* Desktop sidebar — hidden below md via wrapper */}
      <div className="hidden md:block">
        <Sidebar />
      </div>

      {/* Mobile hamburger + drawer — hidden at md via CSS inside component */}
      <div className="block md:hidden">
        <MobileNav />
      </div>

      {/* Main content — pt-14 on mobile for top bar, p-4 mobile / p-8 desktop */}
      <main className="flex-1 overflow-y-auto p-4 pt-18 pb-8 md:h-screen md:p-8 md:pt-8">
        {children}
      </main>
    </div>
  );
}
