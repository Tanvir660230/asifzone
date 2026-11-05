import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import type { FlashSale, Product } from "@clothing-brand/shared";
import { DEFAULT_TRUST_STRIP_ITEMS, DEFAULT_VALUES_GRID_ITEMS } from "@clothing-brand/shared";
import type { CategoryTreeNode } from "@/lib/api/storefront";
import { resolveImageUrl } from "@/lib/image-url";
import { resolveHomepageIcon } from "@/lib/homepage-icons";
import { cn } from "@/lib/utils";
import { ProductGrid } from "../../product-grid";
import { CountdownTimer } from "../../countdown-timer";
import { Disc } from "./disc";
import { HoneySectionHead } from "./section-head";

/* The honey preset's homepage sections. Same props and the same admin-authored content as the classic sections
   (components/storefront/*), composed for a dark page: one product glowing in the hero, large soft photo tiles, panels for
   the cards. Never invent copy — every string is the store's, or a neutral fallback the classic section also uses. */

const WIDTH = "mx-auto max-w-[90rem] px-4 sm:px-6 lg:px-12";
const SECTION = `${WIDTH} py-[calc(2.25rem*var(--section-rhythm))] sm:py-[calc(3.5rem*var(--section-rhythm))]`;
const PRIMARY_ACTION =
  "inline-flex h-14 items-center justify-center rounded-full bg-accent px-8 font-display text-[1.0625rem] font-semibold tracking-normal text-accent-fg transition-colors duration-200 ease-smooth hover:bg-accent-hover";
const TEXT_ACTION =
  "inline-flex h-12 items-center font-display text-base font-medium tracking-normal text-[color:var(--nav-hover)] underline decoration-1 underline-offset-[6px]";
const TAG =
  "absolute bottom-3 left-3 flex h-10 items-center rounded-full bg-canvas/85 px-4 font-display text-base font-medium tracking-normal text-fg sm:bottom-[1.125rem] sm:left-[1.125rem] sm:h-[2.875rem] sm:px-5 sm:text-[1.1875rem]";

interface HeroProps {
  storeName: string;
  tagline?: string | null;
  headline?: string | null;
  subtext?: string | null;
  bodyText?: string | null;
  ctaLabel?: string | null;
  ctaHref?: string | null;
  secondaryCtaLabel?: string | null;
  secondaryCtaHref?: string | null;
  imageUrl?: string | null;
  imageAltText?: string | null;
}

/**
 * The page's one moment. A two-word name is a product: it stands in front of a glowing disc (a cut-out on a transparent
 * background works best, Storefront Studio) with the name on either side of it on wide screens. A longer headline is a
 * message: the words on the left, the photograph in a rounded frame beside them, or below them on a phone.
 */
export function HoneyHero({ storeName, tagline, headline, subtext, bodyText, ctaLabel, ctaHref, secondaryCtaLabel, secondaryCtaHref, imageUrl, imageAltText }: HeroProps) {
  const title = (headline || tagline || storeName).trim();
  const words = title.split(/\s+/);
  const split = words.length === 2;
  const line = bodyText || subtext;

  return (
    <section className="relative h-[43rem] overflow-hidden lg:h-[clamp(36rem,calc(60vw-4rem),50rem)]">
      {split && <Disc className="absolute bottom-[6.5rem] left-1/2 w-[20.5rem] -translate-x-1/2 lg:bottom-auto lg:top-1/2 lg:w-[min(32vw,29.5rem)] lg:-translate-y-1/2" />}
      <h2
        className={cn(
          "absolute inset-x-0 top-3 px-4 font-display tracking-[-0.045em] text-fg sm:px-6 lg:top-1/2 lg:-translate-y-1/2 lg:px-12",
          split
            ? "text-[4.5rem] leading-[0.92] lg:flex lg:justify-between lg:text-[clamp(4rem,8.9vw,8.25rem)] lg:leading-none"
            : "line-clamp-3 text-[2.75rem] leading-[1.02] lg:line-clamp-none lg:max-w-[50%] lg:pr-6 lg:text-[clamp(3rem,5.6vw,5.25rem)]",
        )}
      >
        {split ? (
          <>
            <span className="block">{words[0]}</span>
            <span className="block text-right lg:text-left">{words[1]}</span>
          </>
        ) : (
          title
        )}
      </h2>
      {imageUrl && (
        <div
          className={
            split
              ? "absolute inset-x-0 bottom-[5.5rem] h-[27.5rem] lg:bottom-[7%] lg:h-[80%]"
              : "absolute inset-x-4 bottom-[5.5rem] top-[10.5rem] overflow-hidden rounded-2xl sm:inset-x-6 lg:bottom-[6.5rem] lg:left-[52%] lg:right-12 lg:top-6"
          }
        >
          <Image
            src={resolveImageUrl(imageUrl)}
            alt={imageAltText || title}
            fill
            priority
            sizes="(min-width: 1024px) 40vw, 90vw"
            className={split ? "object-contain [filter:var(--disc-photo-shadow)]" : "object-cover"}
          />
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-6 px-4 pb-4 sm:px-6 lg:px-12 lg:pb-8">
        {line && <p className="hidden max-w-[17em] text-[1.1875rem] leading-snug text-fg-muted lg:block">{line}</p>}
        <div className="flex w-full items-center gap-5 lg:ml-auto lg:w-auto">
          {secondaryCtaLabel && secondaryCtaHref && (
            <Link href={secondaryCtaHref} className={cn(TEXT_ACTION, "hidden lg:inline-flex")}>
              {secondaryCtaLabel}
            </Link>
          )}
          <Link href={ctaHref || "/search"} className={cn(PRIMARY_ACTION, "w-full lg:w-auto")}>
            {ctaLabel || "Shop now"}
          </Link>
        </div>
      </div>
    </section>
  );
}

function CategoryPhoto({ category, sizes }: { category: CategoryTreeNode; sizes: string }) {
  if (!category.imageUrl) return null;
  return (
    <Image
      src={resolveImageUrl(category.imageUrl)}
      alt={category.imageAltText || category.name}
      fill
      sizes={sizes}
      className="object-cover transition-transform duration-500 ease-smooth group-hover:scale-[1.03]"
    />
  );
}

/** Categories as large photo tiles: the first one big, in the store's orange, the next two beside it, any others in a row
 * below. */
export function HoneyCategoryTiles({ categories, heading, subtitle }: { categories: CategoryTreeNode[]; heading?: string | null; subtitle?: string | null }) {
  const [lead, ...rest] = categories;
  if (!lead) return null;
  const beside = rest.slice(0, 2);
  const others = rest.slice(2);
  return (
    <section className={SECTION}>
      {heading && <HoneySectionHead title={heading} subtitle={subtitle} />}
      <div className={cn("grid grid-cols-2 gap-3 sm:gap-4", beside.length > 0 && "lg:grid-cols-[1.25fr_1fr] lg:grid-rows-[18.75rem_18.75rem]")}>
        <Link
          href={`/category/${lead.slug}`}
          className={cn(
            "group relative col-span-2 block h-[18.75rem] overflow-hidden rounded-2xl bg-accent text-accent-fg",
            beside.length > 0 ? "lg:col-span-1 lg:row-span-2 lg:h-auto" : "lg:h-[24rem]",
          )}
        >
          <CategoryPhoto category={lead} sizes="(min-width: 1024px) 55vw, 100vw" />
          <span className="absolute left-[1.125rem] top-[1.125rem] max-w-[62%] font-display text-[2.25rem] leading-none sm:left-8 sm:top-7 sm:text-[clamp(2.5rem,4.4vw,3.875rem)]">
            {lead.name}
          </span>
        </Link>
        {beside.map((category) => (
          <Link
            key={category.id}
            href={`/category/${category.slug}`}
            className={cn("group relative block h-[12.5rem] overflow-hidden rounded-2xl bg-cream-200 lg:h-auto", beside.length === 1 && "col-span-2 lg:col-span-1 lg:row-span-2")}
          >
            <CategoryPhoto category={category} sizes="(min-width: 1024px) 42vw, 50vw" />
            <span className={TAG}>{category.name}</span>
          </Link>
        ))}
      </div>
      {others.length > 0 && (
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:mt-4 sm:gap-4 lg:grid-cols-4">
          {others.map((category) => (
            <li key={category.id}>
              <Link href={`/category/${category.slug}`} className="group relative block h-[11rem] overflow-hidden rounded-2xl bg-cream-200 lg:h-[14rem]">
                <CategoryPhoto category={category} sizes="(min-width: 1024px) 22vw, 50vw" />
                <span className={TAG}>{category.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function HoneyProductRail({ heading, subtitle, products, href }: { heading: string; subtitle?: string | null; products: Product[]; href: string }) {
  if (products.length === 0) return null;
  return (
    <section className={SECTION}>
      <HoneySectionHead title={heading} subtitle={subtitle} link={{ href, label: "See all" }} />
      <ProductGrid products={products} />
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

/** Without a photograph: a full-width orange band. With one: the photograph and the copy side by side. */
export function HoneyPromoBanner({ heading, bodyText, imageUrl, mobileImageUrl, linkUrl, ctaLabel }: PromoProps) {
  if (!imageUrl) {
    return (
      <section className="mt-[calc(2.25rem*var(--section-rhythm))] bg-accent text-accent-fg sm:mt-[calc(3.5rem*var(--section-rhythm))]">
        <div className={`${WIDTH} flex flex-wrap items-center justify-between gap-6 py-8 sm:py-11`}>
          <div className="max-w-3xl">
            {heading && <h2 className="text-balance font-display text-[2.125rem] leading-[1.1] sm:text-[clamp(2.125rem,4.4vw,3.875rem)]">{heading}</h2>}
            {bodyText && <p className="mt-3 text-base leading-relaxed sm:text-lg">{bodyText}</p>}
          </div>
          {ctaLabel && linkUrl && (
            <Link href={linkUrl} className="inline-flex h-14 items-center rounded-full bg-canvas px-8 font-display text-[1.0625rem] font-semibold tracking-normal text-fg">
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
      <div className="grid items-center gap-8 lg:grid-cols-12">
        <div className="lg:col-span-7">{linkUrl ? <Link href={linkUrl}>{media}</Link> : media}</div>
        <div className="lg:col-span-4 lg:col-start-9">
          {heading && <h2 className="text-balance font-display text-[1.875rem] leading-[1.1] text-fg sm:text-[2.5rem]">{heading}</h2>}
          {bodyText && <p className="mt-4 text-base leading-relaxed text-fg-muted">{bodyText}</p>}
          {ctaLabel && linkUrl && (
            <Link href={linkUrl} className={`mt-7 ${PRIMARY_ACTION}`}>
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

export function HoneyBrandStory({ storeName, tagline, eyebrow, heading, bodyText, ctaLabel, ctaHref, imageUrl, imageAltText, imageSide = "left" }: StoryProps) {
  const right = imageSide === "right";
  return (
    <section className={SECTION}>
      <div className="grid items-center gap-8 rounded-3xl bg-surface p-5 sm:p-8 lg:grid-cols-12 lg:gap-10 lg:p-10">
        {imageUrl && (
          <div className={cn("relative aspect-[5/4] overflow-hidden rounded-2xl bg-cream-200 lg:col-span-6", right && "lg:order-last")}>
            <Image src={resolveImageUrl(imageUrl)} alt={imageAltText || heading || storeName} fill sizes="(min-width: 1024px) 45vw, 92vw" className="object-cover" />
          </div>
        )}
        <div className={imageUrl ? "lg:col-span-6" : "max-w-2xl lg:col-span-8"}>
          {eyebrow && <p className="text-sm font-medium text-[color:var(--nav-hover)]">{eyebrow}</p>}
          <h2 className="mt-2 text-balance font-display text-[2rem] leading-[1.1] text-fg sm:text-[2.75rem]">{heading || tagline || storeName}</h2>
          {bodyText && <p className="mt-5 max-w-lg text-base leading-relaxed text-fg-muted">{bodyText}</p>}
          <Link href={ctaHref || "/search"} className={`mt-4 ${TEXT_ACTION}`}>
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
    <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
      {items.map((it, index) => {
        const Icon = resolveHomepageIcon(it.icon);
        return (
          <li key={(it.title ?? it.label ?? "") + index} className="rounded-2xl bg-surface p-4 sm:p-5">
            <Icon size={22} strokeWidth={1.6} className="text-[color:var(--nav-hover)]" aria-hidden="true" />
            <p className="mt-3 font-display text-[1.0625rem] font-medium tracking-normal text-fg">{it.title ?? it.label}</p>
            {it.description && <p className="mt-1 text-sm leading-relaxed text-fg-muted">{it.description}</p>}
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
      <IconRow items={items} />
    </section>
  );
}

export function HoneyTrustRow({ items = [...DEFAULT_TRUST_STRIP_ITEMS] }: { items?: IconItem[] }) {
  return (
    <section className={`${WIDTH} py-6 sm:py-8`}>
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
      <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <p className="text-sm font-medium text-[color:var(--nav-hover)]">Limited time</p>
          <h2 className="ui-section-heading mt-1 font-display text-fg">{flashSale.name}</h2>
        </div>
        <p className="flex items-baseline gap-2 text-sm text-fg-muted">
          Ends in
          <CountdownTimer endsAt={flashSale.endsAt} className="font-display text-2xl tabular-nums text-[color:var(--nav-hover)]" />
        </p>
      </div>
      <ProductGrid products={products} />
      <Link href="/search" className={`mt-4 ${TEXT_ACTION}`}>
        View all deals
      </Link>
    </section>
  );
}
