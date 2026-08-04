"use client";

import { type ReactNode, useState } from "react";
import { Menu } from "lucide-react";
import { Sidebar } from "@/components/admin/sidebar";
import { Toaster } from "@/components/ui/toast";
import { useCurrentAdmin } from "@/hooks/use-current-admin";

export default function ShellLayout({ children }: { children: ReactNode }) {
  const { data, isLoading } = useCurrentAdmin();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      <Sidebar mobileOpen={mobileNavOpen} onCloseMobile={() => setMobileNavOpen(false)} />
      <div className="flex-1">
        <header className="flex h-14 items-center justify-between border-b border-ink-100 bg-cream-50 px-4 sm:px-6">
          <button
            onClick={() => setMobileNavOpen(true)}
            className="text-ink-600 lg:hidden"
            aria-label="Open menu"
          >
            <Menu size={22} />
          </button>
          <span className="ml-auto text-sm text-ink-500">{isLoading ? "Loading…" : data?.admin.name}</span>
        </header>
        <main className="p-4 sm:p-8">{children}</main>
      </div>
      <Toaster />
    </div>
  );
}
