"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ExternalLink, Menu, Plus, Search } from "lucide-react";
import { MobileBottomNav, Sidebar } from "@/components/admin/sidebar";
import { Breadcrumbs } from "@/components/admin/breadcrumbs";
import { NotificationBell } from "@/components/admin/notification-bell";
import { CommandPalette, useCommandPaletteHotkey, useCreateCommands } from "@/components/admin/command-palette";
import { NAV_ICONS } from "@/components/admin/nav-icons";
import { ShortcutHelp } from "@/components/admin/shortcut-help";
import { AccountMenu } from "@/components/admin/account-menu";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { Toaster } from "@/components/ui/toast";
import { useNavAccess } from "@/hooks/use-nav-access";
import { useShortcut } from "@/hooks/use-shortcut";
import { documentTitleFor, goTargets } from "@/lib/admin/navigation";

export default function ShellLayout({ children }: { children: ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useCommandPaletteHotkey();
  const [createOpen, setCreateOpen] = useState(false);
  const createRef = useRef<HTMLButtonElement>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const access = useNavAccess();
  // The Create menu: the navigation manifest's create commands this admin may run, each with its module's icon.
  const createItems = useCreateCommands().map((c) => ({
    label: c.label,
    icon: c.node.icon ? NAV_ICONS[c.node.icon] : Plus,
    onClick: () => router.push(c.route),
  }));

  // Page titles come from the navigation manifest — one place names every admin page.
  useEffect(() => {
    document.title = documentTitleFor(pathname);
  }, [pathname]);

  // Global shortcuts (lib/admin/shortcuts.ts). They stand down while typing or while any overlay is open.
  useShortcut("create.open", () => setCreateOpen(true), { enabled: createItems.length > 0 });
  useShortcut("help.open", () => setHelpOpen(true));
  useShortcut("search.focus", () => {
    // A page that has its own search box marks it with data-page-search; otherwise "/" opens the palette.
    const field = document.querySelector<HTMLInputElement>("[data-page-search]");
    if (field) field.focus();
    else setPaletteOpen(true);
  });
  useShortcut("nav.goTo", (_event, key) => {
    const target = goTargets(access).find((t) => t.key === key);
    if (target) router.push(target.href);
  });

  // "⌘K" on Apple keyboards, "Ctrl K" elsewhere — read after mount, the server can't know.
  const [modKey, setModKey] = useState("Ctrl");
  useEffect(() => {
    if (/Mac|iPhone|iPad/.test(navigator.platform)) setModKey("⌘");
  }, []);

  return (
    // data-surface="admin": the Store Console's own tokens (Apple-style, light only), whatever the store's brand theme.
    // Overlays render inside this element, so modals, drawers and toasts carry the same surface.
    <div data-surface="admin" className="flex h-screen overflow-hidden bg-canvas font-sans text-fg">
      <div className="print:hidden">
        <Sidebar mobileOpen={mobileNavOpen} onCloseMobile={() => setMobileNavOpen(false)} />
      </div>
      {/* min-w-0 overrides the flex item's default min-width:auto — without it, a flex child never
          shrinks below its content's natural width (e.g. a wide table), which forces the whole page
          wider than the viewport instead of letting that content scroll within itself.

          This column owns its own vertical scroll (h-screen + overflow-y-auto on the outer flex
          container) so the sidebar next to it — a plain in-flow flex item, not itself fixed/sticky —
          never scrolls out of view: it only ever needs to be as tall as this column's viewport-height
          box, never as tall as the page content inside it.

          Below lg the mobile bottom bar sits UNDER that scrolling box, in normal flow — not fixed over it — so the
          scroll viewport ends above the bar and no content (or a page's own sticky toolbar) can be hidden behind it. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          <header className="glass sticky top-0 z-20 flex h-header shrink-0 items-center gap-3 border-b border-ink-900/[0.08] px-4 print:hidden sm:px-6">
            <button onClick={() => setMobileNavOpen(true)} className="-ml-1 rounded-md p-1 text-ink-600 hover:bg-ink-900/[0.05] lg:hidden" aria-label="Open menu">
              <Menu size={20} />
            </button>

            <Breadcrumbs className="hidden min-w-0 md:flex" />

            <button
              onClick={() => setPaletteOpen(true)}
              className="ml-auto flex h-8 min-w-0 items-center gap-2 rounded-lg bg-ink-900/[0.05] px-2.5 text-[13px] text-fg-subtle transition-colors duration-fast ease-smooth hover:bg-ink-900/[0.08] hover:text-fg-muted sm:w-64"
              aria-label="Search"
            >
              <Search size={14} className="shrink-0" />
              <span className="hidden truncate sm:inline">Search</span>
              <kbd className="ml-auto hidden shrink-0 font-sans text-[11px] font-medium text-fg-subtle sm:inline">{modKey} K</kbd>
            </button>

            <div className="flex items-center gap-1.5">
              {createItems.length > 0 && (
                <>
                  <button
                    ref={createRef}
                    onClick={() => setCreateOpen((o) => !o)}
                    aria-label="Create"
                    aria-haspopup="menu"
                    aria-expanded={createOpen}
                    title="Create"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-700 transition-colors duration-fast ease-smooth hover:bg-ink-900/[0.06] hover:text-fg"
                  >
                    <Plus size={18} />
                  </button>
                  <DropdownMenu open={createOpen} onClose={() => setCreateOpen(false)} anchorRef={createRef} items={createItems} />
                </>
              )}
              <Link
                href="/"
                target="_blank"
                rel="noreferrer"
                aria-label="View store (opens in a new tab)"
                title="View store"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-700 transition-colors duration-fast ease-smooth hover:bg-ink-900/[0.06] hover:text-fg"
              >
                <ExternalLink size={16} />
              </Link>
              <NotificationBell />
              <span className="mx-1.5 h-5 w-px bg-ink-900/[0.1]" aria-hidden />
              <AccountMenu onShowShortcuts={() => setHelpOpen(true)} />
            </div>
          </header>
          <main className="flex-1 px-4 py-6 sm:px-page sm:py-8 print:p-0">
            <div className="mx-auto w-full max-w-[1320px]">
              <Breadcrumbs className="mb-3 print:hidden md:hidden" />
              {children}
            </div>
          </main>
        </div>
        <MobileBottomNav onOpenMore={() => setMobileNavOpen(true)} />
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
      <Toaster />
    </div>
  );
}
