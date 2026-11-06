import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { FlashSale, Product } from "@clothing-brand/shared";
import { DEFAULT_TRUST_STRIP_ITEMS, DEFAULT_VALUES_GRID_ITEMS } from "@clothing-brand/shared";
import type { CategoryTreeNode } from "@/lib/api/storefront";
import { resolveImageUrl } from "@/lib/image-url";
import { resolveHomepageIcon } from "@/lib/homepage-icons";
import { cn } from "@/lib/utils";
import { ProductGrid } from "../../product-grid";
import { CountdownTimer } from "../../countdown-timer";
import { HoneySectionHead } from "./section-head";

/* The honey preset's homepage sections. Same props and the same admin-authored content as the classic sections
   (components/storefront/*), composed like a tidy shop: a small offer at the top, then shelves of products. White cards on a
   soft page, the honey tint only on the top offer and promo. Never invent copy — every string is the store's, or a neutral
   fallback the classic section also uses. */

const WIDTH = "mx-auto max-w-7xl px-3 sm:px-6 lg:px-8";
const SECTION = `${WIDTH} py-4 sm:py-6`;
const PRIMARY_ACTION =
  "inline-flex h-11 items-center justify-center whitespace-nowrap rounded-[var(--control-radius)] bg-accent px-5 text-[0.9375rem] font-semibold text-accent-fg transition-colors duration-200 ease-smooth hover:bg-accent-hover";
const TEXT_ACTION = "inline-flex h-11 items-center text-sm font-semibold text-[color:var(--nav-hover)]";
const CARD = "rounded-2xl border border-line-subtle bg-surface";

interface HeroProps {
  storeName: string;
  tagline?: string | null;
  headline?: string | null;
  subtext?: string | null;
  bodyText?: string | null;
  ctaLabel?: string | null;
  ctaHref?: string | null;
  imageUrl?: string | null;
  imageAltText?: string | null;
  categories?: CategoryTreeNode[];
}

/** How many categories sit beside the hero: all of them up to three, so a small shop has no lone tile further down. */
export const HERO_TILES = 3;

/** A category as a small white tile: the name and, when it has one, its photograph at the right edge. */
function CategoryTile({ category, className }: { category: CategoryTreeNode; className?: string }) {
  return (
    <Link href={`/category/${category.slug}`} className={cn(CARD, "group flex min-h-[5.25rem] items-center justify-between gap-2 overflow-hidden pl-3 sm:pl-5", className)}>
      <span className="min-w-0 py-3 text-[0.9375rem] font-semibold leading-tight text-fg sm:text-lg">{category.name}</span>
      {category.imageUrl ? (
        <span className="relative h-full min-h-[5.25rem] w-[4.5rem] shrink-0 sm:w-36">
          <Image
            src={resolveImageUrl(category.imageUrl)}
            alt=""
            fill
            sizes="(min-width: 640px) 144px, 72px"
            className="object-cover transition-transform duration-500 ease-smooth group-hover:scale-[1.03]"
          />
        </span>
      ) : (
        <ChevronRight size={18} className="mr-3 shrink-0 text-fg-muted" aria-hidden="true" />
      )}
    </Link>
  );
}

/**
 * The top of the shop: the store's offer on the honey tint, with the first categories as small tiles beside it (under it
 * on a phone). The whole offer is one link. A cut-out photograph on a transparent background sits best on the tint
 * (Storefront Studio).
 */
export function HoneyHero({ storeName, tagline, headline, subtext, bodyText, ctaLabel, ctaHref, imageUrl, imageAltText, categories = [] }: HeroProps) {
  const title = (headline || tagline || storeName).trim();
  const line = bodyText || subtext;
  const tiles = categories.slice(0, HERO_TILES);

  return (
    <section className={`${WIDTH} pt-3 sm:pt-4`}>
      <div className={cn("grid grid-cols-2 gap-2.5 sm:gap-3.5", tiles.length > 0 && "lg:grid-cols-3", tiles.length === 2 && "lg:grid-rows-2", tiles.length === 3 && "lg:grid-rows-3")}>
        <Link
          href={ctaHref || "/search"}
          className={cn(
            "col-span-2 grid min-h-[12rem] grid-cols-[minmax(0,1fr)_38%] items-center gap-2 overflow-hidden rounded-2xl bg-[var(--offer-tint)] py-4 pl-4 pr-2 sm:min-h-[16rem] sm:pl-8 lg:min-h-[20.5rem] lg:gap-6 lg:pl-12 lg:pr-6",
            tiles.length === 2 && "lg:row-span-2",
            tiles.length === 3 && "lg:row-span-3",
          )}
        >
          <span className="min-w-0">
            <h2 className="line-clamp-4 text-balance font-display text-[1.375rem] leading-[1.15] text-fg sm:text-[2rem] lg:line-clamp-3 lg:text-[2.625rem]">{title}</h2>
            {line && <p className="mt-1.5 line-clamp-3 max-w-[32ch] text-[0.8125rem] leading-snug text-ink-600 sm:mt-2.5 sm:text-base">{line}</p>}
            <span className={cn(PRIMARY_ACTION, "mt-3 h-10 px-4 text-sm sm:mt-5 sm:h-11 sm:px-5 sm:text-[0.9375rem]")}>{ctaLabel || "Shop now"}</span>
          </span>
          {imageUrl && (
            <span className="relative block aspect-square overflow-hidden rounded-xl">
              <Image src={resolveImageUrl(imageUrl)} alt={imageAltText || title} fill priority sizes="(min-width: 1024px) 26vw, 38vw" className="object-cover" />
            </span>
          )}
        </Link>
        {tiles.map((category, index) => (
          <CategoryTile key={category.id} category={category} className={cn("h-full", tiles.length % 2 === 1 && index === tiles.length - 1 && "col-span-2 lg:col-span-1")} />
        ))}
      </div>
    </section>
  );
}

/** Any categories the hero's tiles don't show, as the same small tiles. */
export function HoneyCategoryTiles({ categories, heading, subtitle }: { categories: CategoryTreeNode[]; heading?: string | null; subtitle?: string | null }) {
  if (categories.length === 0) return null;
  return (
    <section className={SECTION}>
      {heading && <HoneySectionHead title={heading} subtitle={subtitle} />}
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3.5 lg:grid-cols-4">
        {categories.map((category) => (
          <CategoryTile key={category.id} category={category} />
        ))}
      </div>
    </section>
  );
}

export function HoneyProductRail({ heading, subtitle, products, href }: { heading: string; subtitle?: string | null; products: Product[]; href: string }) {
  if (products.length === 0) return null;
  return (
    <section className={SECTION}>
      <HoneySectionHead title={heading} subtitle={subtitle} link={{ href, label: "See all" }} />
      <ProductGrid products={products} wide />
    </section>
  );
}

interface PromoProps {
  heading?: string | null;
  bodyText?: string | null;
  imageUrl?: string | null;
  mobileImageUrl?: string | null;
  linkUrl?: string | null;
  ctaLabel?: string | null;
}

/** Without a photograph: a short band on the honey tint. With one: the photograph and the copy side by side. */
export function HoneyPromoBanner({ heading, bodyText, imageUrl, mobileImageUrl, linkUrl, ctaLabel }: PromoProps) {
  if (!imageUrl) {
    return (
      <section className={SECTION}>
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-[var(--offer-tint)] px-4 py-5 sm:px-8 sm:py-6">
          <div className="min-w-0 max-w-3xl">
            {heading && <h2 className="text-balance font-display text-xl leading-tight text-fg sm:text-2xl">{heading}</h2>}
            {bodyText && <p className="mt-1 text-sm leading-relaxed text-ink-600 sm:text-base">{bodyText}</p>}
          </div>
          {ctaLabel && linkUrl && (
            <Link href={linkUrl} className={PRIMARY_ACTION}>
              {ctaLabel}
            </Link>
          )}
        </div>
      </section>
    );
  }

  const media = (
    <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-cream-200">
      <Image src={resolveImageUrl(mobileImageUrl || imageUrl)} alt={heading || ""} fill sizes="100vw" className="object-cover sm:hidden" />
      <Image src={resolveImageUrl(imageUrl)} alt={heading || ""} fill sizes="(min-width: 1024px) 58vw, 100vw" className="hidden object-cover sm:block" />
    </div>
  );
  return (
    <section className={SECTION}>
      <div className="grid items-center gap-5 lg:grid-cols-12 lg:gap-8">
        <div className="lg:col-span-7">{linkUrl ? <Link href={linkUrl}>{media}</Link> : media}</div>
        <div className="lg:col-span-5">
          {heading && <h2 className="text-balance font-display text-2xl leading-tight text-fg sm:text-3xl">{heading}</h2>}
          {bodyText && <p className="mt-2 text-base leading-relaxed text-fg-muted">{bodyText}</p>}
          {ctaLabel && linkUrl && (
            <Link href={linkUrl} className={`mt-5 ${PRIMARY_ACTION}`}>
              {ctaLabel}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}

interface StoryProps {
  storeName: string;
  tagline?: string | null;
  eyebrow?: string | null;
  heading?: string | null;
  bodyText?: string | null;
  ctaLabel?: string | null;
  ctaHref?: string | null;
  imageUrl?: string | null;
  imageAltText?: string | null;
  /** The photograph beside the copy on the left (the preset's default) or the right — Storefront Studio → Style. */
  imageSide?: "left" | "right";
}

export function HoneyBrandStory({ storeName, tagline, heading, bodyText, ctaLabel, ctaHref, imageUrl, imageAltText, imageSide = "left" }: StoryProps) {
  const right = imageSide === "right";
  return (
    <section className={SECTION}>
      <div className={cn(CARD, "grid items-center gap-5 p-3 sm:p-5 lg:grid-cols-12 lg:gap-10")}>
        {imageUrl && (
          <div className={cn("relative aspect-[16/10] overflow-hidden rounded-xl bg-cream-200 lg:col-span-5", right && "lg:order-last")}>
            <Image src={resolveImageUrl(imageUrl)} alt={imageAltText || heading || storeName} fill sizes="(min-width: 1024px) 40vw, 92vw" className="object-cover" />
          </div>
        )}
        <div className={cn("px-1 pb-1 sm:px-0", imageUrl ? "lg:col-span-7" : "max-w-2xl lg:col-span-8")}>
          <h2 className="text-balance font-display text-xl leading-tight text-fg sm:text-2xl">{heading || tagline || storeName}</h2>
          {bodyText && <p className="mt-2 max-w-[60ch] text-[0.9375rem] leading-relaxed text-fg-muted">{bodyText}</p>}
          <Link href={ctaHref || "/search"} className={`mt-1 ${TEXT_ACTION}`}>
            {ctaLabel || "Explore the collection"}
          </Link>
        </div>
      </div>
    </section>
  );
}

interface IconItem {
  icon: string;
  title?: string;
  label?: string;
  description?: string;
}

function IconRow({ items, children }: { items: IconItem[]; children?: ReactNode }) {
  return (
    <ul className="flex flex-wrap gap-x-7 gap-y-2.5">
      {items.map((it, index) => {
        const Icon = resolveHomepageIcon(it.icon);
        return (
          <li key={(it.title ?? it.label ?? "") + index} className="flex items-center gap-2 text-[0.8125rem] font-semibold text-fg sm:text-sm">
            <Icon size={20} strokeWidth={1.9} className="shrink-0 text-sale-500" aria-hidden="true" />
            {it.title ?? it.label}
          </li>
        );
      })}
      {children}
    </ul>
  );
}

export function HoneyValues({ storeName, heading, items = [...DEFAULT_VALUES_GRID_ITEMS] }: { storeName: string; eyebrow?: string | null; heading?: string | null; items?: IconItem[] }) {
  return (
    <section className={SECTION}>
      <HoneySectionHead title={heading || `Why ${storeName}`} />
      <ul className="grid gap-2.5 sm:grid-cols-2 sm:gap-3.5 lg:grid-cols-4">
        {items.map((it, index) => {
          const Icon = resolveHomepageIcon(it.icon);
          return (
            <li key={(it.title ?? it.label ?? "") + index} className={cn(CARD, "flex gap-3 p-4")}>
              <Icon size={22} strokeWidth={1.9} className="shrink-0 text-sale-500" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-[0.9375rem] font-semibold text-fg">{it.title ?? it.label}</p>
                {it.description && <p className="mt-0.5 text-sm leading-relaxed text-fg-muted">{it.description}</p>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function HoneyTrustRow({ items = [...DEFAULT_TRUST_STRIP_ITEMS] }: { items?: IconItem[] }) {
  return (
    <section className={`${WIDTH} pt-3.5 sm:pt-4`}>
      <IconRow items={items} />
    </section>
  );
}

/** A running flash sale: the sale's name and the countdown on one line, the products as an ordinary grid. */
export function HoneyFlashSale({ flashSale }: { flashSale: FlashSale }) {
  const products = flashSale.items.map((item) => item.product).filter((p): p is NonNullable<typeof p> => Boolean(p));
  if (products.length === 0) return null;
  return (
    <section className={SECTION}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 className="ui-section-heading font-display text-fg">{flashSale.name}</h2>
        <p className="flex items-baseline gap-2 text-sm text-fg-muted">
          Ends in
          <CountdownTimer endsAt={flashSale.endsAt} className="text-lg font-bold tabular-nums text-[color:var(--nav-hover)]" />
        </p>
      </div>
      <ProductGrid products={products} wide />
      <Link href="/search" className={`mt-1 ${TEXT_ACTION}`}>
        View all deals
      </Link>
    </section>
  );
}
