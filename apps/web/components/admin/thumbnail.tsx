"use client";

import type { ImgHTMLAttributes } from "react";
import { resolveImageUrl, thumbnailUrl } from "@/lib/image-url";

/** A small product image (list rows, stock widgets): loads the 300px rendition and, if an older upload has none,
 * falls back to the original once. */
export function Thumbnail({ src, alt = "", ...rest }: Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & { src: string }) {
  const original = resolveImageUrl(src);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...rest}
      src={thumbnailUrl(src)}
      alt={alt}
      onError={(e) => {
        if (e.currentTarget.src !== new URL(original, location.href).href) e.currentTarget.src = original;
      }}
    />
  );
}
