import Image from "next/image";
import { Check } from "lucide-react";
import { resolveImageUrl } from "@/lib/image-url";
import { cn } from "@/lib/utils";

/**
 * One photo choice — a colour, a design, a family member: the photo in the theme's product-photo frame
 * (--product-photo-aspect / --product-photo-fit), its name under it in up to two lines (never cut to "New Whit…"), a ring
 * and a tick when chosen, struck through and faded when it can't be ordered now. The product page's family picker and the
 * landing page's colour picker both draw this, so a choice looks the same everywhere.
 */
export function PhotoTileBody({ imageUrl, label, selected, unavailable, unavailableText }: { imageUrl: string | null; label: string; selected: boolean; unavailable?: boolean; unavailableText?: string }) {
  return (
    <>
      <span
        className={cn(
          "relative block aspect-[var(--product-photo-aspect)] overflow-hidden rounded-lg bg-ink-100 ring-offset-2 ring-offset-canvas transition-shadow duration-base",
          selected ? "ring-2 ring-ink-900" : "ring-1 ring-line",
          unavailable && "opacity-45",
        )}
      >
        {imageUrl ? (
          <Image src={resolveImageUrl(imageUrl)} alt="" fill sizes="80px" className="[object-fit:var(--product-photo-fit)]" />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center px-1.5 text-center text-[11px] leading-tight text-fg-muted" aria-hidden="true" data-testid="photo-tile-placeholder">
            {label}
          </span>
        )}
        {selected && (
          <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-ink-900 text-cream-50" aria-hidden="true">
            <Check size={12} strokeWidth={3} />
          </span>
        )}
      </span>
      <span className={cn("mt-1.5 line-clamp-2 block text-[11px] leading-tight", selected ? "font-semibold text-fg" : "text-fg-muted", unavailable && "line-through")} lang="en">
        {label}
      </span>
      {unavailable && unavailableText && <span className="sr-only">, {unavailableText}</span>}
    </>
  );
}

/** The tile's outer size: a fixed width, so a strip of them swipes on a phone and wraps from 640px. */
export const PHOTO_TILE_WIDTH = "w-[4.5rem] shrink-0 sm:w-20";
