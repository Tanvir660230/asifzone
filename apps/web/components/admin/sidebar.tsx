"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, MoreHorizontal, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { cn } from "@/lib/utils";
import * as settingsApi from "@/lib/api/settings";
import { resolveImageUrl } from "@/lib/image-url";
import { ancestryOf, moduleOf, navTree, resolveNavNode, type NavItem } from "@/lib/admin/navigation";
import { useNavAccess, useNavBadges } from "@/hooks/use-nav-access";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { StoreLogoImage } from "@/components/store-logo-image";
import { NAV_ICONS } from "./nav-icons";

/**
 * The admin sidebar — rendered entirely from the navigation manifest (lib/admin/navigation.ts): modules grouped by
 * domain (Operate / Grow / Manage, Settings and Administration in the footer), the active module expanded one level,
 * work-queue badges, capability and feature-flag visibility. No route list lives here.
 *
 * Look: a light, translucent source list in the manner of a Mac sidebar — the store's own name and logo on top, grey
 * selection with a blue icon, quiet section labels. Desktop: `w-sidebar`, or a `w-sidebar-collapsed` icon rail with a
 * flyout per module. Mobile: an off-canvas drawer with the full tree, plus a tab bar of the primary destinations
 * (MobileBottomNav). Signing out lives in the toolbar's account menu.
 */

const COLLAPSE_STORAGE_KEY = "admin-sidebar-collapsed";

interface SidebarProps {
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}

function formatBadge(count: number) {
  return count > 99 ? "99+" : String(count);
}

/** The store this console belongs to (Blueprint V2 §E): its logo and name from settings, never a fixed product name. */
function StoreIdentity({ collapse }: { collapse: boolean }) {
  const { data } = useQuery({ queryKey: ["settings"], queryFn: settingsApi.getSettings, staleTime: 5 * 60 * 1000 });
  const settings = data?.settings;
  const name = settings?.storeName ?? "Store";
  const monogram = (
    <span className={cn("flex shrink-0 items-center justify-center rounded-lg bg-ink-900 font-semibold text-cream-50", collapse ? "h-10 w-10 text-[15px]" : "h-8 w-8 text-[13px]")}>
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {settings?.faviconUrl ? (
        <StoreLogoImage src={resolveImageUrl(settings.faviconUrl)} alt="" className={cn("shrink-0 rounded-lg object-contain", collapse ? "h-10 w-10" : "h-8 w-8")} fallback={monogram} />
      ) : (
        monogram
      )}
      {!collapse && (
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[13px] font-semibold text-fg">{name}</p>
          <p className="text-[11px] text-fg-muted">Store Console</p>
        </div>
      )}
    </div>
  );
}

export function Sidebar({ mobileOpen = false, onCloseMobile }: SidebarProps) {
  const pathname = usePathname();
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
        <div className={cn("flex h-header shrink-0 items-center", collapse ? "justify-center px-2" : "justify-between px-4")}>
          <StoreIdentity collapse={collapse} />
          {mobileDrawer && (
            <button onClick={onCloseMobile} className="rounded-md p-1 text-fg-muted hover:bg-ink-900/[0.06]" aria-label="Close menu">
              <X size={18} />
            </button>
          )}
        </div>

        <nav aria-label="Admin" aria-busy={!access.ready} className={cn("flex-1 space-y-5 overflow-y-auto overflow-x-hidden pb-4 pt-2", collapse ? "px-2" : "px-3")}>
          {/* Until the admin profile arrives nothing is known to be allowed — a neutral placeholder rather than a partial
              menu that rearranges itself a moment later. */}
          {!access.ready && (
            <div className="space-y-1.5 px-1" aria-hidden>
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className={cn("animate-pulse bg-ink-900/[0.05]", collapse ? "mx-auto h-10 w-10 rounded-xl" : "h-8 w-full rounded-lg")} />
              ))}
            </div>
          )}
          {access.ready &&
            mainGroups.map((group) => (
              <div key={group.domain}>
                {group.label && !collapse && <p className="mb-1 px-2.5 text-[11px] font-semibold text-fg-subtle">{group.label}</p>}
                {group.label && collapse && <div className="mx-3 mb-2 border-t border-ink-900/[0.08]" aria-hidden />}
                <div className={collapse ? "space-y-1" : "space-y-px"}>{group.modules.map((m) => moduleRow(m, collapse))}</div>
              </div>
            ))}
        </nav>

        <div className={cn("mb-3 border-t border-ink-900/[0.08] pt-3", collapse ? "mx-2 space-y-1" : "mx-3 space-y-px")}>
          {access.ready && footerModules.map((m) => moduleRow(m, collapse))}
          {!mobileDrawer && (
            <button
              onClick={() => setCollapsed((c) => !c)}
              aria-label={collapse ? "Expand sidebar" : "Collapse sidebar"}
              title={collapse ? "Expand sidebar" : undefined}
              className={cn(
                "flex items-center gap-2.5 text-[13px] text-fg-muted transition-colors duration-fast ease-smooth hover:bg-ink-900/[0.05] hover:text-fg",
                collapse ? "mx-auto h-10 w-10 justify-center rounded-xl px-0" : "h-8 w-full rounded-lg px-2.5",
              )}
            >
              {collapse ? <PanelLeftOpen size={19} className="shrink-0" /> : <PanelLeftClose size={16} className="shrink-0" />}
              {!collapse && "Collapse sidebar"}
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
          "hidden h-screen shrink-0 flex-col border-r border-ink-900/[0.08] bg-cream-200/70 text-fg backdrop-blur-xl transition-[width] duration-slow ease-smooth lg:flex",
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
          <div className="ui-overlay absolute inset-0 animate-fade-in" onClick={onCloseMobile} />
          <aside
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            tabIndex={-1}
            className="relative flex h-full w-72 max-w-[85vw] animate-modal-in flex-col bg-cream-100 text-fg shadow-floatLg"
          >
            {renderNav({ collapse: false, mobileDrawer: true })}
          </aside>
        </div>
      )}
    </>
  );
}

const rowClass = (active: boolean, collapse: boolean) =>
  cn(
    "group relative flex items-center gap-2.5 text-[13.5px] transition-colors duration-fast ease-smooth",
    // Collapsed: a 40×40 rounded target per module (iPad / macOS icon rail), not a squeezed text row.
    collapse ? "mx-auto h-10 w-10 justify-center rounded-xl px-0" : "h-8 rounded-lg px-2.5",
    active ? "bg-ink-900/[0.07] font-semibold text-fg" : "font-medium text-ink-700 hover:bg-ink-900/[0.045] hover:text-fg",
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
        {Icon && (
          <span className={cn("relative shrink-0", active ? "text-accent" : "text-ink-500 group-hover:text-ink-700")}>
            <Icon size={collapse ? 20 : 17} strokeWidth={collapse ? 1.8 : 1.9} />
            {collapse && badge > 0 && <span className="absolute -right-1.5 -top-1 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-cream-200" aria-hidden />}
          </span>
        )}
        {!collapse && <span className="truncate">{node.label}</span>}
        {!collapse && badge > 0 && (
          <span className="ml-auto shrink-0 rounded-full bg-ink-900/[0.07] px-1.5 text-[11px] font-semibold leading-[18px] tabular-nums text-ink-600" aria-label={`${badge} waiting`}>
            {formatBadge(badge)}
          </span>
        )}
        {!collapse && badge === 0 && children.length > 0 && (
          <ChevronRight size={13} className={cn("ml-auto shrink-0 text-ink-400 transition-transform duration-base ease-smooth", active && "rotate-90")} aria-hidden />
        )}
      </Link>

      {!collapse && active && children.length > 0 && (
        <div className="mb-1 mt-px space-y-px pl-[30px]">
          {children.map((child) => {
            const childActive = trail.has(child.node.id);
            return (
              <Link
                key={child.node.id}
                href={child.href}
                onClick={onNavigate}
                aria-current={childActive ? "page" : undefined}
                className={cn(
                  "flex h-7 items-center truncate rounded-md px-2.5 text-[13px] transition-colors duration-fast ease-smooth",
                  childActive ? "bg-ink-900/[0.06] font-medium text-fg" : "text-fg-muted hover:bg-ink-900/[0.04] hover:text-fg",
                )}
              >
                {child.node.label}
              </Link>
            );
          })}
        </div>
      )}

      {collapse && flyoutTop !== null && (
        <div role="group" aria-label={node.label} style={{ top: flyoutTop }} className="ui-floating fixed left-sidebar-collapsed z-overlay ml-1.5 min-w-48 animate-pop-in p-1.5 text-fg">
          <Link href={href} onClick={onNavigate} className="ui-menu-item justify-between font-semibold">
            {node.label}
            {badge > 0 && <span className="text-[11px] tabular-nums opacity-70">{formatBadge(badge)}</span>}
          </Link>
          {children.map((child) => (
            <Link key={child.node.id} href={child.href} onClick={onNavigate} aria-current={trail.has(child.node.id) ? "page" : undefined} className="ui-menu-item">
              {child.node.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/** Mobile tab bar: the manifest's `mobile: "primary"` destinations plus "More" (the full navigation drawer). Rendered
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
    <nav aria-label="Primary" className="glass flex shrink-0 border-t border-ink-900/[0.08] pb-[env(safe-area-inset-bottom)] print:hidden lg:hidden">
      {primary.map(({ node, href }) => {
        const Icon = node.icon ? NAV_ICONS[node.icon] : undefined;
        const active = node.id === activeModuleId;
        const badge = node.badge ? badges[node.badge] : 0;
        return (
          <Link
            key={node.id}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn("relative flex h-[52px] flex-1 flex-col items-center justify-center gap-0.5 text-[10.5px] font-medium", active ? "text-accent" : "text-ink-500")}
          >
            {Icon && <Icon size={21} strokeWidth={active ? 2.1 : 1.8} aria-hidden />}
            {node.breadcrumb ?? node.label}
            {badge > 0 && <span className="absolute right-[calc(50%-17px)] top-1.5 h-2 w-2 rounded-full bg-danger-500 ring-2 ring-surface" aria-label={`${badge} waiting`} />}
          </Link>
        );
      })}
      <button type="button" onClick={onOpenMore} aria-label="More navigation" className="flex h-[52px] flex-1 flex-col items-center justify-center gap-0.5 text-[10.5px] font-medium text-ink-500">
        <MoreHorizontal size={21} strokeWidth={1.8} aria-hidden />
        More
      </button>
    </nav>
  );
}
