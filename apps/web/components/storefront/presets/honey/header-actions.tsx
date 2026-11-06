"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Search, ShoppingBag, X } from "lucide-react";
import { navHref, type NavNode } from "@/lib/nav-links";
import { Money } from "@/components/ui/money";
import { useCartQuote } from "@/hooks/use-quote";
import { useCartCount } from "@/store/cart";
import { useCartDrawerStore } from "@/store/cart-drawer";
import { useSearchOverlayStore } from "@/store/search-overlay";
import { useMobileMenuStore } from "@/store/mobile-menu";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { useSheetDrag } from "@/hooks/use-sheet-drag";
import { cn } from "@/lib/utils";
import { bagLabel } from "../../count-badge";

/** The persisted cart count is only known in the browser — `null` until mounted, so server and client markup agree. */
function useMountedCartCount(): number | null {
  const count = useCartCount();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? count : null;
}

/** The search field. A button that looks like the field and opens the store's search panel, the same one every store uses. */
export function HoneySearchField() {
  const open = useSearchOverlayStore((s) => s.open);
  return (
    <button
      type="button"
      onClick={open}
      className="flex h-11 w-full items-center gap-2.5 rounded-[var(--control-radius)] border border-line bg-canvas px-3.5 text-left text-[0.9375rem] text-fg-muted transition-colors duration-200 ease-smooth hover:border-line-strong"
    >
      <Search size={19} strokeWidth={1.9} aria-hidden="true" />
      <span className="truncate">Search products</span>
    </button>
  );
}

/** The bag, in the store's one action colour, with what is in it. Opens the shared cart drawer. */
export function HoneyBagButton() {
  const count = useMountedCartCount();
  const { data: quote } = useCartQuote();
  const openDrawer = useCartDrawerStore((s) => s.open);
  return (
    <button
      type="button"
      onClick={openDrawer}
      aria-label={bagLabel("Bag", count ?? 0)}
      className="flex h-11 items-center gap-2 whitespace-nowrap rounded-[var(--control-radius)] bg-accent px-3.5 text-sm font-semibold text-accent-fg transition-colors duration-200 ease-smooth hover:bg-accent-hover"
    >
      <ShoppingBag size={20} strokeWidth={1.9} aria-hidden="true" />
      <span>Bag</span>
      {count ? <span className="font-bold tabular-nums">{quote ? <Money value={quote.subtotal} /> : count}</span> : null}
    </button>
  );
}

/** Phones: the whole store in one sheet — the categories, then help links. Opened by the tab bar's Shop tab
 * (store/mobile-menu.ts); it rises above the tab bar, and drags down to close. */
export function HoneyMenu({ categories }: { categories: NavNode[] }) {
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

  return (
    <>
      {open &&
        createPortal(
          <div className="ui-overlay ui-sheet-overlay fixed inset-x-0 bottom-[var(--dock-offset)] top-0 z-overlay animate-fade-in" onClick={close}>
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            className="ui-sheet ui-sheet-large flex w-full flex-col overflow-hidden bg-canvas md:h-full"
          >
            <span className="ui-sheet-grabber" aria-hidden />
            <div data-sheet-handle className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
              <button
                type="button"
                onClick={() => {
                  close();
                  openSearch();
                }}
                className="flex items-center gap-2 text-sm text-fg-muted"
              >
                <Search size={16} /> Search the store
              </button>
              <button type="button" onClick={close} aria-label="Close menu" className="-mr-2 flex h-11 w-11 items-center justify-center text-fg">
                <X size={22} />
              </button>
            </div>
            <nav aria-label="Categories" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6">
              <ul>
                {categories.map((cat) => {
                  const expanded = expandedId === cat.id;
                  return (
                    <li key={cat.id} className="border-b border-line">
                      <div className="flex items-center justify-between">
                        <Link href={navHref(cat)} onClick={close} className="flex-1 py-4 text-lg font-semibold leading-tight text-fg">
                          {cat.name}
                        </Link>
                        {cat.children.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setExpandedId(expanded ? null : cat.id)}
                            aria-expanded={expanded}
                            aria-label={`${cat.name}: show subcategories`}
                            className="flex h-11 w-11 items-center justify-center text-fg-muted"
                          >
                            <ChevronRight size={18} className={cn("transition-transform duration-200 ease-smooth", expanded && "rotate-90")} />
                          </button>
                        )}
                      </div>
                      {expanded && (
                        <ul className="pb-4">
                          {cat.children.map((child) => (
                            <li key={child.id}>
                              <Link href={`/category/${child.slug}`} onClick={close} className="block py-2 text-base text-fg-muted">
                                {child.name}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
              <ul className="mt-8 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                {/* Account, wishlist and the bag are tabs now; the menu keeps the help pages. */}
                {[
                  ["/track-order", "Track an order"],
                  ["/shipping-returns", "Shipping & returns"],
                  ["/faq", "FAQ"],
                  ["/contact", "Contact"],
                ].map(([href, label]) => (
                  <li key={href}>
                    <Link href={href!} onClick={close} className="text-fg underline decoration-line-strong underline-offset-4">
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
          </div>,
          document.body,
        )}
    </>
  );
}
