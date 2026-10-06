"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { pixelPageView } from "@/lib/pixels";
import { onAdTrackingConsentChange } from "@/lib/pixels/consent";

/** Renders nothing — fires the ad-pixel PageView (Meta, TikTok) for the first load and every client-side route change.
 * The pixel scripts themselves are loaded lazily by lib/pixels/ on the first event (so they're never even downloaded on
 * an admin-only session, or before the shopper accepts tracking), and neither base script fires a PageView of its own:
 * every PageView comes from here, which is what keeps the first load from counting twice. Keyed on pathname only, so a
 * query-string change (filters, sort) on the same page isn't a new page view; lib/pixels/ also suppresses a Strict Mode
 * double effect run. Accepting in the consent banner counts the page the shopper is on; withdrawing a consent given
 * earlier in this page reloads it, so no already-loaded pixel script keeps running. */
export function AdPixels() {
  const pathname = usePathname();

  useEffect(() => {
    pixelPageView(pathname);
  }, [pathname]);

  useEffect(
    () =>
      onAdTrackingConsentChange((decision) => {
        if (decision === "granted") pixelPageView(window.location.pathname);
        else if (window.fbq || window.ttq || (window as unknown as { clarity?: unknown }).clarity) window.location.reload();
      }),
    [],
  );

  return null;
}
