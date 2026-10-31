import Image from "next/image";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { DEFAULT_TRUST_STRIP_ITEMS, type ImageGalleryConfig } from "@clothing-brand/shared";
import type { CategoryTreeNode } from "@/lib/api/storefront";
import { resolveImageUrl } from "@/lib/image-url";
import { resolveHomepageIcon } from "@/lib/homepage-icons";

/* The tahafi preset's homepage sections (photo cards keep the light theme's colours in either mode, data-surface): the light-glass look — white cards with soft depth on the grey page, large
   radii, glass where something floats on a photograph. Same props and the same admin-authored content as the classic
   sections; never invented copy. */

const SECTION = "mx-auto max-w-7xl px-4 py-[calc(2.25rem*var(--section-rhythm))] sm:px-6 sm:py-[calc(3.5rem*var(--section-rhythm))] lg:px-8";
const CARD = "rounded-[1.375rem] bg-surface shadow-[var(--panel-shadow)]";
const PHOTO_GLASS =
  "border border-white/20 bg-black/30 shadow-[inset_0_1px_0_rgb(255_255_255/0.25)] backdrop-blur-xl backdrop-saturate-150";

function SectionHead({ title, subtitle, link }: { title: string; subtitle?: string | null; link?: { href: string; label: string } }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4 sm:mb-6">
      <div className="min-w-0">
        <h2 className="ui-section-title font-display text-fg">{title}</h2>
        {subtitle && <p className="mt-1.5 max-w-prose text-sm text-fg-muted">{subtitle}</p>}
      </div>
      {link && (
        <Link href={link.href} className="shrink-0 py-2 text-[0.9375rem] font-medium text-[color:var(--nav-hover)] hover:underline">
          {link.label}
        </Link>
      )}
    </div>
  );
}

/** The store's promises on one white card, each with its icon on a tinted tile — like a row of iPhone settings. */
export function TahafiPromiseLine({ items = [...DEFAULT_TRUST_STRIP_ITEMS] }: { items?: { icon: string; label: string }[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-label="Our promises" className="mx-auto max-w-7xl px-4 pt-4 sm:px-6 lg:px-8">
      <ul className={`${CARD} grid divide-y divide-line-subtle px-4 sm:grid-cols-[repeat(auto-fit,minmax(0,1fr))] sm:divide-x sm:divide-y-0 sm:px-0`}>
        {items.map(({ icon, label }) => {
          const Icon = resolveHomepageIcon(icon);
          return (
            <li key={label} className="flex items-center gap-3 py-3 sm:justify-center sm:px-5 sm:py-4">
              <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[0.625rem] bg-sale-50 text-sale-600">
                <Icon size={17} strokeWidth={1.9} />
              </span>
              <span className="text-[0.9375rem] font-medium text-fg">{label}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Categories: on phones a row of chips, each with a small round photograph, that scrolls sideways; on wide screens large
 * rounded photo cards with the name on a glass bar.
 */
export function TahafiCategoryIndex({ categories, heading, subtitle }: { categories: CategoryTreeNode[]; heading?: string | null; subtitle?: string | null }) {
  if (categories.length === 0) return null;
  return (
    <section className={SECTION}>
      <SectionHead title={heading || "Shop by category"} subtitle={subtitle} link={{ href: "/search", label: "See all" }} />
      <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:hidden">
        {categories.map((cat) => (
          <li key={cat.id} className="shrink-0">
            <Link href={`/category/${cat.slug}`} className={`${CARD} ui-press flex h-12 items-center gap-2.5 rounded-full pl-1.5 pr-5 text-[0.9375rem] font-medium text-fg`}>
              {cat.imageUrl ? (
                <span className="relative h-9 w-9 overflow-hidden rounded-full bg-cream-200">
                  <Image src={resolveImageUrl(cat.imageUrl)} alt="" fill sizes="36px" className="object-cover" />
                </span>
              ) : (
                <span className="w-2" />
              )}
              {cat.name}
            </Link>
          </li>
        ))}
      </ul>
      <ul className="hidden gap-5 md:grid md:grid-cols-[repeat(auto-fit,minmax(13rem,1fr))]">
        {categories.map((cat) => (
          <li key={cat.id}>
            <Link data-surface="storefront" href={`/category/${cat.slug}`} className="group relative block aspect-[4/5] overflow-hidden rounded-[1.75rem] bg-cream-200">
              {cat.imageUrl && (
                <Image
                  src={resolveImageUrl(cat.imageUrl)}
                  alt={cat.imageAltText || cat.name}
                  fill
                  sizes="(min-width: 1280px) 20rem, 33vw"
                  className="object-cover transition-transform duration-500 ease-smooth group-hover:scale-[1.04]"
                />
              )}
              <span className={`absolute inset-x-3 bottom-3 flex h-12 items-center justify-between rounded-full pl-5 pr-3 text-[0.9375rem] font-semibold text-cream-50 ${PHOTO_GLASS}`}>
                {cat.name}
                <ChevronRight size={18} aria-hidden="true" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The lookbook (IMAGE_GALLERY): tall rounded photo cards that scroll sideways, each caption on a glass bar, and "Shop this
 * look" when the store linked the picture to its pieces.
 */
export function TahafiLookbook({ eyebrow, heading, items }: { eyebrow?: string | null; heading?: string | null; items: ImageGalleryConfig["items"] }) {
  if (items.length === 0) return null;
  return (
    <section className={SECTION}>
      {eyebrow && <p className="mb-1 text-sm font-semibold text-[color:var(--nav-hover)]">{eyebrow}</p>}
      {heading && <SectionHead title={heading} />}
      <ul className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pb-2 sm:-mx-6 sm:gap-5 sm:px-6 lg:mx-0 lg:px-0">
        {items.map((item, i) => {
          const card = (
            <>
              <Image src={resolveImageUrl(item.imageUrl)} alt={item.altText || item.caption || ""} fill sizes="(min-width: 640px) 18rem, 15rem" className="object-cover" />
              {(item.caption || item.linkUrl) && (
                <span className={`absolute inset-x-2.5 bottom-2.5 rounded-[1.125rem] px-4 py-2.5 text-cream-50 ${PHOTO_GLASS}`}>
                  {item.caption && <span className="block truncate text-[0.9375rem] font-semibold">{item.caption}</span>}
                  {item.linkUrl && <span className="block text-[0.8125rem] text-cream-50/85">Shop this look</span>}
                </span>
              )}
            </>
          );
          return (
            <li key={`${item.imageUrl}-${i}`} className="w-[15rem] shrink-0 snap-start sm:w-[18rem]">
              {item.linkUrl ? (
                <Link data-surface="storefront" href={item.linkUrl} className="ui-press relative block aspect-[3/4] overflow-hidden rounded-[1.75rem] bg-cream-200">
                  {card}
                </Link>
              ) : (
                <div data-surface="storefront" className="relative aspect-[3/4] overflow-hidden rounded-[1.75rem] bg-cream-200">{card}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
