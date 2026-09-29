"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { isMetaExcludedPath, pixelPageView } from "@/lib/meta-pixel";

/** Renders nothing — fires the Meta Pixel PageView for the first load and every client-side route
 * change. The pixel itself is loaded lazily by lib/meta-pixel.ts on the first event (so it's never
 * even downloaded on an admin-only session), and that base script deliberately fires no PageView of
 * its own: every PageView comes from here, which is what keeps the first load from counting twice. */
export function MetaPixel() {
  const pathname = usePathname();

  useEffect(() => {
    if (!isMetaExcludedPath(pathname)) pixelPageView(pathname);
  }, [pathname]);

  return null;
}
