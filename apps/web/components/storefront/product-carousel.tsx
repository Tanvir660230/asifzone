"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import type { Product } from "@clothing-brand/shared";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { ProductCard } from "./product-card";
import { Reveal } from "./reveal";
import { storeLayout } from "@/lib/theme-layout";
import { MihrabSectionHead } from "./presets/mihrab/section-head";

interface ProductCarouselProps {
  title: string;
  eyebrow?: string;
  subtitle?: string | null;
  /** "View all" destination: the listing this rail is a preview of. */
  href?: string;
  products: Product[];
  /** 2: a homepage section — a plain 4 × 2 grid of the first eight from 1024px. 1: a sideways rail from 1024px. Below
   * 1024px both are the same grid that grows with "Show more" (see GRID_STEP): phones never scroll sideways. */
  rows?: 1 | 2;
}

/** Products a grid section shows per "page" below 1024px: two rows of two on a phone, two rows of three from 640px.
 * Each "Show more" adds one more page. */
const GRID_STEP = { phone: 4, tablet: 6 } as const;
/** From 1024px a grid section is the first eight; the header's "View all" leads to the rest. */
const GRID_DESKTOP_MAX = 8;

/** A homepage product section or a recommendation rail.
 *
 * Below 1024px every product section scrolls the way the page itself scrolls — down — instead of as a sideways strip of
 * half-hidden cards (owner: on a phone, a row you have to swipe from the right is a problem): the first two rows show,
 * "Show more" adds two more rows in place, and once everything is out a "View all" button leads to the full listing.
 * Which cards show is decided per breakpoint in CSS (no layout jump on hydration).
 *
 * From 1024px, Grid (rows=2) is the first eight in a 4 × 2 grid; Rail (rows=1) is one snap-scrolling row of exactly four
 * with arrow controls and a progress bar showing how far along the row the shopper is. */
export function ProductCarousel({ title, eyebrow, subtitle, href, products, rows = 1 }: ProductCarouselProps) {
  const grid = rows === 2;
  const mihrab = storeLayout() === "mihrab";

  if (products.length === 0) return null;

  return (
    <section className="mx-auto max-w-7xl px-4 py-[calc(2.5rem*var(--section-rhythm))] sm:py-[calc(3.5rem*var(--section-rhythm))] sm:px-6 lg:px-8">
      {grid ? (
        <ProductGridSection title={title} eyebrow={eyebrow} subtitle={subtitle} href={href} products={products} mihrab={mihrab} />
      ) : (
        <ProductRail title={title} eyebrow={eyebrow} subtitle={subtitle} href={href} products={products} mihrab={mihrab} />
      )}
    </section>
  );
}

interface PartProps {
  title: string;
  eyebrow?: string;
  subtitle?: string | null;
  href?: string;
  products: Product[];
  mihrab: boolean;
}

function SectionHead({ title, eyebrow, subtitle, href, mihrab, children }: Omit<PartProps, "products"> & { children?: React.ReactNode }) {
  // The mihrab preset heads its rails its own way (title, rule, "View all"); the rail itself is shared.
  if (mihrab) return <MihrabSectionHead title={title} subtitle={subtitle ?? eyebrow} link={href ? { href, label: "View all" } : undefined} />;
  return (
    <Reveal className="mb-6 flex items-end justify-between gap-4 sm:mb-8">
      <div className="min-w-0">
        {eyebrow && <p className="mb-2 text-xs ui-eyebrow text-fg-muted">{eyebrow}</p>}
        <h2 className="ui-section-title font-display text-ink-900">{title}</h2>
        {subtitle && <p className="mt-1.5 max-w-prose text-sm text-ink-500">{subtitle}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {href && (
          <Link
            href={href}
            className="group/all inline-flex items-center gap-1.5 py-2 text-sm font-medium text-ink-900 underline-offset-4 hover:underline"
          >
            View all
            <ArrowRight size={15} className="transition-transform duration-200 ease-smooth group-hover/all:translate-x-0.5" aria-hidden="true" />
          </Link>
        )}
        {children}
      </div>
    </Reveal>
  );
}

/** The below-1024px grid's paging: how many cards each screen shows, and "Show more" moving focus to the first new one. */
function useGridPages(count: number) {
  // How many times "Show more" has been pressed. Each press shows one more step's worth on whichever screen this is.
  const [pages, setPages] = useState(1);
  const listRef = useRef<HTMLElement | null>(null);
  const phoneShown = GRID_STEP.phone * pages;
  const tabletShown = GRID_STEP.tablet * pages;

  function showMore() {
    // Keyboard and screen-reader users land on the first card that just appeared, not back at the top of the section.
    const firstNew = (window.matchMedia("(min-width: 640px)").matches ? GRID_STEP.tablet : GRID_STEP.phone) * pages;
    setPages((p) => p + 1);
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLAnchorElement>(`[data-grid-item="${firstNew}"] a`)?.focus({ preventScroll: true }));
  }

  /** Below 1024px: hidden until "Show more" reaches it; cards past the first page fade in as they are revealed. */
  const itemClass = (i: number) =>
    cn(i >= GRID_STEP.phone && "animate-fade-in", i >= phoneShown && "max-sm:hidden", i >= tabletShown && "sm:max-lg:hidden");

  return { listRef, showMore, itemClass, phoneMore: count > phoneShown, tabletMore: count > tabletShown };
}

function ProductGridSection({ title, eyebrow, subtitle, href, products, mihrab }: PartProps) {
  const { listRef, showMore, itemClass, phoneMore, tabletMore } = useGridPages(products.length);

  return (
    <>
      <SectionHead title={title} eyebrow={eyebrow} subtitle={subtitle} href={href} mihrab={mihrab} />
      <ul
        ref={(el) => {
          listRef.current = el;
        }}
        className="ui-reveal grid grid-cols-2 gap-x-3 gap-y-7 sm:grid-cols-3 sm:gap-x-4 lg:grid-cols-4 lg:gap-y-10"
      >
        {products.map((product, i) => (
          <li key={product.id} data-grid-item={i} className={cn("min-w-0", itemClass(i), i >= GRID_DESKTOP_MAX && "lg:hidden")}>
            <ProductCard product={product} />
          </li>
        ))}
      </ul>
      <GridMore title={title} href={href} phoneMore={phoneMore} tabletMore={tabletMore} onShowMore={showMore} />
    </>
  );
}

/** Below 1024px: "Show more" while there is more for this screen, then "View all" (when the section has a listing). */
function GridMore({ title, href, phoneMore, tabletMore, onShowMore }: { title: string; href?: string; phoneMore: boolean; tabletMore: boolean; onShowMore: () => void }) {
  if (!phoneMore && !tabletMore && !href) return null;
  return (
    <>
      <div className="mt-8 flex justify-center lg:hidden">
        <button
          type="button"
          onClick={onShowMore}
          aria-label={`Show more: ${title}`}
          className={cn(buttonVariants({ variant: "outline", size: "lg" }), "min-w-[12rem]", !phoneMore && "max-sm:hidden", !tabletMore && "sm:hidden")}
        >
          Show more
          <ChevronDown size={17} aria-hidden="true" />
        </button>
        {href && (
          <Link
            href={href}
            className={cn(buttonVariants({ variant: "outline", size: "lg" }), "min-w-[12rem]", phoneMore && "max-sm:hidden", tabletMore && "sm:hidden")}
          >
            View all
            <ArrowRight size={17} aria-hidden="true" />
          </Link>
        )}
      </div>
    </>
  );
}

function ProductRail({ title, eyebrow, subtitle, href, products, mihrab }: PartProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const { listRef, showMore, itemClass, phoneMore, tabletMore } = useGridPages(products.length);
  const [edges, setEdges] = useState({ atStart: true, atEnd: true });
  // The visible share of the row and how far along it is (0–1), for the progress bar.
  const [bar, setBar] = useState({ size: 1, offset: 0 });

  const measure = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const max = track.scrollWidth - track.clientWidth;
    const atStart = track.scrollLeft <= 4;
    const atEnd = track.scrollLeft >= max - 4;
    setEdges((prev) => (prev.atStart === atStart && prev.atEnd === atEnd ? prev : { atStart, atEnd }));
    setBar({ size: Math.min(1, track.clientWidth / track.scrollWidth), offset: max > 0 ? Math.min(1, track.scrollLeft / max) : 0 });
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let frame = 0;
    const onScroll = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          measure();
        });
    };
    measure();
    track.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => {
      track.removeEventListener("scroll", onScroll);
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [measure]);

  function page(direction: 1 | -1) {
    const track = trackRef.current;
    if (!track) return;
    // One "page" of cards, so the next set lands exactly where the current one started.
    track.scrollBy({ left: direction * track.clientWidth, behavior: "smooth" });
  }

  const scrollable = !(edges.atStart && edges.atEnd);

  return (
    <>
      <SectionHead title={title} eyebrow={eyebrow} subtitle={subtitle} href={href} mihrab={mihrab}>
        {scrollable && (
          <div className="ml-2 hidden items-center gap-2 lg:flex">
            <RailButton label={`Previous: ${title}`} disabled={edges.atStart} onClick={() => page(-1)}>
              <ChevronLeft size={18} />
            </RailButton>
            <RailButton label={`Next: ${title}`} disabled={edges.atEnd} onClick={() => page(1)}>
              <ChevronRight size={18} />
            </RailButton>
          </div>
        )}
      </SectionHead>
      {/* Below 1024px the same grid as a homepage section; from 1024px a sideways row of four. */}
      <div
        ref={(el) => {
          trackRef.current = el;
          listRef.current = el;
        }}
        className="ui-rail ui-reveal grid grid-cols-2 gap-x-3 gap-y-7 sm:grid-cols-3 sm:gap-x-4 lg:flex lg:snap-x lg:snap-mandatory lg:gap-4 lg:overflow-x-auto lg:pb-2"
      >
        {products.map((product, i) => (
          <div key={product.id} data-grid-item={i} className={cn("min-w-0 lg:w-[calc((100%-3rem)/4)] lg:shrink-0 lg:snap-start", itemClass(i))}>
            <ProductCard product={product} />
          </div>
        ))}
      </div>
      <GridMore title={title} href={href} phoneMore={phoneMore} tabletMore={tabletMore} onShowMore={showMore} />
      {/* Where in the row the shopper is, and that there is more of it: a thin track with the visible share filled. */}
      {scrollable && (
        <div aria-hidden="true" className="mx-auto mt-4 hidden h-[3px] w-32 overflow-hidden rounded-full bg-line lg:block">
          <div
            className="h-full rounded-full bg-ink-900 transition-transform duration-150 ease-out"
            style={{ width: `${bar.size * 100}%`, transform: `translateX(${(bar.offset * (1 - bar.size) * 100) / bar.size}%)` }}
          />
        </div>
      )}
    </>
  );
}

function RailButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface text-ink-900 transition-[border-color,opacity,transform] duration-200 ease-smooth",
        "hover:border-ink-900 active:scale-95 disabled:cursor-default disabled:opacity-35 disabled:hover:border-line",
      )}
    >
      {children}
    </button>
  );
}
