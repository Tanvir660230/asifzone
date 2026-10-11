"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import type { Product } from "@clothing-brand/shared";
import { cn } from "@/lib/utils";
import { ProductCard } from "./product-card";
import { Reveal } from "./reveal";

interface ProductCarouselProps {
  title: string;
  eyebrow?: string;
  subtitle?: string | null;
  /** "View all" destination: the listing this rail is a preview of. */
  href?: string;
  products: Product[];
  /** Two rows: on phones and tablets two rows that swipe sideways together (twice the products in view), from 1024px a
   * plain 4 × 2 grid of the first eight. Used by the homepage sections; needs at least four products to apply. */
  rows?: 1 | 2;
}

/** Two-row track: column-flow grid that scrolls sideways below 1024px, a 4-column grid above. */
const TWO_ROW_TRACK =
  "grid grid-flow-col grid-rows-2 auto-cols-[calc((100%-1rem)/2.25)] gap-x-4 gap-y-8 sm:auto-cols-[calc((100%-2rem)/3)] lg:grid-flow-row lg:grid-cols-4 lg:grid-rows-none lg:auto-cols-auto lg:gap-x-4 lg:gap-y-10";

/** A product rail: a horizontal, snap-scrolling row — two cards and a peek of the third on a phone, exactly four on a
 * desktop (the card width is derived from the track, so the row lines up with the page grid), with arrow controls that
 * disable at either end. Used by the homepage product sections and the product page's recommendation rails, so every
 * rail on the site behaves the same. */
export function ProductCarousel({ title, eyebrow, subtitle, href, products, rows = 1 }: ProductCarouselProps) {
  const twoRows = rows === 2 && products.length >= 4;
  const trackRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ atStart: true, atEnd: true });

  const measure = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const atStart = track.scrollLeft <= 4;
    const atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
    setEdges((prev) => (prev.atStart === atStart && prev.atEnd === atEnd ? prev : { atStart, atEnd }));
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

  if (products.length === 0) return null;
  const scrollable = !(edges.atStart && edges.atEnd);

  return (
    <section className="mx-auto max-w-7xl px-4 py-[calc(2.5rem*var(--section-rhythm))] sm:py-[calc(3.5rem*var(--section-rhythm))] sm:px-6 lg:px-8">
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
        </div>
      </Reveal>
      {/* Bleeds to the screen edge on phones (negative margin + matching padding) so the peeking card reads as "more to
          swipe", while the first card still lines up with the page gutter. */}
      <div
        ref={trackRef}
        className={cn(
          "ui-rail ui-reveal -mx-4 snap-x snap-mandatory scroll-px-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:mx-0 lg:scroll-px-0 lg:px-0",
          twoRows ? TWO_ROW_TRACK : "flex gap-4",
        )}
      >
        {products.map((product, i) => (
          <div
            key={product.id}
            className={
              twoRows
                ? cn("min-w-0 snap-start", i >= 8 && "lg:hidden")
                : "w-[calc((100%-1rem)/2.25)] shrink-0 snap-start sm:w-[calc((100%-2rem)/3)] lg:w-[calc((100%-3rem)/4)]"
            }
          >
            <ProductCard product={product} />
          </div>
        ))}
      </div>
    </section>
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
