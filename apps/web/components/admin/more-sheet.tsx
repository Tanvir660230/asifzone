"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion, useDragControls, type PanInfo } from "framer-motion";
import { ChevronLeft, ChevronRight, ExternalLink, Search } from "lucide-react";
import { ancestryOf, moduleOf, navTree, resolveNavNode, type NavItem } from "@/lib/admin/navigation";
import { useNavAccess, useNavBadges } from "@/hooks/use-nav-access";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { transitions } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { NAV_ICONS } from "./nav-icons";
import { StoreIdentity } from "./sidebar";

/**
 * Phones: the whole console's navigation as an iOS sheet, opened from the tab bar's "More". Grouped inset lists like
 * Settings — every module the admin may open, with its queue count; a module with pages pushes to its own list
 * ("‹ Menu" goes back). Drag the sheet down, tap the dimmed page or "Done" to close.
 */
export function MoreSheet({ open, onClose, onSearch }: { open: boolean; onClose: () => void; onSearch: () => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const panelRef = useFocusTrap<HTMLDivElement>({ active: open, onEscape: onClose });
  const pathname = usePathname();
  const access = useNavAccess();
  const badges = useNavBadges();
  const current = resolveNavNode(pathname);
  const activeModuleId = current ? moduleOf(current).id : null;
  const trail = new Set(current ? ancestryOf(current).map((n) => n.id) : []);
  const tree = access.ready ? navTree(access) : [];
  const [pushed, setPushed] = useState<NavItem | null>(null);
  const dragControls = useDragControls();

  // Each opening starts at the top-level list.
  useEffect(() => {
    if (open) setPushed(null);
  }, [open]);

  function onDragEnd(_: unknown, info: PanInfo) {
    if (info.offset.y > 120 || info.velocity.y > 600) onClose();
  }

  if (!mounted) return null;

  const badgeOf = (item: NavItem) => (item.node.badge ? badges[item.node.badge] : 0);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-overlay md:hidden" data-surface="admin">
          <motion.div
            className="ui-overlay absolute inset-0"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: transitions.smooth }}
            exit={{ opacity: 0, transition: transitions.exit }}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            tabIndex={-1}
            drag="y"
            dragListener={false}
            dragControls={dragControls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={onDragEnd}
            initial={{ y: "100%" }}
            animate={{ y: 0, transition: transitions.page }}
            exit={{ y: "100%", transition: transitions.smooth }}
            className="absolute inset-x-0 bottom-0 flex h-[calc(100dvh-env(safe-area-inset-top)-12px)] flex-col overflow-hidden rounded-t-[22px] bg-canvas shadow-floatLg outline-none"
          >
            {/* The sheet drags down from its header (grabber and title bar); the list below scrolls normally. */}
            <div className="shrink-0 touch-none" onPointerDown={(e) => dragControls.start(e)}>
            <div className="flex justify-center pb-1 pt-2" aria-hidden>
              <span className="h-[5px] w-9 rounded-full bg-ink-900/[0.15]" />
            </div>

            <div className="flex h-11 items-center justify-between px-2">
              {pushed ? (
                <button type="button" onClick={() => setPushed(null)} className="flex h-11 items-center pr-2 text-[17px] tracking-[-0.02em] text-accent active:opacity-50">
                  <ChevronLeft size={28} strokeWidth={2.2} className="-mr-0.5" aria-hidden />
                  Menu
                </button>
              ) : (
                <span className="w-16" />
              )}
              <p className="truncate text-[17px] font-semibold tracking-[-0.02em] text-fg">{pushed ? pushed.node.label : "Menu"}</p>
              <button type="button" onClick={onClose} className="h-11 w-16 pr-2 text-right text-[17px] font-semibold tracking-[-0.02em] text-accent active:opacity-50">
                Done
              </button>
            </div>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-2">
              {pushed ? (
                <InsetGroup>
                  <SheetRow href={pushed.href} label={`All of ${pushed.node.label}`} active={pathname === pushed.href} onNavigate={onClose} />
                  {pushed.children.map((child) => (
                    <SheetRow key={child.node.id} href={child.href} label={child.node.label} active={trail.has(child.node.id)} onNavigate={onClose} />
                  ))}
                </InsetGroup>
              ) : (
                <div className="space-y-6">
                  <div className="flex items-center gap-3 px-1">
                    <StoreIdentity collapse={false} />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onSearch();
                    }}
                    className="flex h-10 w-full items-center gap-2 rounded-[10px] bg-ink-900/[0.06] px-3 text-left text-[17px] tracking-[-0.02em] text-fg-subtle"
                  >
                    <Search size={17} aria-hidden />
                    Search
                  </button>

                  {!access.ready && (
                    <div className="h-64 animate-pulse rounded-xl bg-ink-900/[0.05]" aria-busy="true" aria-label="Loading menu" />
                  )}

                  {tree.map((group) =>
                    group.modules.length === 0 ? null : (
                      <section key={group.domain} aria-label={group.label ?? (group.domain === "system" ? "Store administration" : "Overview")}>
                        {group.label && <h2 className="mb-1.5 px-4 text-[13px] text-fg-muted">{group.label}</h2>}
                        <InsetGroup>
                          {group.modules.map((item) => {
                            const Icon = item.node.icon ? NAV_ICONS[item.node.icon] : undefined;
                            const badge = badgeOf(item);
                            const active = item.node.id === activeModuleId;
                            const rowContent = (
                              <>
                                <span className={cn("flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[8px]", active ? "bg-accent text-accent-fg" : "bg-accent/10 text-accent")}>
                                  {Icon && <Icon size={17} strokeWidth={2} aria-hidden />}
                                </span>
                                <span className={cn("min-w-0 flex-1 truncate", active && "font-semibold")}>{item.node.label}</span>
                                {badge > 0 && (
                                  <span className="shrink-0 tabular-nums text-fg-muted" aria-label={`${badge} waiting`}>
                                    {badge > 99 ? "99+" : badge}
                                  </span>
                                )}
                                <ChevronRight size={18} className="shrink-0 text-ink-300" aria-hidden />
                              </>
                            );
                            return item.children.length > 0 ? (
                              <button key={item.node.id} type="button" onClick={() => setPushed(item)} className={rowClass}>
                                {rowContent}
                              </button>
                            ) : (
                              <Link key={item.node.id} href={item.href} onClick={onClose} aria-current={active ? "page" : undefined} className={rowClass}>
                                {rowContent}
                              </Link>
                            );
                          })}
                        </InsetGroup>
                      </section>
                    ),
                  )}

                  <InsetGroup>
                    <a href="/" target="_blank" rel="noreferrer" className={rowClass}>
                      <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[8px] bg-ink-900/[0.07] text-ink-700">
                        <ExternalLink size={16} strokeWidth={2} aria-hidden />
                      </span>
                      <span className="flex-1">View store</span>
                    </a>
                  </InsetGroup>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

// One row of an inset grouped list: 44pt minimum, a hairline between rows that starts after the icon.
const rowClass =
  "relative flex min-h-11 w-full items-center gap-3 px-3.5 py-2 text-left text-[17px] tracking-[-0.02em] text-fg transition-colors duration-fast active:bg-ink-900/[0.06] [&:not(:last-child)]:after:absolute [&:not(:last-child)]:after:bottom-0 [&:not(:last-child)]:after:left-[56px] [&:not(:last-child)]:after:right-0 [&:not(:last-child)]:after:h-px [&:not(:last-child)]:after:bg-ink-900/[0.08]";

function InsetGroup({ children }: { children: React.ReactNode }) {
  return <div className="overflow-hidden rounded-xl bg-surface">{children}</div>;
}

function SheetRow({ href, label, active, onNavigate }: { href: string; label: string; active: boolean; onNavigate: () => void }) {
  return (
    <Link href={href} onClick={onNavigate} aria-current={active ? "page" : undefined} className={cn(rowClass, "py-2.5 [&:not(:last-child)]:after:left-3.5", active && "font-semibold")}>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {active && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden />}
      <ChevronRight size={18} className="shrink-0 text-ink-300" aria-hidden />
    </Link>
  );
}
