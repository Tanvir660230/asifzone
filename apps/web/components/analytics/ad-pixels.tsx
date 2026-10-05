"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { pixelPageView } from "@/lib/pixels";

/** Renders nothing — fires the ad-pixel PageView (Meta, TikTok) for the first load and every client-side route change.
 * The pixel scripts themselves are loaded lazily by lib/pixels/ on the first event (so they're never even downloaded on
 * an admin-only session), and neither base script fires a PageView of its own: every PageView comes from here, which is
 * what keeps the first load from counting twice. Keyed on pathname only, so a query-string change (filters, sort) on
 * the same page isn't a new page view; lib/pixels/ also suppresses a Strict Mode double effect run. */
export function AdPixels() {
  const pathname = usePathname();

  useEffect(() => {
    pixelPageView(pathname);
  }, [pathname]);

  return null;
}
