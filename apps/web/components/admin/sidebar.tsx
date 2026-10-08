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
 * selection with a blue icon, quiet section labels. Desktop: `w-sidebar`, or a `w-sidebar-collapsed` rail — icon with a
 * short label under it, queue counts on the icon, and a flyout of the module's pages. Until the admin picks a width
 * (button or Ctrl/⌘ \), the rail follows the window (hooks/use-sidebar-collapse.ts). Collapsed, the module's pages also
 * show in the shell's section bar, so they never sit behind a hover.
 * Mobile: an off-canvas drawer with the full tree, plus a tab bar of the primary destinations (MobileBottomNav).
 * Signing out lives in the toolbar's account menu.
 */

interface SidebarProps {
  /** Desktop rail width — owned by the shell (hooks/use-sidebar-collapse.ts), which also decides the section bar. */
  collapsed: boolean;
  onToggleCollapsed: () => void;
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
    <span className={cn("flex shrink-0 items-center justify-center rounded-[10px] bg-ink-900 font-semibold text-cream-50", collapse ? "h-9 w-9 text-[15px]" : "h-9 w-9 text-[14px]")}>
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {settings?.faviconUrl ? (
        <StoreLogoImage src={resolveImageUrl(settings.faviconUrl)} alt="" className="h-9 w-9 shrink-0 rounded-[10px] object-contain" fallback={monogram} />
      ) : (
        monogram
      )}
      {!collapse && (
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[14px] font-semibold text-fg">{name}</p>
          <p className="text-[11.5px] text-fg-muted">Store Console</p>
        </div>
      )}
    </div>
  );
}

export function Sidebar({ collapsed, onToggleCollapsed: toggleCollapsed, mobileOpen = false, onCloseMobile }: SidebarProps) {
  const pathname = usePathname();
  const access = useNavAccess();
  const badges = useNavBadges();
  const drawerRef = useFocusTrap<HTMLElement>({
    active: mobileOpen,
    onEscape: () => onCloseMobile?.(),
  });

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

        <nav aria-label="Admin" aria-busy={!access.ready} className={cn("flex-1 overflow-y-auto overflow-x-hidden pb-4 pt-2", collapse ? "space-y-2.5 px-2" : "space-y-5 px-3")}>
          {/* Until the admin profile arrives nothing is known to be allowed — a neutral placeholder rather than a partial
              menu that rearranges itself a moment later. */}
          {!access.ready && (
            <div className="space-y-1.5 px-1" aria-hidden>
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className={cn("animate-pulse bg-ink-900/[0.05]", collapse ? "mx-auto h-12 w-full rounded-xl" : "h-8 w-full rounded-lg")} />
              ))}
            </div>
          )}
          {access.ready &&
            mainGroups.map((group) => (
              <div key={group.domain}>
                {group.label && !collapse && <p className="mb-1 px-2.5 text-[11px] font-semibold text-fg-subtle">{group.label}</p>}
                {group.label && collapse && <div className="mx-4 mb-2 border-t border-ink-900/[0.08]" aria-hidden />}
                <div className={collapse ? "space-y-0.5" : "space-y-px"}>{group.modules.map((m) => moduleRow(m, collapse))}</div>
              </div>
            ))}
        </nav>

        <div className={cn("mb-3 border-t border-ink-900/[0.08] pt-3", collapse ? "mx-2 space-y-0.5" : "mx-3 space-y-px")}>
          {access.ready && footerModules.map((m) => moduleRow(m, collapse))}
          {!mobileDrawer && (
            <button
              onClick={toggleCollapsed}
              aria-label={collapse ? "Expand sidebar" : "Collapse sidebar"}
              aria-keyshortcuts={"Control+\\ Meta+\\"}
              title={collapse ? "Expand sidebar (Ctrl/⌘ \\)" : "Collapse sidebar (Ctrl/⌘ \\)"}
              className={cn(
                "group/toggle flex items-center gap-2.5 text-[13px] text-fg-muted transition-colors duration-fast ease-smooth hover:bg-ink-900/[0.05] hover:text-fg",
                collapse ? "mx-auto h-9 w-full justify-center rounded-xl px-0" : "h-8 w-full rounded-lg px-2.5",
              )}
            >
              {collapse ? <PanelLeftOpen size={18} className="shrink-0" /> : <PanelLeftClose size={16} className="shrink-0" />}
              {!collapse && (
                <>
                  Collapse sidebar
                  <kbd className="ml-auto font-sans text-[11px] text-fg-subtle opacity-0 transition-opacity duration-fast group-hover/toggle:opacity-100">Ctrl \</kbd>
                </>
              )}
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
    "group relative flex transition-colors duration-fast ease-smooth",
    // Collapsed: a tile per module — icon with a short label under it (a navigation rail), so the rail still reads
    // without hovering, not a squeezed text row.
    collapse ? "h-12 w-full flex-col items-center justify-center gap-1 rounded-xl px-1" : "h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px]",
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

  // The rail shows the module's name already — a flyout only earns its place when there are pages to pick.
  function openFlyout() {
    if (!collapse || children.length === 0) return;
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
      <Link
        href={href}
        onClick={onNavigate}
        aria-label={collapse ? (badge > 0 ? `${node.label}, ${badge} waiting` : node.label) : undefined}
        aria-current={active && trail.size === 1 ? "page" : undefined}
        className={rowClass(active, collapse)}
      >
        {Icon && (
          <span className={cn("relative shrink-0", active ? "text-accent" : "text-ink-500 group-hover:text-ink-700")}>
            <Icon size={collapse ? 20 : 17} strokeWidth={collapse ? 1.8 : 1.9} />
            {collapse && badge > 0 && (
              <span className="absolute -top-1.5 left-3 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold tabular-nums leading-none text-accent-fg ring-2 ring-cream-200" aria-hidden>
                {formatBadge(badge)}
              </span>
            )}
          </span>
        )}
        {collapse && (
          <span className={cn("max-w-full truncate text-[10.5px] leading-none tracking-[-0.005em]", active ? "text-fg" : "text-ink-600 group-hover:text-fg")} aria-hidden>
            {node.shortLabel ?? node.label}
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
    <nav aria-label="Primary" data-hide-on-keyboard="" className="glass flex shrink-0 border-t border-ink-900/[0.08] pb-[env(safe-area-inset-bottom)] print:hidden lg:hidden">
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
            {node.shortLabel ?? node.breadcrumb ?? node.label}
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
