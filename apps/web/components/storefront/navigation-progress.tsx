"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/** Only a navigation slower than this shows the bar: a quick one just swaps the page with nothing in between. */
const SHOW_AFTER_MS = 90;

/**
 * A thin line along the top edge while a link is opening — the site's only route-level loading cue. Pages no longer swap
 * to a skeleton or spinner while the next one loads (the current page stays until the next is ready), so this is what
 * tells the shopper their tap registered on a slow connection. It starts on a click on an internal link and finishes when
 * the address changes. Until then the tapped link — or the card it belongs to (`data-nav-pending-scope`) — stays dimmed
 * (`[data-nav-pending]` in globals.css), so the feedback is under the finger as well as at the top edge.
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [phase, setPhase] = useState<"idle" | "loading" | "done">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressed = useRef<Element | null>(null);

  const stall = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Capture phase: next/link calls preventDefault() in its own (bubbling) handler to navigate client-side, so a listener
    // that runs after it sees every ordinary link click as "prevented" — the bar never showed for a link at all.
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target as Element | null;
      const link = target?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      // A button inside a link (a heart on a card) does its own thing instead of following the link.
      if (target?.closest("button") && link.contains(target.closest("button"))) return;
      const url = new URL(link.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return; // same page or a #hash
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setPhase("loading"), SHOW_AFTER_MS);
      pressed.current?.removeAttribute("data-nav-pending");
      pressed.current = link.closest("[data-nav-pending-scope]") ?? link;
      pressed.current.setAttribute("data-nav-pending", "");
      // A link whose own handler kept it from navigating never changes the address: don't leave it dimmed.
      if (stall.current) clearTimeout(stall.current);
      stall.current = setTimeout(() => {
        pressed.current?.removeAttribute("data-nav-pending");
        pressed.current = null;
        if (timer.current) clearTimeout(timer.current);
        setPhase("idle");
      }, 10_000);
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // The address changed: the new page is in. Finish the bar if it was showing, otherwise just cancel it.
  useEffect(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (stall.current) clearTimeout(stall.current);
    pressed.current?.removeAttribute("data-nav-pending");
    pressed.current = null;
    setPhase((current) => (current === "loading" ? "done" : "idle"));
  }, [pathname, searchParams]);

  useEffect(() => {
    if (phase !== "done") return;
    const t = setTimeout(() => setPhase("idle"), 300);
    return () => clearTimeout(t);
  }, [phase]);

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-0 z-toast h-[3px] lg:h-0.5">
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
