"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { trackPageView } from "@/lib/analytics";
import { pixelPageView } from "@/lib/meta-pixel";

/** Renders nothing — beacons an anonymous pageview on mount and on every client-side route
 * change. Reads window.location.search directly instead of useSearchParams() so this never
 * forces the tree into a Suspense boundary. */
export function PageViewTracker() {
  const pathname = usePathname();
  // The Meta Pixel base snippet (MetaPixelScript) already fires the first PageView itself —
  // skip this hook's first run so first loads don't double-count it, and only track pixel
  // PageViews for client-side navigations after that.
  const isFirstRun = useRef(true);

  useEffect(() => {
    trackPageView(`${pathname}${window.location.search}`);
    if (isFirstRun.current) {
      isFirstRun.current = false;
    } else {
      pixelPageView();
    }
  }, [pathname]);

  return null;
}
