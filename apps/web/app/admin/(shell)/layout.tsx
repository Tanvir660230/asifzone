"use client";

import { type ReactNode, useState } from "react";
import { Menu } from "lucide-react";
import { Sidebar } from "@/components/admin/sidebar";
import { NotificationBell } from "@/components/admin/notification-bell";
import { Toaster } from "@/components/ui/toast";
import { useCurrentAdmin } from "@/hooks/use-current-admin";

export default function ShellLayout({ children }: { children: ReactNode }) {
  const { data, isLoading } = useCurrentAdmin();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      <div className="print:hidden">
        <Sidebar mobileOpen={mobileNavOpen} onCloseMobile={() => setMobileNavOpen(false)} />
      </div>
      {/* min-w-0 overrides the flex item's default min-width:auto — without it, a flex child never
          shrinks below its content's natural width (e.g. a wide table), which forces the whole page
          wider than the viewport instead of letting that content scroll within itself. */}
      <div className="min-w-0 flex-1">
        <header className="glass sticky top-0 z-20 flex h-14 items-center justify-between border-b border-ink-100/70 px-4 print:hidden sm:px-6">
          <button
            onClick={() => setMobileNavOpen(true)}
            className="text-ink-600 lg:hidden"
            aria-label="Open menu"
          >
            <Menu size={22} />
          </button>
          <div className="ml-auto flex items-center gap-3">
            <NotificationBell />
            <span className="text-sm text-ink-500">{isLoading ? "Loading…" : data?.admin.name}</span>
          </div>
        </header>
        <main className="p-4 sm:p-8 print:p-0">{children}</main>
      </div>
      <Toaster />
    </div>
  );
}
