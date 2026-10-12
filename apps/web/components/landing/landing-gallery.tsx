"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { ProductImage } from "@clothing-brand/shared";
import { resolveImageUrl } from "@/lib/image-url";
import { cn } from "@/lib/utils";

/**
 * The landing page's photos. Phones: an edge-to-edge swipe strip (native scroll-snap, no library) with dots, so the
 * first thing an ad visitor sees is the product, full width. From 1024px: one large photo with thumbnails beside it.
 */
export function LandingGallery({ images, productName }: { images: ProductImage[]; productName: string }) {
  const [active, setActive] = useState(0);
  const track = useRef<HTMLDivElement>(null);

  // The dot follows whichever slide is mostly in view.
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const slides = Array.from(el.children) as HTMLElement[];
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) setActive(slides.indexOf(entry.target as HTMLElement));
      },
      { root: el, threshold: 0.6 },
    );
    slides.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, [images.length]);

  function goTo(i: number) {
    setActive(i);
    const el = track.current;
    if (el && el.clientWidth) el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  }

  if (images.length === 0) {
    return <div className="aspect-[4/5] w-full bg-surface-muted lg:rounded-xl" aria-hidden="true" />;
  }

  return (
    <div className="lg:grid lg:grid-cols-[4.5rem_minmax(0,1fr)] lg:gap-4">
      {images.length > 1 && (
        <div className="hidden lg:flex lg:flex-col lg:gap-3" role="tablist" aria-label="ছবি">
          {images.map((img, i) => (
            <button
              key={img.id}
              type="button"
              role="tab"
              aria-selected={i === active}
              aria-label={`ছবি ${i + 1}`}
              onClick={() => goTo(i)}
              className={cn(
                "relative aspect-[4/5] w-full overflow-hidden rounded-lg bg-surface-muted ring-offset-2 ring-offset-canvas transition-shadow duration-base",
                i === active ? "ring-2 ring-ink-900" : "opacity-70 hover:opacity-100",
              )}
            >
              <Image src={resolveImageUrl(img.url)} alt="" fill sizes="72px" className="object-cover" />
            </button>
          ))}
        </div>
      )}

      <div className="relative">
        <div
          ref={track}
          className="flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] lg:overflow-hidden lg:rounded-xl [&::-webkit-scrollbar]:hidden"
          aria-roledescription="carousel"
          aria-label={productName}
        >
          {images.map((img, i) => (
            <div key={img.id} className="relative aspect-[4/5] w-full shrink-0 snap-center bg-surface-muted" aria-roledescription="slide" aria-label={`${i + 1} / ${images.length}`}>
              <Image
                src={resolveImageUrl(img.url)}
                alt={img.altText ?? productName}
                fill
                priority={i === 0}
                sizes="(min-width: 1024px) 50vw, 100vw"
                className="object-cover"
              />
            </div>
          ))}
        </div>

        {images.length > 1 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center gap-1.5 lg:hidden">
            {images.map((img, i) => (
              <span
                key={img.id}
                aria-hidden="true"
                className={cn("h-1.5 rounded-full bg-white shadow-sm transition-all duration-base", i === active ? "w-5 opacity-100" : "w-1.5 opacity-60")}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
