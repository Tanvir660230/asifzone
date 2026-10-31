"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Search, X } from "lucide-react";
import { navHref, type NavNode } from "@/lib/nav-links";
import { resolveImageUrl } from "@/lib/image-url";
import { useSearchOverlayStore } from "@/store/search-overlay";
import { useMobileMenuStore } from "@/store/mobile-menu";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { useSheetDrag } from "@/hooks/use-sheet-drag";
import { cn } from "@/lib/utils";
import { TAHAFI_CARD, TAHAFI_PHOTO_GLASS } from "./styles";

const HELP_LINKS = [
  ["/track-order", "Track an order"],
  ["/shipping-returns", "Shipping & returns"],
  ["/faq", "FAQ"],
  ["/contact", "Contact"],
] as const;

/**
 * Phones: the Shop tab's sheet (store/mobile-menu.ts). A search field, then the pieces as photo tiles two to a row (the
 * homepage category cards, smaller), then the help pages on one white card — so a store with a few categories still fills
 * the sheet with something to tap rather than a column of names over empty space. Rises above the dock, drags to close.
 */
export function TahafiMenu({ categories }: { categories: NavNode[] }) {
  const open = useMobileMenuStore((s) => s.isOpen);
  const closeMenu = useMobileMenuStore((s) => s.close);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const openSearch = useSearchOverlayStore((s) => s.open);
  const pathname = usePathname();
  const panelRef = useFocusTrap<HTMLDivElement>({ active: open, onEscape: close });
  useSheetDrag(panelRef, close, open);

  function close() {
    closeMenu();
    setExpandedId(null);
  }

  // Any navigation (a link here, the browser's back button) closes the sheet.
  useEffect(() => {
    closeMenu();
    setExpandedId(null);
  }, [pathname, closeMenu]);

  if (!open) return null;
  const expanded = categories.find((cat) => cat.id === expandedId);

  return createPortal(
    <div className="ui-overlay ui-sheet-overlay fixed inset-x-0 bottom-[var(--dock-offset)] top-0 z-overlay animate-fade-in" onClick={close}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Shop"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="ui-sheet ui-sheet-large flex w-full flex-col overflow-hidden bg-canvas md:h-full"
      >
        <span className="ui-sheet-grabber" aria-hidden />
        <div data-sheet-handle className="flex shrink-0 items-center gap-2 px-4 pb-3 pt-4">
          <button
            type="button"
            onClick={() => {
              close();
              openSearch();
            }}
            className={`${TAHAFI_CARD} flex h-11 min-w-0 flex-1 items-center gap-2 rounded-full px-4 text-[0.9375rem] text-fg-muted`}
          >
            <Search size={17} aria-hidden="true" /> Search the store
          </button>
          <button type="button" onClick={close} aria-label="Close menu" className="-mr-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-fg">
            <X size={22} aria-hidden="true" />
          </button>
        </div>

        <nav aria-label="Shop" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6">
          <h2 className="mb-3 mt-2 text-[1.375rem] font-semibold tracking-tight text-fg">Shop</h2>
          <ul className="grid grid-cols-2 gap-3">
            {categories.map((cat) => (
              <li key={cat.id}>
                {cat.imageUrl ? (
                  <Link
                    data-surface="storefront"
                    href={navHref(cat)}
                    onClick={close}
                    className="ui-press relative block aspect-[4/5] overflow-hidden rounded-[1.375rem] bg-cream-200"
                  >
                    <Image src={resolveImageUrl(cat.imageUrl)} alt="" fill sizes="50vw" className="object-cover" />
                    <span className={`absolute inset-x-2 bottom-2 flex h-10 items-center rounded-full px-4 text-sm font-semibold text-cream-50 ${TAHAFI_PHOTO_GLASS}`}>
                      <span className="truncate">{cat.name}</span>
                    </span>
                  </Link>
                ) : (
                  // No photo (a menu link, a category not yet pictured): a plain card, not a large empty frame.
                  <Link href={navHref(cat)} onClick={close} className={`${TAHAFI_CARD} ui-press flex h-14 items-center justify-between px-4 text-[0.9375rem] font-semibold text-fg`}>
                    <span className="truncate">{cat.name}</span>
                    <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-fg-subtle" />
                  </Link>
                )}
                {cat.children.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setExpandedId(expandedId === cat.id ? null : cat.id)}
                    aria-expanded={expandedId === cat.id}
                    className="mt-1 flex h-9 items-center gap-1 px-1 text-[0.8125rem] font-medium text-fg-muted"
                  >
                    {cat.children.length} {cat.children.length === 1 ? "type" : "types"}
                    <ChevronRight size={14} aria-hidden="true" className={cn("transition-transform duration-200 ease-smooth", expandedId === cat.id && "rotate-90")} />
                  </button>
                )}
              </li>
            ))}
            <li className="col-span-2">
              <Link href="/search" onClick={close} className={`${TAHAFI_CARD} ui-press flex h-12 items-center justify-between px-5 text-[0.9375rem] font-semibold text-fg`}>
                All pieces
                <ChevronRight size={18} aria-hidden="true" />
              </Link>
            </li>
          </ul>

          {expanded && (
            <ul className={`${TAHAFI_CARD} mt-3 divide-y divide-line-subtle`} aria-label={`${expanded.name} types`}>
              {expanded.children.map((child) => (
                <li key={child.id}>
                  <Link href={`/category/${child.slug}`} onClick={close} className="flex min-h-12 items-center justify-between px-5 text-[0.9375rem] text-fg">
                    {child.name}
                    <ChevronRight size={16} aria-hidden="true" className="text-fg-subtle" />
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <h2 className="mb-3 mt-7 text-[1.375rem] font-semibold tracking-tight text-fg">Help</h2>
          <ul className={`${TAHAFI_CARD} divide-y divide-line-subtle`}>
            {HELP_LINKS.map(([href, label]) => (
              <li key={href}>
                <Link href={href} onClick={close} className="flex min-h-12 items-center justify-between px-5 text-[0.9375rem] text-fg">
                  {label}
                  <ChevronRight size={16} aria-hidden="true" className="text-fg-subtle" />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>,
    document.body,
  );
}
