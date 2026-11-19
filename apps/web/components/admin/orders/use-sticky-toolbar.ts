"use client";

import { useLayoutEffect, useRef } from "react";

/** The CSS variable the Orders table's sticky column titles read (orders-list.tsx) to sit just under the sticky filter bar. */
export const ORDERS_TOOLBAR_VAR = "--orders-toolbar-h";

/**
 * The Orders filter bar sticks under the top bar, and the table's column titles stick under IT. The bar's height changes
 * (chips, a wrapped row, the font size), so it is measured, not guessed — a guessed height is what put the titles over
 * the filters on 2026-11-19. Writes the bar's height onto its parent (the page), where the table inherits it.
 */
export function useStickyToolbarHeight<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const bar = ref.current;
    const page = bar?.parentElement;
    if (!bar || !page) return;
    const write = () => {
      // Only while the bar is actually sticky (tablet and up); on phones it scrolls away and the table isn't shown.
      const sticky = getComputedStyle(bar).position === "sticky";
      page.style.setProperty(ORDERS_TOOLBAR_VAR, sticky ? `${bar.getBoundingClientRect().height}px` : "0px");
    };
    write();
    const observer = new ResizeObserver(write);
    observer.observe(bar);
    window.addEventListener("resize", write);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", write);
      page.style.removeProperty(ORDERS_TOOLBAR_VAR);
    };
  }, []);
  return ref;
}
