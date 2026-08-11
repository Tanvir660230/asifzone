"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

interface HScrollShadowProps {
  children: ReactNode;
  /** Applied to the actual scrolling element (must include the overflow-x behavior). */
  className?: string;
  /** Tailwind `from-*` color matching the scrolling element's own background, so the fade blends
   * in instead of showing a visible seam. */
  edgeFrom?: string;
}

/** Wraps a horizontally-scrollable region (data tables, tab bars) with fade shadows on whichever
 * edge still has more content off-screen, so overflow on narrow viewports reads as "scroll for
 * more" instead of looking like content was simply cut off. Shadows track real scroll position via
 * a ref + scroll/resize listeners, so they're absent entirely once nothing is clipped (e.g. once a
 * container switches to a non-scrolling layout at a wider breakpoint). */
export function HScrollShadow({ children, className, edgeFrom = "from-cream-50" }: HScrollShadowProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    function update() {
      if (!el) return;
      setCanScrollLeft(el.scrollLeft > 4);
      setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    }

    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <div className="relative">
      <div ref={ref} className={className}>
        {children}
      </div>
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r ${edgeFrom} to-transparent transition-opacity duration-150 ${
          canScrollLeft ? "opacity-100" : "opacity-0"
        }`}
      />
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l ${edgeFrom} to-transparent transition-opacity duration-150 ${
          canScrollRight ? "opacity-100" : "opacity-0"
        }`}
      />
    </div>
  );
}
