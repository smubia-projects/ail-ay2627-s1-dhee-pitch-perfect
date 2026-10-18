import type { ReactNode } from "react";

import { MainNavbar } from "@/components/main-navbar";
import { BottomNav } from "@/components/bottom-nav";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Slim top nav (no sidebar) */}
      <MainNavbar />
      <main className="flex flex-1 flex-col pb-32">{children}</main>
      {/* Floating bottom dock with the circular main action */}
      <BottomNav />
    </div>
  );
}