import type { CSSProperties } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { CategoryTreeNode } from "@/lib/api/storefront";
import { resolveImageUrl } from "@/lib/image-url";
import { categoryTileLayout } from "@/lib/category-tile-layout";
import { Reveal } from "./reveal";

/** Desktop row heights stay equal whatever a tile's width: its aspect ratio is its column span (of 12) over this. */
const ROW_UNITS = 3.75;
/** A tile at least this much wider than tall takes the category's wide (16:10) photo; narrower ones the tall (4:5) one. */
const WIDE_TILE = 1.2;

const IMAGE_CLASS = "object-cover transition-transform duration-700 ease-smooth group-hover:scale-[1.04]";

/** The category photo made for this tile's shape at each width (lib/image-specs.ts categoryPortrait / categoryWide), each
 * falling back to the other. When phones and computers need different photos, both are in the page and CSS shows one;
 * the hidden one's `sizes` is 1px so the browser doesn't fetch it at full size. */
function TileImage({ cat, phoneWide, desktopWide, sizesDesktop }: { cat: CategoryTreeNode; phoneWide: boolean; desktopWide: boolean; sizesDesktop: string }) {
  const pick = (wide: boolean) => (wide ? cat.wideImageUrl || cat.imageUrl : cat.imageUrl || cat.wideImageUrl)!;
  const phone = pick(phoneWide);
  const desktop = pick(desktopWide);
  const alt = cat.imageAltText || cat.name;
  const phoneSizes = phoneWide ? "100vw" : "50vw";
  if (phone === desktop) {
    return <Image src={resolveImageUrl(phone)} alt={alt} fill sizes={`(min-width: 1024px) ${sizesDesktop}, ${phoneSizes}`} className={IMAGE_CLASS} />;
  }
  return (
    <>
      <Image src={resolveImageUrl(phone)} alt={alt} fill sizes={`(min-width: 1024px) 1px, ${phoneSizes}`} className={`${IMAGE_CLASS} lg:hidden`} />
      <Image src={resolveImageUrl(desktop)} alt={alt} fill sizes={`(min-width: 1024px) ${sizesDesktop}, 1px`} className={`${IMAGE_CLASS} max-lg:hidden`} />
    </>
  );
}

export function CategoryGrid({
  categories,
  heading = "Shop by Category",
  subtitle,
}: {
  categories: CategoryTreeNode[];
  heading?: string | null;
  /** Optional supporting line under the heading (Admin → Homepage → Category grid). */
  subtitle?: string | null;
}) {
  if (categories.length === 0) return null;
  const layout = categoryTileLayout(categories.length);

  return (
    <section className="mx-auto max-w-7xl px-4 py-[calc(2.75rem*var(--section-rhythm))] sm:py-[calc(4rem*var(--section-rhythm))] sm:px-6 lg:px-8">
      <Reveal className={subtitle ? "mb-8" : "mb-6 sm:mb-8"}>
        <h2 className="ui-section-heading font-display text-ink-900">{heading || "Shop by Category"}</h2>
        {subtitle && <p className="mt-2 max-w-prose text-sm text-ink-500 sm:text-base">{subtitle}</p>}
      </Reveal>
      <div data-testid="category-grid" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-12">
        {categories.map((cat, i) => {
          const { lg, sm } = layout[i]!;
          const style = {
            "--tile-span-sm": sm,
            "--tile-span-lg": lg,
            "--tile-aspect-sm": sm === 2 ? "16 / 10" : "4 / 5",
            "--tile-aspect-lg": `${lg} / ${ROW_UNITS}`,
          } as CSSProperties;
          return (
            <Reveal
              key={cat.id}
              index={i}
              style={style}
              className="[grid-column:span_var(--tile-span-sm)/span_var(--tile-span-sm)] lg:[grid-column:span_var(--tile-span-lg)/span_var(--tile-span-lg)]"
            >
                {/* The caption (`.ui-tile-caption`) sits over the photograph or below it, as the theme decides. */}
                <Link
                  href={`/category/${cat.slug}`}
                  className="group relative block overflow-hidden rounded-xl focus-visible:outline-offset-4"
                >
                  <div className="relative overflow-hidden rounded-[var(--tile-media-radius)] bg-ink-100 [aspect-ratio:var(--tile-aspect-sm)] lg:[aspect-ratio:var(--tile-aspect-lg)]">
                    {cat.imageUrl || cat.wideImageUrl ? (
                      <TileImage cat={cat} phoneWide={sm === 2} desktopWide={lg / ROW_UNITS >= WIDE_TILE} sizesDesktop={lg >= 6 ? "50vw" : "25vw"} />
                    ) : (
                      // No category photo yet: a flat ink tile reads as a deliberate placeholder, not a broken image.
                      <div className="h-full bg-ink-950" />
                    )}
                  </div>
                  {/* A compact "Name ↗" pill rather than a big title: category artwork often carries its own lettering, and
                      the pill reads as the action (and stays legible on any photograph). */}
                  <div className="ui-tile-caption">
                    <span className="inline-flex items-center gap-2 rounded-full bg-surface/95 py-2 pl-4 pr-3 text-sm font-medium text-ink-900 shadow-float backdrop-blur-sm transition-transform duration-300 ease-smooth group-hover:-translate-y-0.5">
                      {cat.name}
                      <ArrowUpRight size={15} aria-hidden="true" className="transition-transform duration-300 ease-smooth group-hover:-translate-y-px group-hover:translate-x-px" />
                    </span>
                  </div>
                </Link>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}
