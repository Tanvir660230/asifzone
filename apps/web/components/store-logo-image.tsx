"use client";

import { useState } from "react";
import type { ReactNode } from "react";

interface StoreLogoImageProps {
  src: string;
  alt: string;
  className: string;
  /** Rendered instead of the <img> once it fails to load, e.g. a monogram or text wordmark —
   * an admin-supplied logo URL can go stale (moved/deleted upload) without the site knowing
   * ahead of render time, and the browser's broken-image icon reads as a real bug otherwise. */
  fallback: ReactNode;
}

export function StoreLogoImage({ src, alt, className, fallback }: StoreLogoImageProps) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  return (
    // `className` fixes both dimensions of this box (e.g. "h-9 w-36") rather than leaving width
    // auto — the logo's real aspect ratio is unknown until the admin-uploaded image loads, so an
    // auto width leaves the browser nothing to reserve space with, and the layout (everything
    // after the logo) jumps once it does load. object-contain on the <img> itself letterboxes
    // whatever the true ratio turns out to be inside this fixed box instead.
    <span className={className}>
      {/* eslint-disable-next-line @next/next/no-img-element -- admin-supplied URL, arbitrary host not worth whitelisting for next/image */}
      <img src={src} alt={alt} className="h-full w-full object-contain" onError={() => setFailed(true)} />
    </span>
  );
}
