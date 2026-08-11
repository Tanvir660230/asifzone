"use client";

import { type ReactNode, useState } from "react";
import Link from "next/link";
import { ExternalLink, Menu } from "lucide-react";
import { Sidebar } from "@/components/admin/sidebar";
import { NotificationBell } from "@/components/admin/notification-bell";
import { Toaster } from "@/components/ui/toast";
import { useCurrentAdmin } from "@/hooks/use-current-admin";

/** "Store Owner" -> "SO" — fallback avatar monogram, same convention as the storefront header's logo fallback. */
function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export default function ShellLayout({ children }: { children: ReactNode }) {
  const { data, isLoading } = useCurrentAdmin();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden">
      <div className="print:hidden">
        <Sidebar mobileOpen={mobileNavOpen} onCloseMobile={() => setMobileNavOpen(false)} />
      </div>
      {/* min-w-0 overrides the flex item's default min-width:auto — without it, a flex child never
          shrinks below its content's natural width (e.g. a wide table), which forces the whole page
          wider than the viewport instead of letting that content scroll within itself.

          This column owns its own vertical scroll (h-screen + overflow-y-auto on the outer flex
          container) so the sidebar next to it — a plain in-flow flex item, not itself fixed/sticky —
          never scrolls out of view: it only ever needs to be as tall as this column's viewport-height
          box, never as tall as the page content inside it. */}
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <header className="glass sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between border-b border-ink-100/70 px-4 print:hidden sm:px-6">
          <button onClick={() => setMobileNavOpen(true)} className="text-ink-600 lg:hidden" aria-label="Open menu">
            <Menu size={22} />
          </button>

          <div className="ml-auto flex items-center gap-4">
            <Link
              href="/"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 rounded-full border border-ink-200 px-3 py-1.5 text-xs font-medium text-ink-700 transition-colors duration-150 ease-smooth hover:border-ink-400 hover:text-ink-900"
            >
              <ExternalLink size={13} />
              <span className="hidden sm:inline">View store</span>
            </Link>
            <NotificationBell />
            <div className="flex items-center gap-2.5 border-l border-ink-200 pl-4">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink-900 text-xs font-semibold text-cream-50">
                {isLoading || !data ? "…" : getInitials(data.admin.name)}
              </span>
              <div className="hidden leading-tight sm:block">
                <p className="text-sm font-medium text-ink-900">{isLoading ? "Loading…" : data?.admin.name}</p>
                <p className="text-xs text-ink-400">{data?.admin.role === "OWNER" ? "Owner" : "Staff"}</p>
              </div>
            </div>
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-8 print:p-0">{children}</main>
      </div>
      <Toaster />
    </div>
  );
}
