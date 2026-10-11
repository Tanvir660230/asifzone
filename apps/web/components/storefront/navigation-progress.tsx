"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/** Only a navigation slower than this shows the bar: a quick one just swaps the page with nothing in between. */
const SHOW_AFTER_MS = 200;

/**
 * A thin line along the top edge while a link is opening — the site's only route-level loading cue. Pages no longer swap
 * to a skeleton or spinner while the next one loads (the current page stays until the next is ready), so this is what
 * tells the shopper their tap registered on a slow connection. It starts on a click on an internal link and finishes when
 * the address changes.
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [phase, setPhase] = useState<"idle" | "loading" | "done">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      const url = new URL(link.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return; // same page or a #hash
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setPhase("loading"), SHOW_AFTER_MS);
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  // The address changed: the new page is in. Finish the bar if it was showing, otherwise just cancel it.
  useEffect(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setPhase((current) => (current === "loading" ? "done" : "idle"));
  }, [pathname, searchParams]);

  useEffect(() => {
    if (phase !== "done") return;
    const t = setTimeout(() => setPhase("idle"), 300);
    return () => clearTimeout(t);
  }, [phase]);

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-0 z-toast h-0.5">
      <div
        className="h-full bg-accent"
        style={{
          width: phase === "idle" ? "0%" : phase === "loading" ? "80%" : "100%",
          opacity: phase === "done" ? 0 : 1,
          transition:
            phase === "loading" ? "width 6s cubic-bezier(0.1, 0.7, 0.2, 1)" : phase === "done" ? "width 150ms ease-out, opacity 250ms ease 150ms" : "none",
        }}
      />
    </div>
  );
}
