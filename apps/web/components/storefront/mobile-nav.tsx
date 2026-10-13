"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, ChevronDown, Heart, Menu, PackageSearch, Search, User, X } from "lucide-react";
import type { CategoryTreeNode } from "@/lib/api/storefront";
import { resolveImageUrl } from "@/lib/image-url";
import { cn } from "@/lib/utils";
import { useSearchOverlayStore } from "@/store/search-overlay";
import { useMobileMenuStore } from "@/store/mobile-menu";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { useSheetDrag } from "@/hooks/use-sheet-drag";

const QUICK_LINKS = [
  { href: "/track-order", label: "Track order", icon: PackageSearch },
  { href: "/wishlist", label: "Wishlist", icon: Heart },
  { href: "/account", label: "Account", icon: User },
] as const;

const HELP_LINKS = [
  { href: "/shipping-returns", label: "Shipping & returns" },
  { href: "/faq", label: "FAQ" },
  { href: "/contact", label: "Contact us" },
] as const;

/** The phone menu: the header's menu button and the bottom tab bar's Shop tab open the same drawer (store/mobile-menu.ts).
 * Every row is a full-width target of at least 44px; the list scrolls on its own when it is taller than the phone. */
export function MobileNav({ categories }: { categories: CategoryTreeNode[] }) {
  const isOpen = useMobileMenuStore((s) => s.isOpen);
  const openMenu = useMobileMenuStore((s) => s.open);
  const closeMenu = useMobileMenuStore((s) => s.close);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const openSearch = useSearchOverlayStore((s) => s.open);
  const pathname = usePathname();
  const panelRef = useFocusTrap<HTMLDivElement>({ active: isOpen, onEscape: close });
  useSheetDrag(panelRef, close, isOpen);

  // Each open starts fresh, with no subcategory list left expanded from last time.
  function close() {
    closeMenu();
    setExpandedId(null);
  }

  // Any navigation (a link here, the browser's back button) closes the drawer.
  useEffect(() => {
    closeMenu();
    setExpandedId(null);
  }, [pathname, closeMenu]);

  const rowClass = "flex min-h-12 flex-1 items-center gap-3 py-2 text-[0.9375rem] text-ink-900";

  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={openMenu}
        aria-label="Open menu"
        aria-expanded={isOpen}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-900 transition-colors duration-200 ease-smooth hover:bg-ink-100"
      >
        <Menu size={22} />
      </button>

      {isOpen &&
        createPortal(
          // Rendered into document.body rather than in place: the header's `backdrop-blur`
          // creates a containing block for `position: fixed` descendants, which would
          // otherwise clip this overlay to the header's own height instead of the viewport.
          // On phones a sheet over the dimmed page, stopping above the tab bar; it drags down to close.
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
            <div data-sheet-handle className="flex h-14 shrink-0 items-center justify-between border-b border-line-subtle px-4">
              <span className="font-display text-xl">Menu</span>
              <button
                type="button"
                onClick={close}
                aria-label="Close menu"
                className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full transition-colors duration-150 ease-smooth hover:bg-ink-100"
              >
                <X size={22} />
              </button>
            </div>

            <nav aria-label="Shop" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-4">
              <button
                type="button"
                onClick={() => {
                  close();
                  openSearch();
                }}
                className="flex h-12 w-full items-center gap-3 rounded-xl bg-surface px-4 text-left text-sm text-ink-500 ring-1 ring-inset ring-line-subtle"
              >
                <Search size={18} aria-hidden="true" className="text-ink-700" />
                Search products
              </button>

              <div className="mt-3 grid grid-cols-3 gap-2">
                {QUICK_LINKS.map(({ href, label, icon: Icon }) => (
                  <Link
                    key={href}
                    href={href}
                    onClick={close}
                    className="flex flex-col items-center justify-center gap-1.5 rounded-xl bg-surface py-3 text-xs text-ink-700 ring-1 ring-inset ring-line-subtle"
                  >
                    <Icon size={19} aria-hidden="true" className="text-ink-900" />
                    {label}
                  </Link>
                ))}
              </div>

              <p className="mb-1 mt-6 text-xs ui-eyebrow text-fg-muted">Shop</p>
              <ul>
                {categories.map((cat) => {
                  const expanded = expandedId === cat.id;
                  return (
                    <li key={cat.id} className="border-b border-line-subtle">
                      <div className="flex items-center">
                        <Link href={`/category/${cat.slug}`} onClick={close} className={rowClass}>
                          {cat.imageUrl ? (
                            <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-surface-muted">
                              <Image src={resolveImageUrl(cat.imageUrl)} alt="" fill sizes="40px" className="object-cover" />
                            </span>
                          ) : null}
                          <span className="ui-caps">{cat.name}</span>
                        </Link>
                        {cat.children.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setExpandedId(expanded ? null : cat.id)}
                            aria-expanded={expanded}
                            aria-label={`${expanded ? "Hide" : "Show"} ${cat.name} subcategories`}
                            className="-mr-2 flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-ink-700 transition-colors hover:bg-ink-100"
                          >
                            <ChevronDown size={18} aria-hidden="true" className={cn("transition-transform duration-200 ease-smooth", expanded && "rotate-180")} />
                          </button>
                        )}
                      </div>
                      {expanded && (
                        <ul className={cn("pb-2", cat.imageUrl ? "pl-[3.25rem]" : "pl-4")}>
                          <li>
                            <Link href={`/category/${cat.slug}`} onClick={close} className="flex min-h-11 items-center text-sm font-medium text-ink-900">
                              All {cat.name}
                            </Link>
                          </li>
                          {cat.children.map((child) => (
                            <li key={child.id}>
                              <Link href={`/category/${child.slug}`} onClick={close} className="flex min-h-11 items-center text-sm text-ink-600">
                                {child.name}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
                <li>
                  <Link href="/search" onClick={close} className={cn(rowClass, "justify-between font-medium")}>
                    All products
                    <ArrowRight size={17} aria-hidden="true" />
                  </Link>
                </li>
              </ul>

              <p className="mb-1 mt-6 text-xs ui-eyebrow text-fg-muted">Help</p>
              <ul>
                {HELP_LINKS.map(({ href, label }) => (
                  <li key={href}>
                    <Link href={href} onClick={close} className="flex min-h-11 items-center text-sm text-ink-700">
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
    </div>
  );
}
