import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { resolveImageUrl } from "@/lib/image-url";
import { Reveal } from "./reveal";

export interface GalleryItem {
  imageUrl: string;
  altText?: string | null;
  caption?: string | null;
  linkUrl?: string | null;
}

interface ImageGallerySectionProps {
  eyebrow?: string | null;
  heading?: string | null;
  items: GalleryItem[];
  layout?: "grid" | "mosaic";
}

/** A lookbook (IMAGE_GALLERY): the store's photographs, each optionally linking to a product or collection. `grid` is
 * even tiles; `mosaic` makes the first photograph a large feature tile beside the rest (from 1024px). */
export function ImageGallerySection({ eyebrow, heading, items, layout = "mosaic" }: ImageGallerySectionProps) {
  if (items.length === 0) return null;
  const mosaic = layout === "mosaic" && items.length >= 3;
  return (
    <section className="mx-auto max-w-7xl px-4 py-[calc(3rem*var(--section-rhythm))] sm:px-6 sm:py-[calc(4.5rem*var(--section-rhythm))] lg:px-8">
      {(eyebrow || heading) && (
        <Reveal className="mb-8">
          {eyebrow && <p className="mb-3 text-xs ui-eyebrow text-fg-muted">{eyebrow}</p>}
          {heading && <h2 className="ui-section-heading font-display text-fg">{heading}</h2>}
        </Reveal>
      )}
      <ul className={cn("grid grid-cols-2 gap-3 sm:gap-4", mosaic ? "lg:grid-cols-4 lg:grid-rows-2" : "lg:grid-cols-4")}>
        {items.map((item, i) => {
          const feature = mosaic && i === 0;
          const tile = (
            <figure className="group h-full">
              <div className={cn("relative overflow-hidden rounded-xl bg-surface-muted", feature ? "aspect-square lg:aspect-auto lg:h-full" : "aspect-[4/5]")}>
                <Image
                  src={resolveImageUrl(item.imageUrl)}
                  alt={item.altText || item.caption || ""}
                  fill
                  sizes={feature ? "(min-width: 1024px) 50vw, 100vw" : "(min-width: 1024px) 25vw, 50vw"}
                  className="object-cover transition-transform duration-700 ease-smooth group-hover:scale-[1.03]"
                />
              </div>
              {item.caption && <figcaption className="mt-2 text-sm text-fg-muted group-hover:text-fg">{item.caption}</figcaption>}
            </figure>
          );
          return (
            <Reveal as="li" key={`${item.imageUrl}-${i}`} index={i} className={cn(feature && "col-span-2 lg:row-span-2")}>
              {item.linkUrl ? (
                <Link href={item.linkUrl} className="block h-full">
                  {tile}
                </Link>
              ) : (
                tile
              )}
            </Reveal>
          );
        })}
      </ul>
    </section>
  );
}
