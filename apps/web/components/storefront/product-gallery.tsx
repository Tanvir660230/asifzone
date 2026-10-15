"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, X, ZoomIn } from "lucide-react";
import type { ProductImage } from "@clothing-brand/shared";
import { resolveImageUrl } from "@/lib/image-url";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { cn } from "@/lib/utils";
import { storeLayout } from "@/lib/theme-layout";

interface ProductGalleryProps {
  images: ProductImage[];
  productName: string;
}

export function ProductGallery({ images, productName }: ProductGalleryProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [zoomOrigin, setZoomOrigin] = useState("50% 50%");
  // Every photo sits side by side in one scroll-snapping track: on a phone it follows the finger and settles on a photo
  // the way the Photos app does; the arrows and thumbnails scroll the same track.
  const trackRef = useRef<HTMLDivElement>(null);
  const active = images[activeIndex];
  const hasMultiple = images.length > 1;
  // The mihrab preset keeps the thumbnails in a row under a 4:5 photograph at every width; classic moves them beside it.
  const thumbsBelow = storeLayout() === "mihrab";
  // The only overlay in the storefront that previously had no role="dialog", no Escape handling,
  // and no focus management at all — every other modal/drawer in the app has this.
  const lightboxRef = useFocusTrap<HTMLDivElement>({
    active: lightboxOpen,
    onEscape: () => setLightboxOpen(false),
  });

  // The parent hands us the images for the current colour/size; when that set changes, start from its first image.
  const imageKey = images.map((img) => img.id).join(",");
  useEffect(() => {
    setActiveIndex(0);
    trackRef.current?.scrollTo({ left: 0 });
  }, [imageKey]);

  function handleMouseMove(e: MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setZoomOrigin(`${x}% ${y}%`);
  }

  function goTo(index: number) {
    setActiveIndex(index);
    const track = trackRef.current;
    if (!track) return;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    track.scrollTo({ left: index * track.clientWidth, behavior: smooth ? "smooth" : "auto" });
  }

  function step(delta: number) {
    goTo((activeIndex + delta + images.length) % images.length);
  }

  // The photo the track has settled on (a swipe, or the arrows' smooth scroll) is the active one.
  function handleScroll() {
    const track = trackRef.current;
    if (!track || !track.clientWidth) return;
    const index = Math.round(track.scrollLeft / track.clientWidth);
    if (index !== activeIndex && index >= 0 && index < images.length) setActiveIndex(index);
  }

  return (
    <div className={cn("flex flex-col-reverse gap-3", !thumbsBelow && "lg:flex-row")}>
      {/* Thumbnails: a fixed small size regardless of how many photos exist (never stretched to
          fill the row) — a horizontal strip below the main image on mobile, a vertical rail
          beside it on desktop, scrollable once there are more than fit. */}
      {hasMultiple && (
        <div
          className={cn(
            "flex gap-2 overflow-x-auto pb-1",
            // Classic: below 1024px the photo is swiped and dots inside it say where you are — a thumbnail strip there
            // only pushed the price and sizes down by another row.
            !thumbsBelow && "max-lg:hidden lg:max-h-[34rem] lg:w-20 lg:shrink-0 lg:flex-col lg:overflow-x-visible lg:overflow-y-auto lg:pb-0",
          )}
        >
          {images.map((img, i) => (
            <button
              key={img.id}
              onClick={() => goTo(i)}
              aria-label={`View image ${i + 1} of ${productName}`}
              aria-current={i === activeIndex}
              className={cn(
                "relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 transition-colors duration-150 ease-smooth lg:h-20 lg:w-20",
                thumbsBelow && "aspect-[4/5] h-auto w-14 lg:h-auto lg:w-16",
                i === activeIndex ? "border-brass-400" : "border-transparent hover:border-ink-200",
              )}
            >
              <Image src={resolveImageUrl(img.url)} alt="" fill sizes="80px" className="object-cover" />
            </button>
          ))}
        </div>
      )}

      <div
        // Capped to a share of the viewport height in addition to the usual aspect-square sizing
        // — width-driven aspect-square alone let this grow taller than the screen on shorter
        // desktop windows (laptop, browser zoom), pushing price/Add to Cart off-screen with no
        // hint anything was below. The cap only ever engages when that would happen; a normal
        // window never hits it.
        className={cn(
          "group relative flex-1 cursor-zoom-in select-none overflow-hidden rounded-xl bg-ink-100",
          thumbsBelow ? "aspect-[4/5] max-h-[80vh]" : "aspect-square max-h-[70vh]",
        )}
        onMouseMove={handleMouseMove}
        onClick={() => active && setLightboxOpen(true)}
      >
        {active ? (
          <>
            {/* Swipeable on touch; from 1024px it only moves by the arrows and thumbnails (overflow hidden still scrolls
                from script), so a mouse over it zooms instead. */}
            <div ref={trackRef} onScroll={handleScroll} className="ui-rail flex h-full w-full snap-x snap-mandatory overflow-x-auto lg:overflow-hidden">
              {images.map((img, i) => (
                <div key={img.id} className="relative h-full w-full shrink-0 snap-center snap-always overflow-hidden">
                  <Image
                    src={resolveImageUrl(img.url)}
                    alt={img.altText ?? productName}
                    fill
                    sizes="(min-width: 1024px) 50vw, 100vw"
                    className="object-cover transition-transform duration-300 ease-out lg:group-hover:scale-150"
                    style={i === activeIndex ? { transformOrigin: zoomOrigin } : undefined}
                    priority={i === 0}
                  />
                </div>
              ))}
            </div>
            {/* The keyboard/screen-reader way in: a real button for the zoomed view (its click bubbles to the frame's
                handler). Not over the photos on a phone, where it would swallow the swipe. */}
            <button
              type="button"
              aria-label={`Open zoomed view of ${productName}`}
              className="absolute inset-0 rounded-xl focus-visible:outline-offset-[-3px] max-lg:pointer-events-none"
            />
            {active.caption && (
              <span className="glass absolute left-3 top-3 max-w-[70%] truncate rounded-[var(--chip-radius)] px-3 py-1 text-xs text-ink-900" data-testid="image-caption">
                {active.caption}
              </span>
            )}
            <span className="glass glossy absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-[var(--fab-radius)] text-ink-900 opacity-0 shadow-float transition-opacity duration-200 ease-smooth group-hover:opacity-100">
              <ZoomIn size={16} />
            </span>
            {hasMultiple && (
              <span
                className={cn(
                  "glass absolute bottom-3 left-3 rounded-[var(--chip-radius)] px-2.5 py-1 text-xs text-ink-900",
                  !thumbsBelow && "max-lg:hidden",
                )}
              >
                {activeIndex + 1} / {images.length}
              </span>
            )}
            {hasMultiple && !thumbsBelow && (
              // Where the thumbnails were on a phone: one dot per photo, the current one long. A tap on a dot jumps there.
              <div
                className="glass absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full px-3 py-2 lg:hidden"
                data-testid="gallery-dots"
              >
                {images.map((img, i) => (
                  <button
                    key={img.id}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      goTo(i);
                    }}
                    aria-label={`View image ${i + 1} of ${images.length}`}
                    aria-current={i === activeIndex}
                    className={cn(
                      "relative h-1.5 rounded-full transition-[width,background-color] duration-200 ease-smooth after:absolute after:-inset-2.5",
                      i === activeIndex ? "w-4 bg-ink-900" : "w-1.5 bg-ink-900/30",
                    )}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-ink-300">No image</div>
        )}

        {hasMultiple && (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation();
                step(-1);
              }}
              aria-label="Previous image"
              className="glass glossy absolute left-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-[var(--fab-radius)] text-ink-900 opacity-100 shadow-float transition-opacity duration-200 ease-smooth lg:opacity-0 lg:group-hover:opacity-100 [@media(hover:none)]:hidden"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                step(1);
              }}
              aria-label="Next image"
              className="glass glossy absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-[var(--fab-radius)] text-ink-900 opacity-100 shadow-float transition-opacity duration-200 ease-smooth lg:opacity-0 lg:group-hover:opacity-100 [@media(hover:none)]:hidden"
            >
              <ChevronRight size={18} />
            </button>
          </>
        )}
      </div>

      {lightboxOpen &&
        active &&
        createPortal(
          <AnimatePresence>
            <motion.div
              ref={lightboxRef}
              role="dialog"
              aria-modal="true"
              aria-label={`${productName} — image ${activeIndex + 1} of ${images.length}`}
              tabIndex={-1}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex items-center justify-center bg-ink-950/95"
              onClick={() => setLightboxOpen(false)}
            >
              <button
                onClick={() => setLightboxOpen(false)}
                aria-label="Close"
                className="absolute right-6 top-6 text-cream-50 hover:text-brass-300"
              >
                <X size={28} />
              </button>

              {hasMultiple && (
                <>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      step(-1);
                    }}
                    aria-label="Previous image"
                    className="absolute left-4 text-cream-50 hover:text-brass-300 sm:left-8"
                  >
                    <ChevronLeft size={32} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      step(1);
                    }}
                    aria-label="Next image"
                    className="absolute right-4 text-cream-50 hover:text-brass-300 sm:right-8"
                  >
                    <ChevronRight size={32} />
                  </button>
                </>
              )}

              <motion.div
                key={active.id}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.25 }}
                className="relative h-[80vh] w-[90vw] max-w-3xl"
                onClick={(e) => e.stopPropagation()}
              >
                <Image
                  src={resolveImageUrl(active.url)}
                  alt={active.altText ?? productName}
                  fill
                  sizes="90vw"
                  className="object-contain"
                />
              </motion.div>
            </motion.div>
          </AnimatePresence>,
          document.body,
        )}
    </div>
  );
}
