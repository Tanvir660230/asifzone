import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import type { FlashSale, Product } from "@clothing-brand/shared";
import { DEFAULT_TRUST_STRIP_ITEMS, DEFAULT_VALUES_GRID_ITEMS } from "@clothing-brand/shared";
import type { CategoryTreeNode } from "@/lib/api/storefront";
import { resolveImageUrl } from "@/lib/image-url";
import { resolveHomepageIcon } from "@/lib/homepage-icons";
import { ProductGrid } from "../../product-grid";
import { CountdownTimer } from "../../countdown-timer";
import { Arch } from "./arch";
import { MihrabSectionHead } from "./section-head";

/* The mihrab preset's homepage sections. Same props and the same admin-authored content as the classic sections
   (components/storefront/*), composed differently: left-aligned, read like a catalogue, with the arch framing the
   photography. Never invent copy — every string is the store's, or a neutral fallback the classic section also uses. */

const SECTION = "mx-auto max-w-7xl px-4 py-[calc(3.5rem*var(--section-rhythm))] sm:px-6 lg:px-8";
const PRIMARY_ACTION =
  "inline-flex h-12 items-center justify-center rounded bg-accent px-7 text-sm font-medium text-accent-fg transition-colors duration-200 ease-smooth hover:bg-accent-hover";
const TEXT_ACTION =
  "inline-flex h-12 items-center text-sm font-medium text-fg underline decoration-line-strong underline-offset-[6px] transition-colors duration-200 ease-smooth hover:decoration-fg";

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

/** Copy on the left, the photograph inside the arch on the right, a stone arch drawn in behind it — the page's one moment. */
export function MihrabHero({
  storeName,
  tagline,
  headline,
  subtext,
  bodyText,
  ctaLabel,
  ctaHref,
  secondaryCtaLabel,
  secondaryCtaHref,
  imageUrl,
  imageAltText,
}: HeroProps) {
  return (
    <section className="overflow-hidden">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 pb-16 pt-10 sm:px-6 lg:grid-cols-12 lg:items-center lg:gap-8 lg:px-8 lg:pb-20 lg:pt-14">
        <div className="lg:col-span-6">
          {subtext && <p className="text-sm font-medium text-[color:var(--nav-hover)]">{subtext}</p>}
          <h2 className="mt-4 max-w-[16ch] text-balance font-display text-[2.5rem] leading-[1.05] text-fg sm:text-[3.25rem] lg:text-[3.75rem]">
            {headline || tagline || storeName}
          </h2>
          {bodyText && <p className="mt-6 max-w-md text-base leading-relaxed text-fg-muted sm:text-lg">{bodyText}</p>}
          <div className="mt-9 flex flex-wrap items-center gap-x-7 gap-y-3">
            <Link href={ctaHref || "/search"} className={PRIMARY_ACTION}>
              {ctaLabel || "Explore the collection"}
            </Link>
            {secondaryCtaLabel && secondaryCtaHref && (
              <Link href={secondaryCtaHref} className={TEXT_ACTION}>
                {secondaryCtaLabel}
              </Link>
            )}
          </div>
        </div>
        <div className="lg:col-span-5 lg:col-start-8">
          <Arch outline className="ui-arch-draw mx-auto aspect-[4/5] w-[68%] max-w-[26rem] sm:w-[56%] lg:w-full">
            {imageUrl && (
              <Image
                src={resolveImageUrl(imageUrl)}
                alt={imageAltText || headline || storeName}
                fill
                priority
                sizes="(min-width: 1024px) 34vw, 82vw"
                className="object-cover"
              />
            )}
          </Arch>
        </div>
      </div>
    </section>
  );
}

/** Categories as a row of arches — a scrolling shelf on phones, one line on desktop. */
export function MihrabCategoryArches({ categories, heading, subtitle }: { categories: CategoryTreeNode[]; heading?: string | null; subtitle?: string | null }) {
  if (categories.length === 0) return null;
  const columns = Math.min(categories.length, 8);
  return (
    <section className={SECTION}>
      <MihrabSectionHead title={heading || "Shop by category"} subtitle={subtitle} link={{ href: "/search", label: "All products" }} />
      <ul
        className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-4 sm:gap-6 sm:overflow-visible sm:px-0 lg:[grid-template-columns:repeat(var(--arch-cols),minmax(0,1fr))]"
        style={{ "--arch-cols": columns } as React.CSSProperties}
      >
        {categories.map((cat) => (
          <li key={cat.id} className="w-[36vw] shrink-0 snap-start sm:w-auto">
            <Link href={`/category/${cat.slug}`} className="group block">
              <Arch className="aspect-[4/5]">
                {cat.imageUrl && (
                  <Image
                    src={resolveImageUrl(cat.imageUrl)}
                    alt={cat.imageAltText || cat.name}
                    fill
                    sizes="(min-width: 1024px) 14vw, (min-width: 640px) 25vw, 36vw"
                    className="object-cover transition-transform duration-500 ease-smooth group-hover:scale-[1.04]"
                  />
                )}
              </Arch>
              <span className="mt-3 block text-center text-sm font-medium text-fg group-hover:text-[color:var(--nav-hover)]">{cat.name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function MihrabProductRail({ heading, subtitle, products, href }: { heading: string; subtitle?: string | null; products: Product[]; href: string }) {
  if (products.length === 0) return null;
  return (
    <section className={SECTION}>
      <MihrabSectionHead title={heading} subtitle={subtitle} link={{ href, label: "View all" }} />
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

/** Without a photograph: a navy band drawn with a faint lattice of arches. With one: photograph and copy side by side. */
export function MihrabPromoBanner({ heading, bodyText, imageUrl, mobileImageUrl, linkUrl, ctaLabel }: PromoProps) {
  const action =
    ctaLabel && linkUrl ? (
      <Link href={linkUrl} className="mt-7 inline-flex h-12 items-center rounded border border-current px-7 text-sm font-medium transition-colors duration-200 ease-smooth hover:bg-cream-50 hover:text-ink-950">
        {ctaLabel}
      </Link>
    ) : null;

  if (!imageUrl) {
    return (
      <section className="ui-arch-lattice bg-ink-950 text-cream-100">
        {/* One column read top to bottom — heading, the line under it, the action — rather than two ends of a row. */}
        <div className="mx-auto max-w-7xl px-4 py-[calc(4.5rem*var(--section-rhythm))] sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            {heading && <h2 className="text-balance font-display text-[2rem] leading-[1.1] text-cream-50 sm:text-[2.75rem]">{heading}</h2>}
            {bodyText && <p className="mt-4 text-base leading-relaxed text-cream-200/85 sm:text-lg">{bodyText}</p>}
            {action}
          </div>
        </div>
      </section>
    );
  }

  const media = (
    <div className="relative aspect-[4/3] overflow-hidden rounded bg-cream-200">
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
  /** The arch beside the copy on the left (the preset's default) or the right — Storefront Studio → Style. */
  imageSide?: "left" | "right";
}

export function MihrabBrandStory({ storeName, tagline, eyebrow, heading, bodyText, ctaLabel, ctaHref, imageUrl, imageAltText, imageSide = "left" }: StoryProps) {
  const right = imageSide === "right";
  return (
    <section className={SECTION}>
      <div className="grid items-center gap-10 lg:grid-cols-12 lg:gap-8">
        {imageUrl && (
          <div className={right ? "lg:order-last lg:col-span-5 lg:col-start-8" : "lg:col-span-5"}>
            <Arch outline className="mx-auto aspect-[4/5] w-[78%] max-w-sm lg:w-[86%]">
              <Image src={resolveImageUrl(imageUrl)} alt={imageAltText || heading || storeName} fill sizes="(min-width: 1024px) 34vw, 78vw" className="object-cover" />
            </Arch>
          </div>
        )}
        <div className={imageUrl ? (right ? "lg:col-span-6 lg:row-start-1" : "lg:col-span-6 lg:col-start-7") : "max-w-2xl lg:col-span-8"}>
          {eyebrow && <p className="text-sm font-medium text-[color:var(--nav-hover)]">{eyebrow}</p>}
          <h2 className="mt-3 text-balance font-display text-[2rem] leading-[1.1] text-fg sm:text-[2.75rem]">{heading || tagline || storeName}</h2>
          {bodyText && <p className="mt-6 max-w-lg text-base leading-relaxed text-fg-muted">{bodyText}</p>}
          <Link href={ctaHref || "/search"} className={`mt-6 ${TEXT_ACTION}`}>
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
    <ul className="grid grid-cols-2 gap-y-8 md:grid-cols-4">
      {items.map((it, index) => {
        const Icon = resolveHomepageIcon(it.icon);
        return (
          <li key={(it.title ?? it.label ?? "") + index} className="border-l border-line pl-4 pr-3 sm:pl-6">
            <Icon size={22} strokeWidth={1.5} className="text-fg" aria-hidden="true" />
            <p className="mt-4 text-sm font-medium text-fg">{it.title ?? it.label}</p>
            {it.description && <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{it.description}</p>}
          </li>
        );
      })}
      {children}
    </ul>
  );
}

export function MihrabValues({ storeName, heading, items = [...DEFAULT_VALUES_GRID_ITEMS] }: { storeName: string; eyebrow?: string | null; heading?: string | null; items?: IconItem[] }) {
  return (
    <section className={SECTION}>
      <MihrabSectionHead title={heading || `Why ${storeName}`} />
      <IconRow items={items} />
    </section>
  );
}

export function MihrabTrustRow({ items = [...DEFAULT_TRUST_STRIP_ITEMS] }: { items?: IconItem[] }) {
  return (
    <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <IconRow items={items} />
    </section>
  );
}

/** A running flash sale: a sand band, the sale's name and the countdown on one line, the products as an ordinary grid. */
export function MihrabFlashSale({ flashSale }: { flashSale: FlashSale }) {
  const products = flashSale.items.map((item) => item.product).filter((p): p is NonNullable<typeof p> => Boolean(p));
  if (products.length === 0) return null;
  return (
    <section className="bg-cream-200">
      <div className={SECTION}>
        <div className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-line-strong pb-4">
          <div>
            <p className="text-sm font-medium text-sale-500">Limited time</p>
            <h2 className="ui-section-heading mt-1 font-display text-fg">{flashSale.name}</h2>
          </div>
          <p className="flex items-baseline gap-2 text-sm text-fg-muted">
            Ends in
            <CountdownTimer endsAt={flashSale.endsAt} className="font-display text-2xl tabular-nums text-sale-500" />
          </p>
        </div>
        <ProductGrid products={products} />
        <Link href="/search" className={`mt-6 ${TEXT_ACTION}`}>
          View all deals
        </Link>
      </div>
    </section>
  );
}
