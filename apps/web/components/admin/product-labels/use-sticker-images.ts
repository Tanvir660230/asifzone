"use client";

import { useEffect, useState } from "react";
import type { ProductLabelVariant } from "@clothing-brand/shared";
import { mediaUrl } from "@/lib/runtime-config";
import { loadLogo, renderSticker, stickerFont, type RenderedSticker } from "@/lib/sticker-canvas";
import { StickerLayoutError, type StickerDpi } from "@/lib/sticker-layout";

export interface StickerBrandInput {
  logoUrl: string | null;
  storeName: string;
  tagline: string | null;
}

export type StickerImage = { ok: true; image: RenderedSticker } | { ok: false; error: string };

/**
 * One rendered sticker per variant (copies reuse it), redrawn when the variants, the printer DPI or the brand change.
 * `ready` is false while drawing — printing waits for it.
 */
export function useStickerImages(variants: ProductLabelVariant[], dpi: StickerDpi, brand: StickerBrandInput | null, enabled: boolean) {
  const [images, setImages] = useState<Map<string, StickerImage>>(new Map());
  const [ready, setReady] = useState(false);
  const key = `${dpi}|${brand?.logoUrl ?? ""}|${brand?.storeName ?? ""}|${brand?.tagline ?? ""}|${variants.map((v) => `${v.variantId}:${v.code}:${v.labelName}:${v.labelTag}:${v.size}:${v.color}`).join(",")}`;

  useEffect(() => {
    if (!enabled || !brand) return;
    let cancelled = false;
    setReady(false);
    (async () => {
      const [family, logo] = await Promise.all([stickerFont(), loadLogo(brand.logoUrl ? mediaUrl(brand.logoUrl) : null)]);
      const next = new Map<string, StickerImage>();
      for (const v of variants) {
        try {
          const image = renderSticker(
            { productName: v.productName, labelName: v.labelName, labelTag: v.labelTag, size: v.size, color: v.color, code: v.code },
            { logo, storeName: brand.storeName, tagline: brand.tagline },
            dpi,
            family,
          );
          next.set(v.variantId, { ok: true, image });
        } catch (err) {
          next.set(v.variantId, { ok: false, error: err instanceof StickerLayoutError ? err.message : "This sticker couldn't be drawn" });
        }
      }
      if (cancelled) return;
      setImages(next);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
    // `key` captures everything the drawing depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  return { images, ready };
}
