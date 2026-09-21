"use client";

import type { ProductImage } from "@clothing-brand/shared";
import { resolveImageUrl } from "@/lib/image-url";
import { cn } from "@/lib/utils";

interface VariantGalleryPickerProps {
  images: ProductImage[];
  /** Selected image ids in display order; the first is the variant's primary image. */
  value: string[];
  onChange: (ids: string[]) => void;
  label: string;
}

/** Click images in the order they should appear for this variant. Selecting adds to the end, clicking a selected image
 * removes it; the number badge shows the position and "Main" marks the first. Empty means "use the product's images". */
export function VariantGalleryPicker({ images, value, onChange, label }: VariantGalleryPickerProps) {
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <div>
      <div className="flex flex-wrap gap-2" role="group" aria-label={`${label} gallery`}>
        {images.map((img) => {
          const position = value.indexOf(img.id);
          const selected = position !== -1;
          return (
            <button
              key={img.id}
              type="button"
              onClick={() => toggle(img.id)}
              aria-pressed={selected}
              aria-label={`${selected ? "Remove" : "Add"} ${img.altText || "image"} ${selected ? `(position ${position + 1})` : ""}`.trim()}
              className={cn(
                "relative h-14 w-14 overflow-hidden rounded border-2 transition",
                selected ? "border-brass-500" : "border-ink-100 opacity-70 hover:opacity-100",
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={resolveImageUrl(img.url)} alt="" className="h-full w-full object-cover" />
              {selected && (
                <span className="absolute left-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brass-600 px-1 text-[10px] font-semibold text-white">
                  {position + 1}
                </span>
              )}
              {position === 0 && <span className="absolute inset-x-0 bottom-0 bg-ink-900/70 text-center text-[9px] uppercase tracking-wide text-cream-50">Main</span>}
            </button>
          );
        })}
      </div>
      <p className="mt-1 text-xs text-ink-400">
        {value.length === 0
          ? "Using the product's images. Click images to give this variant its own gallery, in the order shown."
          : `${value.length} image${value.length === 1 ? "" : "s"} · the first is this variant's main image.`}{" "}
        {value.length > 0 && (
          <button type="button" className="underline hover:text-ink-700" onClick={() => onChange([])}>
            Clear
          </button>
        )}
      </p>
    </div>
  );
}
