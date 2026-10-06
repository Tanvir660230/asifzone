"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, LogOut, MoreHorizontal, PanelLeftClose, PanelLeftOpen, ShieldOff, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { logoutAdmin, logoutAllDevices } from "@/lib/auth";
import { ancestryOf, moduleOf, navTree, resolveNavNode, type NavItem } from "@/lib/admin/navigation";
import { useNavAccess, useNavBadges } from "@/hooks/use-nav-access";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { toast } from "@/components/ui/toast";
import { NAV_ICONS } from "./nav-icons";

/**
 * The admin sidebar — rendered entirely from the navigation manifest (lib/admin/navigation.ts): modules grouped by
 * domain (Operate / Grow / Manage, Settings and Administration in the footer), the active module expanded one level,
 * work-queue badges, capability and feature-flag visibility. No route list lives here.
 *
 * Desktop: 232px, or a 56px icon rail with a flyout per module (both widths are density tokens). Mobile: an off-canvas
 * drawer with the full tree plus a bottom bar of the primary destinations (MobileBottomNav).
 */

const COLLAPSE_STORAGE_KEY = "admin-sidebar-collapsed";

interface SidebarProps {
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}

function formatBadge(count: number) {
  return count > 99 ? "99+" : String(count);
}

export function Sidebar({ mobileOpen = false, onCloseMobile }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const [signingOutEverywhere, setSigningOutEverywhere] = useState(false);
  const access = useNavAccess();
  const badges = useNavBadges();
  const drawerRef = useFocusTrap<HTMLElement>({
    active: mobileOpen,
    onEscape: () => onCloseMobile?.(),
  });

  // Desktop-only compact mode — read from storage after mount (localStorage isn't available
  // during SSR, so starting expanded and correcting client-side avoids a hydration mismatch, at
  // the cost of a brief flash back to expanded for a returning admin who'd collapsed it before).
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    if (localStorage.getItem(COLLAPSE_STORAGE_KEY) === "true") setCollapsed(true);
  }, []);
  useEffect(() => {
    localStorage.setItem(COLLAPSE_STORAGE_KEY, String(collapsed));
  }, [collapsed]);

  const tree = navTree(access);
  const current = resolveNavNode(pathname);
  const trail = new Set(current ? ancestryOf(current).map((n) => n.id) : []);
  const activeModuleId = current ? moduleOf(current).id : null;
  const mainGroups = tree.filter((g) => g.domain !== "system");
  const footerModules = tree.find((g) => g.domain === "system")?.modules ?? [];

  async function handleLogout() {
    await logoutAdmin();
    router.replace("/admin/login");
  }

  async function handleLogoutEverywhere() {
    if (!(await confirm("Sign out of every device and browser signed in as you? You'll need to log in again here too.")))
      return;
    setSigningOutEverywhere(true);
    try {
      await logoutAllDevices();
      router.replace("/admin/login");
    } catch {
      toast.error("Couldn't sign out of all devices — try again.");
      setSigningOutEverywhere(false);
    }
  }

  function moduleRow(item: NavItem, collapse: boolean) {
    return (
      <ModuleRow
        key={item.node.id}
        item={item}
        collapse={collapse}
        active={item.node.id === activeModuleId}
        trail={trail}
        badge={item.node.badge ? badges[item.node.badge] : 0}
        onNavigate={onCloseMobile}
      />
    );
  }

  /** Rendered twice — once for the persistent desktop rail (which may be collapsed) and once for
   * the mobile drawer (always full width, never collapsed, regardless of the desktop preference). */
  function renderNav({ collapse, mobileDrawer }: { collapse: boolean; mobileDrawer: boolean }) {
    return (
      <>
        <div className={cn("flex h-[68px] shrink-0 items-center border-b border-ink-800/70", collapse ? "justify-center px-2" : "justify-between px-5")}>
          <span className="font-display text-lg tracking-wide text-cream-50">{collapse ? "SC" : "Store Console"}</span>
          {mobileDrawer && (
            <button onClick={onCloseMobile} className="text-cream-200" aria-label="Close menu">
              <X size={20} />
            </button>
          )}
        </div>

        <nav aria-label="Admin" aria-busy={!access.ready} className={cn("flex-1 space-y-5 overflow-y-auto overflow-x-hidden py-4", collapse ? "px-2" : "px-3")}>
          {/* Until the admin profile arrives nothing is known to be allowed — a neutral placeholder rather than a partial
              menu that rearranges itself a moment later. */}
          {!access.ready && (
            <div className="space-y-2 px-1" aria-hidden>
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className={cn("h-8 animate-pulse rounded-lg bg-ink-800/70", collapse ? "mx-auto w-8" : "w-full")} />
              ))}
            </div>
          )}
          {access.ready && mainGroups.map((group) => (
            <div key={group.domain}>
              {group.label && !collapse && <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-ink-500">{group.label}</p>}
              {group.label && collapse && <div className="mx-2 mb-2 border-t border-ink-800/70" aria-hidden />}
              <div className="space-y-0.5">{group.modules.map((m) => moduleRow(m, collapse))}</div>
            </div>
          ))}
        </nav>

        <div className={cn("mb-3 mt-1 space-y-0.5 border-t border-ink-800/70 pt-3", collapse ? "mx-2" : "mx-3")}>
          {access.ready && footerModules.map((m) => moduleRow(m, collapse))}
          <button
            onClick={handleLogout}
            title={collapse ? "Log out" : undefined}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg py-2 text-sm text-cream-300/90 transition-colors duration-200 ease-smooth hover:bg-ink-800 hover:text-cream-50",
              collapse ? "justify-center px-0" : "px-3",
            )}
          >
            <LogOut size={18} className="shrink-0" />
            {!collapse && "Log out"}
          </button>
          <button
            onClick={handleLogoutEverywhere}
            disabled={signingOutEverywhere}
            title={collapse ? "Log out of all devices" : undefined}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg py-2 text-xs text-ink-500 transition-colors duration-200 ease-smooth hover:bg-ink-800 hover:text-cream-200 disabled:opacity-50",
              collapse ? "justify-center px-0" : "px-3",
            )}
          >
            <ShieldOff size={15} className="shrink-0" />
            {!collapse && (signingOutEverywhere ? "Signing out everywhere…" : "Log out of all devices")}
          </button>
          {!mobileDrawer && (
            <button
              onClick={() => setCollapsed((c) => !c)}
              aria-label={collapse ? "Expand sidebar" : "Collapse sidebar"}
              className={cn(
                "mt-1 flex w-full items-center gap-3 rounded-lg py-2 text-xs text-ink-500 transition-colors duration-200 ease-smooth hover:bg-ink-800 hover:text-cream-200",
                collapse ? "justify-center px-0" : "px-3",
              )}
            >
              {collapse ? <PanelLeftOpen size={16} className="shrink-0" /> : <PanelLeftClose size={16} className="shrink-0" />}
              {!collapse && "Collapse"}
            </button>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      {/* Desktop: static, collapsible sidebar */}
      <aside
        className={cn(
          "hidden h-screen shrink-0 flex-col border-r border-ink-800 bg-ink-950 text-cream-100 transition-[width] duration-300 ease-smooth lg:flex",
          collapsed ? "w-sidebar-collapsed" : "w-sidebar",
        )}
      >
        {renderNav({ collapse: collapsed, mobileDrawer: false })}
      </aside>

      {/* Mobile: off-canvas drawer — always full width/labels, independent of the desktop preference.
          z-50, not z-40: this is a full-screen nav overlay, the same role as Modal/Drawer (both
          z-50) — at z-40 it tied with page-level floating bars like the Orders bulk-action bar
          (also fixed, z-40), and on a tie the later-in-DOM element wins, so that bar rendered on
          top of the open drawer instead of being covered by it. */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 animate-fade-in bg-ink-950/50 backdrop-blur-sm" onClick={onCloseMobile} />
          <aside
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            tabIndex={-1}
            className="relative flex h-full w-64 animate-modal-in flex-col bg-ink-950 text-cream-100 shadow-floatLg"
          >
            {renderNav({ collapse: false, mobileDrawer: true })}
          </aside>
        </div>
      )}
      {confirmDialog}
    </>
  );
}

const rowClass = (active: boolean, collapse: boolean) =>
  cn(
    "relative flex items-center gap-3 rounded-lg py-2 text-sm font-medium transition-all duration-200 ease-smooth",
    collapse ? "justify-center px-0" : "px-3",
    active ? "bg-white/[0.08] text-cream-50" : "text-cream-300/90 hover:translate-x-0.5 hover:bg-ink-800 hover:text-cream-50",
  );

/** One module: its link (the module's index route), and — when it's the active module — its pages, one level deep.
 * Collapsed, the pages open in a flyout beside the rail on hover or keyboard focus. */
function ModuleRow({
  item,
  collapse,
  active,
  trail,
  badge,
  onNavigate,
}: {
  item: NavItem;
  collapse: boolean;
  active: boolean;
  trail: Set<string>;
  badge: number;
  onNavigate?: () => void;
}) {
  const { node, href, children } = item;
  const Icon = node.icon ? NAV_ICONS[node.icon] : undefined;
  const [flyoutTop, setFlyoutTop] = useState<number | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  function openFlyout() {
    if (!collapse) return;
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setFlyoutTop(rowRef.current?.getBoundingClientRect().top ?? null);
  }
  function scheduleClose() {
    closeTimer.current = setTimeout(() => setFlyoutTop(null), 120);
  }
  useEffect(() => () => void (closeTimer.current && clearTimeout(closeTimer.current)), []);
  useEffect(() => {
    if (!collapse) setFlyoutTop(null);
  }, [collapse]);

  return (
    <div
      ref={rowRef}
      onMouseEnter={openFlyout}
      onMouseLeave={scheduleClose}
      onFocus={openFlyout}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) scheduleClose();
      }}
    >
      <Link href={href} onClick={onNavigate} title={collapse && flyoutTop === null ? node.label : undefined} aria-current={active && trail.size === 1 ? "page" : undefined} className={rowClass(active, collapse)}>
        {active && <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-cream-50" aria-hidden />}
        {Icon && (
          <span className="relative shrink-0">
            <Icon size={18} />
            {collapse && badge > 0 && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-warning-500 ring-2 ring-ink-950" aria-hidden />}
          </span>
        )}
        {!collapse && <span className="truncate">{node.label}</span>}
        {!collapse && badge > 0 && (
          <span className="ml-auto shrink-0 rounded-full bg-cream-50/10 px-1.5 py-px text-[11px] font-semibold tabular-nums text-cream-100" aria-label={`${badge} waiting`}>
            {formatBadge(badge)}
          </span>
        )}
        {!collapse && badge === 0 && children.length > 0 && (
          <ChevronDown size={14} className={cn("ml-auto shrink-0 text-ink-500 transition-transform duration-200", !active && "-rotate-90")} aria-hidden />
        )}
      </Link>

      {!collapse && active && children.length > 0 && (
        <div className="mb-1 ml-[22px] mt-0.5 space-y-px border-l border-ink-800 pl-2.5">
          {children.map((child) => {
            const childActive = trail.has(child.node.id);
            return (
              <Link
                key={child.node.id}
                href={child.href}
                onClick={onNavigate}
                aria-current={childActive ? "page" : undefined}
                className={cn(
                  "block truncate rounded-md px-2.5 py-1.5 text-[13px] transition-colors duration-150 ease-smooth",
                  childActive ? "bg-white/[0.06] font-medium text-cream-50" : "text-cream-300/80 hover:bg-ink-800 hover:text-cream-50",
                )}
              >
                {child.node.label}
              </Link>
            );
          })}
        </div>
      )}

      {collapse && flyoutTop !== null && (
        <div
          role="group"
          aria-label={node.label}
          style={{ top: flyoutTop }}
          className="fixed left-sidebar-collapsed z-overlay ml-1 min-w-48 animate-pop-in rounded-xl border border-ink-800 bg-ink-950 p-1.5 text-cream-100 shadow-floatLg"
        >
          <Link href={href} onClick={onNavigate} className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-cream-50 hover:bg-ink-800">
            {node.label}
            {badge > 0 && <span className="rounded-full bg-cream-50/10 px-1.5 py-px text-[11px] tabular-nums">{formatBadge(badge)}</span>}
          </Link>
          {children.map((child) => (
            <Link
              key={child.node.id}
              href={child.href}
              onClick={onNavigate}
              aria-current={trail.has(child.node.id) ? "page" : undefined}
              className={cn(
                "block rounded-lg px-2.5 py-1.5 text-[13px] hover:bg-ink-800 hover:text-cream-50",
                trail.has(child.node.id) ? "text-cream-50" : "text-cream-300/80",
              )}
            >
              {child.node.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/** Mobile bottom bar: the manifest's `mobile: "primary"` destinations plus "More" (the full navigation drawer). Rendered
 * by the shell below its scrolling column, in flow — never fixed over the content. */
export function MobileBottomNav({ onOpenMore }: { onOpenMore: () => void }) {
  const pathname = usePathname();
  const access = useNavAccess();
  const badges = useNavBadges();
  const current = resolveNavNode(pathname);
  const activeModuleId = current ? moduleOf(current).id : null;
  const primary = navTree(access)
    .flatMap((g) => g.modules)
    .filter((m) => m.node.mobile === "primary");
  if (!access.ready || primary.length === 0) return null;

  return (
    <nav
      aria-label="Primary"
      className="flex h-14 shrink-0 border-t border-ink-800 bg-ink-950 pb-[env(safe-area-inset-bottom)] text-cream-300 print:hidden lg:hidden"
    >
      {primary.map(({ node, href }) => {
        const Icon = node.icon ? NAV_ICONS[node.icon] : undefined;
        const active = node.id === activeModuleId;
        const badge = node.badge ? badges[node.badge] : 0;
        return (
          <Link
            key={node.id}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn("relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium", active ? "text-cream-50" : "text-cream-300/80")}
          >
            {Icon && <Icon size={19} aria-hidden />}
            {node.breadcrumb ?? node.label}
            {badge > 0 && <span className="absolute right-[calc(50%-18px)] top-1.5 h-2 w-2 rounded-full bg-warning-500" aria-label={`${badge} waiting`} />}
          </Link>
        );
      })}
      <button type="button" onClick={onOpenMore} aria-label="More navigation" className="flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-cream-300/80">
        <MoreHorizontal size={19} aria-hidden />
        More
      </button>
    </nav>
  );
}
