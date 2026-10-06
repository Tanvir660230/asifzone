"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, Menu, Plus, Search } from "lucide-react";
import { Sidebar } from "@/components/admin/sidebar";
import { NotificationBell } from "@/components/admin/notification-bell";
import { CommandPalette, CREATE_ENTRIES, useCommandPaletteHotkey } from "@/components/admin/command-palette";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { Toaster } from "@/components/ui/toast";
import { useCurrentAdmin } from "@/hooks/use-current-admin";
import { adminCan } from "@/lib/auth";

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
  const [paletteOpen, setPaletteOpen] = useCommandPaletteHotkey();
  const [createOpen, setCreateOpen] = useState(false);
  const createRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const createItems = CREATE_ENTRIES.filter((e) => !e.permission || adminCan(data?.admin, e.permission)).map((e) => ({
    label: e.label,
    icon: e.icon,
    onClick: () => router.push(e.href),
  }));

  // "⌘K" on Apple keyboards, "Ctrl K" elsewhere — read after mount, the server can't know.
  const [modKey, setModKey] = useState("Ctrl");
  useEffect(() => {
    if (/Mac|iPhone|iPad/.test(navigator.platform)) setModKey("⌘");
  }, []);

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

          <button
            onClick={() => setPaletteOpen(true)}
            className="ml-3 flex h-9 min-w-0 items-center gap-2.5 rounded-full border border-ink-200 bg-cream-50/70 px-3 text-sm text-ink-400 transition-colors duration-150 ease-smooth hover:border-ink-300 hover:text-ink-600 sm:w-72 lg:ml-0"
            aria-label="Search"
          >
            <Search size={15} className="shrink-0" />
            <span className="hidden truncate sm:inline">Search orders, customers…</span>
            <kbd className="ml-auto hidden shrink-0 rounded border border-ink-200 bg-cream-50 px-1.5 py-0.5 font-sans text-[10px] font-medium text-ink-400 sm:inline">
              {modKey} K
            </kbd>
          </button>

          <div className="ml-auto flex items-center gap-3 sm:gap-4">
            {createItems.length > 0 && (
              <>
                <button
                  ref={createRef}
                  onClick={() => setCreateOpen((o) => !o)}
                  aria-label="Create"
                  aria-haspopup="menu"
                  aria-expanded={createOpen}
                  className="flex h-8 items-center gap-1.5 rounded-full bg-ink-900 px-3 text-xs font-medium text-cream-50 transition-colors duration-150 ease-smooth hover:bg-ink-700"
                >
                  <Plus size={14} />
                  <span className="hidden sm:inline">Create</span>
                </button>
                <DropdownMenu open={createOpen} onClose={() => setCreateOpen(false)} anchorRef={createRef} items={createItems} />
              </>
            )}
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
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <Toaster />
    </div>
  );
}
