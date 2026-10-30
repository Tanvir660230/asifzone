import Image from "next/image";
import Link from "next/link";
import { DEFAULT_TRUST_STRIP_ITEMS, type ImageGalleryConfig } from "@clothing-brand/shared";
import type { CategoryTreeNode } from "@/lib/api/storefront";
import { resolveImageUrl } from "@/lib/image-url";
import { Canopy } from "./canopy";
import { CategoryIndexPhoto } from "./category-index-photo";

/* The tahafi preset's homepage sections. Same props and the same admin-authored content as the classic sections; never
   invented copy — every string is the store's, or the neutral fallback the classic section also uses. Section titles
   carry the twin diamonds through `--title-mark` (globals.css). */

const SECTION = "mx-auto max-w-7xl px-5 py-[calc(3.5rem*var(--section-rhythm))] sm:px-8 sm:py-[calc(5.5rem*var(--section-rhythm))]";

/** The store's promises as one line of words, a sage diamond between them — no icon tiles. */
export function TahafiPromiseLine({ items = [...DEFAULT_TRUST_STRIP_ITEMS] }: { items?: { icon: string; label: string }[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-label="Our promises" className="border-b border-line-subtle bg-surface">
      <ul className="mx-auto flex max-w-7xl flex-col gap-1.5 px-5 py-4 text-sm text-ink-700 sm:flex-row sm:flex-wrap sm:items-center sm:justify-center sm:gap-x-8 sm:px-8">
        {items.map(({ label }, i) => (
          <li key={label} className="flex items-center gap-2.5 sm:gap-8">
            <span aria-hidden="true" className={i === 0 ? "text-[color:var(--tag-thread)] sm:hidden" : "text-[color:var(--tag-thread)]"}>
              ◆
            </span>
            {label}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A category's subcategories, as the quiet line under its name (nothing when it has none — no invented descriptions). */
function subline(node: CategoryTreeNode) {
  return node.children
    .slice(0, 3)
    .map((c) => c.name)
    .join(", ");
}

/**
 * Categories as an index: their names set large in the serif, one per line, read like the contents of a catalogue. Phones
 * put a small photograph at the end of each line; wide screens show one large photograph beside the list, which follows
 * the name under the pointer (category-index-photo.tsx).
 */
export function TahafiCategoryIndex({ categories, heading, subtitle }: { categories: CategoryTreeNode[]; heading?: string | null; subtitle?: string | null }) {
  if (categories.length === 0) return null;
  const photos = categories.map((c) => (c.imageUrl ? { id: c.id, url: resolveImageUrl(c.imageUrl), alt: c.imageAltText || c.name } : null));
  return (
    <section className={SECTION}>
      <div className="lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-center lg:gap-20">
        <div>
          <h2 className="ui-section-heading font-display text-fg">{heading || "Shop by category"}</h2>
          {subtitle && <p className="mt-3 max-w-md text-base text-fg-muted">{subtitle}</p>}
          <ul className="mt-8 border-b border-line">
            {categories.map((cat, i) => (
              <li key={cat.id} className="border-t border-line">
                <Link
                  href={`/category/${cat.slug}`}
                  data-index-item={i}
                  className="ui-press group grid grid-cols-[minmax(0,1fr)_4rem] items-center gap-4 py-3.5 lg:flex lg:items-baseline lg:justify-between lg:py-5"
                >
                  <span className="min-w-0">
                    <span className="block font-display text-[2.5rem] leading-none text-fg transition-colors duration-200 ease-smooth group-hover:text-[color:var(--nav-hover)] lg:text-[4rem]">
                      {cat.name}
                    </span>
                    {subline(cat) && <span className="mt-1 block text-[0.8125rem] text-fg-muted lg:hidden">{subline(cat)}</span>}
                  </span>
                  {subline(cat) && <span className="hidden shrink-0 text-sm text-fg-muted lg:block">{subline(cat)}</span>}
                  {cat.imageUrl ? (
                    <span className="relative block h-20 w-16 overflow-hidden bg-cream-200 lg:hidden">
                      <Image src={resolveImageUrl(cat.imageUrl)} alt="" fill sizes="64px" className="object-cover" />
                    </span>
                  ) : (
                    <span className="lg:hidden" />
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <CategoryIndexPhoto photos={photos} />
      </div>
    </section>
  );
}

/**
 * The lookbook (IMAGE_GALLERY): an ink band whose top edge is the canopy, its title beside a row of tall photographs that
 * scrolls sideways; each picture's caption under it, and "Shop this look" when the store linked it to the pieces.
 */
export function TahafiLookbook({ eyebrow, heading, items }: { eyebrow?: string | null; heading?: string | null; items: ImageGalleryConfig["items"] }) {
  if (items.length === 0) return null;
  return (
    <section data-band="gallery" className="ui-band-inverse bg-ink-950 text-cream-50">
      <Canopy className="fill-canvas" />
      <div className="mx-auto max-w-7xl pb-16 pt-8 sm:pb-24 sm:pt-12 lg:grid lg:grid-cols-[minmax(0,0.8fr)_minmax(0,2.2fr)] lg:items-end lg:gap-14 lg:px-8">
        <div className="px-5 sm:px-8 lg:px-0">
          {eyebrow && <p className="mb-3 text-sm text-ink-300">{eyebrow}</p>}
          {heading && <h2 className="ui-section-heading font-display text-cream-50">{heading}</h2>}
        </div>
        <ul className="mt-8 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-5 px-5 pb-2 sm:gap-5 sm:px-8 lg:mt-0 lg:px-0">
          {items.map((item, i) => (
            <li key={`${item.imageUrl}-${i}`} className="w-[15rem] shrink-0 snap-start sm:w-[17rem] lg:even:mt-12">
              <div className="relative aspect-[3/4] overflow-hidden bg-ink-900">
                <Image src={resolveImageUrl(item.imageUrl)} alt={item.altText || item.caption || ""} fill sizes="(min-width: 640px) 17rem, 15rem" className="object-cover" />
              </div>
              {item.caption && <p className="mt-3 text-sm text-ink-300">{item.caption}</p>}
              {item.linkUrl && (
                <Link href={item.linkUrl} className="mt-1 inline-flex h-10 items-center text-sm text-cream-50 underline decoration-cream-50/40 underline-offset-4 hover:decoration-cream-50">
                  Shop this look
                </Link>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
