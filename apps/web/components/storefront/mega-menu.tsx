"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { FocusEvent, KeyboardEvent } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import type { CategoryTreeNode } from "@/lib/api/storefront";
import { cn } from "@/lib/utils";

const NAV_LINK_CLASS =
  "group/navlink relative flex items-center gap-1 whitespace-nowrap py-2 text-sm ui-caps text-ink-800 transition-colors duration-200 ease-smooth hover:text-brass-500";
// Fully opaque, not the shared `.glass` (75% opacity) — this floats over whatever's on the page below it, including the
// hero photo, and translucency let the image visibly show through behind the menu text. A functional nav menu needs to
// read cleanly regardless of what's behind it; the header's translucency (deliberate, sits over plain scrolling content)
// doesn't carry over to this use case.
const PANEL_CLASS = "absolute top-full z-40 w-64 animate-dropdown-in rounded-xl border border-ink-100/70 bg-cream-50 py-4 shadow-floatLg";
const PANEL_LINK_CLASS = "mx-2 block rounded-lg px-4 py-2 text-sm text-ink-700 transition-colors duration-150 ease-smooth hover:bg-ink-50 hover:text-brass-500";

/**
 * The desktop category navigation — a "priority+" menu. Category names never wrap: as many as fit the available width
 * are shown, in the store's own order, and the rest move into a "More" menu. The split is measured, not guessed, so it
 * holds for any number of categories, any names, any theme's typography and any window width.
 */
export function MegaMenu({ categories }: { categories: CategoryTreeNode[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  // Every item until measured: the server's markup is the full list, clipped (not wrapped) if it doesn't fit.
  const [visibleCount, setVisibleCount] = useState(categories.length);
  const containerRef = useRef<HTMLElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const moreMenuId = useId();

  const measure = useCallback(() => {
    const container = containerRef.current;
    const row = measureRef.current;
    if (!container || !row) return;
    const [moreProbe, ...items] = Array.from(row.children) as HTMLElement[];
    const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
    const available = container.clientWidth;
    const widths = items.map((el) => el.getBoundingClientRect().width);
    const total = widths.reduce((sum, w) => sum + w, 0) + gap * Math.max(0, widths.length - 1);
    if (total <= available) {
      setVisibleCount(widths.length);
      return;
    }
    let used = moreProbe!.getBoundingClientRect().width;
    let fit = 0;
    for (const width of widths) {
      if (used + gap + width > available) break;
      used += gap + width;
      fit++;
    }
    setVisibleCount(fit);
  }, []);

  useLayoutEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    if (containerRef.current) observer.observe(containerRef.current);
    // Web fonts change every width; measure again once they're in.
    void document.fonts?.ready.then(measure);
    return () => observer.disconnect();
  }, [measure, categories]);

  const visible = categories.slice(0, visibleCount);
  const overflow = categories.slice(visibleCount);

  useEffect(() => {
    if (overflow.length === 0) setMoreOpen(false);
  }, [overflow.length]);

  const closeOnBlur = (e: FocusEvent<HTMLElement>, close: () => void) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) close();
  };

  const closeOnEscape = (e: KeyboardEvent<HTMLLIElement>) => {
    if (e.key === "Escape") {
      setOpenId(null);
      (e.currentTarget.querySelector("a") as HTMLAnchorElement | null)?.focus();
    }
  };

  return (
    // `overflow-x: clip` (not hidden) keeps the dropdowns, which hang below the row, visible.
    <nav ref={containerRef} aria-label="Categories" className="relative flex min-w-0 flex-1 [overflow-x:clip]">
      {/* Measuring row: the same typography, laid out but invisible and unreachable. First child is the "More" probe. */}
      <div ref={measureRef} aria-hidden="true" className="pointer-events-none invisible absolute left-0 top-0 flex gap-8">
        <span className={NAV_LINK_CLASS}>
          More
          <ChevronDown size={14} />
        </span>
        {categories.map((cat) => (
          <span key={cat.id} className={NAV_LINK_CLASS}>
            {cat.name}
          </span>
        ))}
      </div>

      {/* `mx-auto` centres the row while it fits and starts it at the left (never clipped on both sides) while it doesn't. */}
      <ul className="mx-auto flex items-center gap-8">
        {visible.map((cat) => (
          <li
            key={cat.id}
            className="relative"
            onMouseEnter={() => setOpenId(cat.id)}
            onMouseLeave={() => setOpenId(null)}
            onFocus={() => setOpenId(cat.id)}
            onBlur={(e) => closeOnBlur(e, () => setOpenId(null))}
            onKeyDown={closeOnEscape}
          >
            <Link
              href={`/category/${cat.slug}`}
              aria-haspopup={cat.children.length > 0 ? "true" : undefined}
              aria-expanded={cat.children.length > 0 ? openId === cat.id : undefined}
              className={NAV_LINK_CLASS}
            >
              {cat.name}
              <span className="absolute inset-x-0 -bottom-0.5 h-px origin-center scale-x-0 bg-brass-500 transition-transform duration-200 ease-smooth group-hover/navlink:scale-x-100" />
            </Link>

            {cat.children.length > 0 && openId === cat.id && (
              <div className={cn(PANEL_CLASS, "left-1/2 -translate-x-1/2")}>
                <ul>
                  {cat.children.map((child) => (
                    <li key={child.id}>
                      <Link href={`/category/${child.slug}`} className={PANEL_LINK_CLASS}>
                        {child.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </li>
        ))}

        {overflow.length > 0 && (
          <li
            className="relative"
            onMouseEnter={() => setMoreOpen(true)}
            onMouseLeave={() => setMoreOpen(false)}
            onBlur={(e) => closeOnBlur(e, () => setMoreOpen(false))}
            onKeyDown={(e) => {
              if (e.key === "Escape" && moreOpen) {
                setMoreOpen(false);
                moreButtonRef.current?.focus();
              }
            }}
          >
            <button
              ref={moreButtonRef}
              type="button"
              aria-expanded={moreOpen}
              aria-controls={moreMenuId}
              onClick={() => setMoreOpen((open) => !open)}
              className={NAV_LINK_CLASS}
            >
              More
              <ChevronDown size={14} aria-hidden="true" className={cn("transition-transform duration-200 ease-smooth", moreOpen && "rotate-180")} />
            </button>
            {moreOpen && (
              <div id={moreMenuId} className={cn(PANEL_CLASS, "right-0 max-h-[70vh] overflow-y-auto")}>
                <ul>
                  {overflow.map((cat) => (
                    <li key={cat.id}>
                      <Link href={`/category/${cat.slug}`} className={cn(PANEL_LINK_CLASS, "font-medium text-ink-900")}>
                        {cat.name}
                      </Link>
                      {cat.children.length > 0 && (
                        <ul className="mb-1">
                          {cat.children.map((child) => (
                            <li key={child.id}>
                              <Link href={`/category/${child.slug}`} className={cn(PANEL_LINK_CLASS, "pl-8")}>
                                {child.name}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </li>
        )}
      </ul>
    </nav>
  );
}
