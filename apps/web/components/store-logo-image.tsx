"use client";

import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

interface StoreLogoImageProps {
  src: string;
  alt: string;
  className: string;
  /** Optional inline sizing for callers that need a precise pixel size rather than a fixed Tailwind
   * class — e.g. the compact thermal-sticker labels, where the logo's box size varies per template
   * tier instead of matching one of the few sizes Tailwind's default scale offers. */
  style?: CSSProperties;
  /** Rendered instead of the <img> once it fails to load, e.g. a monogram or text wordmark —
   * an admin-supplied logo URL can go stale (moved/deleted upload) without the site knowing
   * ahead of render time, and the browser's broken-image icon reads as a real bug otherwise. */
  fallback: ReactNode;
}

export function StoreLogoImage({ src, alt, className, style, fallback }: StoreLogoImageProps) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  return (
    // `className`/`style` together fix both dimensions of this box rather than leaving width auto
    // — the logo's real aspect ratio is unknown until the admin-uploaded image loads, so an auto
    // width leaves the browser nothing to reserve space with, and the layout (everything after the
    // logo) jumps once it does load. object-contain on the <img> itself letterboxes whatever the
    // true ratio turns out to be inside this fixed box instead.
    //
    // The base `inline-block` here is load-bearing, not decorative: a bare <span> is `display:
    // inline` by default, and CSS silently ignores height/width on inline elements — so a caller's
    // `h-*`/`w-*` classes only actually took effect when this happened to render as a flex/grid
    // item (which gets blockified regardless of its own display value). Everywhere that wasn't the
    // case — e.g. the storefront footer's top-left logo, sitting in a plain <div> — the box had no
    // real size at all, and the <img> inside (itself sized `h-full w-full`, which resolves against
    // nothing) fell back to rendering at the source file's raw uploaded resolution instead of the
    // intended small logo size. Forcing `inline-block` here means the caller's sizing always takes
    // effect, regardless of what kind of parent it happens to render inside.
    <span className={cn("inline-block", className)} style={style}>
      {/* eslint-disable-next-line @next/next/no-img-element -- admin-supplied URL, arbitrary host not worth whitelisting for next/image */}
      <img src={src} alt={alt} className="h-full w-full object-contain" onError={() => setFailed(true)} />
    </span>
  );
}
