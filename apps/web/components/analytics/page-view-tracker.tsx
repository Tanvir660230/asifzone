"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { trackPageView } from "@/lib/analytics";

/** Renders nothing — beacons an anonymous pageview on mount and on every client-side route
 * change. Reads window.location.search directly instead of useSearchParams() so this never
 * forces the tree into a Suspense boundary. */
export function PageViewTracker() {
  const pathname = usePathname();

  useEffect(() => {
    trackPageView(`${pathname}${window.location.search}`);
  }, [pathname]);

  return null;
}
