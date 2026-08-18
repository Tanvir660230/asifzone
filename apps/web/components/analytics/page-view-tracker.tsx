"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { trackPageView, sendPageExit } from "@/lib/analytics";
import { pixelPageView } from "@/lib/meta-pixel";

/** Renders nothing — beacons an anonymous pageview on mount and on every client-side route
 * change, and an "exit" beacon (time on page, max scroll depth, click count) whenever the visitor
 * leaves that page, whether by navigating to another page in this SPA or closing/backgrounding the
 * tab. Reads window.location.search directly instead of useSearchParams() so this never forces the
 * tree into a Suspense boundary. */
export function PageViewTracker() {
  const pathname = usePathname();
  // The Meta Pixel base snippet (MetaPixelScript) already fires the first PageView itself —
  // skip this hook's first run so first loads don't double-count it, and only track pixel
  // PageViews for client-side navigations after that.
  const isFirstRun = useRef(true);

  // Whichever page is "current" right now — id is null until the pageview beacon for it resolves,
  // and while it's a brand new page the visitor hasn't had time to scroll/click on it anyway.
  const currentRef = useRef<{ id: string | null; startedAt: number }>({ id: null, startedAt: Date.now() });
  const scrollDepthRef = useRef(0);
  const clickCountRef = useRef(0);

  // Stable across renders (defined once, closes over refs rather than state) — safe to register
  // in effects with an empty dependency array below without going stale, since every value it
  // reads is a ref, not a render-scoped variable.
  const flushExitRef = useRef(() => {
    const { id, startedAt } = currentRef.current;
    if (id) {
      sendPageExit(id, {
        durationMs: Date.now() - startedAt,
        scrollDepthPct: scrollDepthRef.current,
        clickCount: clickCountRef.current,
      });
    }
    currentRef.current = { id: null, startedAt: Date.now() };
    scrollDepthRef.current = 0;
    clickCountRef.current = 0;
  });

  // Global scroll/click capture, attached once — always accumulates onto whichever page is
  // "current" per currentRef, regardless of which pathname effect run started it.
  useEffect(() => {
    function onScroll() {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      const pct = scrollable > 0 ? Math.min(100, Math.max(0, Math.round((window.scrollY / scrollable) * 100))) : 100;
      if (pct > scrollDepthRef.current) scrollDepthRef.current = pct;
    }
    function onClick() {
      clickCountRef.current += 1;
    }
    function onVisibilityChange() {
      if (document.visibilityState === "hidden") flushExitRef.current();
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("click", onClick);
    // pagehide (tab close/navigation away from the site entirely) and visibilitychange (mobile
    // backgrounding, which often never fires pagehide) — both flush the same way, so a genuinely
    // abandoned page still gets its engagement data recorded rather than staying null forever.
    window.addEventListener("pagehide", () => flushExitRef.current());
    document.addEventListener("visibilitychange", onVisibilityChange);
    onScroll();

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("click", onClick);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    // Close out the previous page's engagement stats before starting the new one.
    flushExitRef.current();

    trackPageView(`${pathname}${window.location.search}`).then((id) => {
      currentRef.current = { id, startedAt: Date.now() };
    });

    if (isFirstRun.current) {
      isFirstRun.current = false;
    } else {
      pixelPageView();
    }
  }, [pathname]);

  return null;
}
