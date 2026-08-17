"use client";

import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, X, ZoomIn } from "lucide-react";
import type { ProductImage } from "@clothing-brand/shared";
import { resolveImageUrl } from "@/lib/image-url";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { cn } from "@/lib/utils";

interface ProductGalleryProps {
  images: ProductImage[];
  productName: string;
  /** When set (e.g. the selected variant's assigned image), the gallery jumps to that image —
   * used to sync the photo with a color/variant selection elsewhere on the page. */
  focusImageId?: string | null;
}

const SWIPE_THRESHOLD = 50;

export function ProductGallery({ images, productName, focusImageId }: ProductGalleryProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [zoomOrigin, setZoomOrigin] = useState("50% 50%");
  const pointerStartX = useRef<number | null>(null);
  const didSwipe = useRef(false);
  const active = images[activeIndex];
  const hasMultiple = images.length > 1;
  // The only overlay in the storefront that previously had no role="dialog", no Escape handling,
  // and no focus management at all — every other modal/drawer in the app has this.
  const lightboxRef = useFocusTrap<HTMLDivElement>({
    active: lightboxOpen,
    onEscape: () => setLightboxOpen(false),
  });

  useEffect(() => {
    if (!focusImageId) return;
    const index = images.findIndex((img) => img.id === focusImageId);
    if (index !== -1) setActiveIndex(index);
  }, [focusImageId, images]);

  function handleMouseMove(e: MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setZoomOrigin(`${x}% ${y}%`);
  }

  function step(delta: number) {
    setActiveIndex((i) => (i + delta + images.length) % images.length);
  }

  // Swipe-to-navigate on the main image (mouse drag or touch) — distinct from the plain click
  // that opens the lightbox, so dragging across the image doesn't also pop it open.
  function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
    pointerStartX.current = e.clientX;
    didSwipe.current = false;
  }

  function handlePointerUp(e: PointerEvent<HTMLDivElement>) {
    if (pointerStartX.current === null) return;
    const delta = e.clientX - pointerStartX.current;
    pointerStartX.current = null;
    if (hasMultiple && Math.abs(delta) > SWIPE_THRESHOLD) {
      didSwipe.current = true;
      step(delta > 0 ? -1 : 1);
    }
  }

  function handleImageClick() {
    if (didSwipe.current) {
      didSwipe.current = false;
      return;
    }
    if (active) setLightboxOpen(true);
  }

  return (
    <div className="flex flex-col-reverse gap-3 lg:flex-row">
      {/* Thumbnails: a fixed small size regardless of how many photos exist (never stretched to
          fill the row) — a horizontal strip below the main image on mobile, a vertical rail
          beside it on desktop, scrollable once there are more than fit. */}
      {hasMultiple && (
        <div className="flex gap-2 overflow-x-auto pb-1 lg:max-h-[34rem] lg:w-20 lg:shrink-0 lg:flex-col lg:overflow-x-visible lg:overflow-y-auto lg:pb-0">
          {images.map((img, i) => (
            <button
              key={img.id}
              onClick={() => setActiveIndex(i)}
              aria-label={`View image ${i + 1} of ${productName}`}
              aria-current={i === activeIndex}
              className={cn(
                "relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 transition-colors duration-150 ease-smooth lg:h-20 lg:w-20",
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
        className="group relative aspect-square max-h-[70vh] flex-1 cursor-zoom-in touch-pan-y select-none overflow-hidden rounded-xl bg-ink-100"
        onMouseMove={handleMouseMove}
        onClick={handleImageClick}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
      >
        {active ? (
          <>
            <Image
              src={resolveImageUrl(active.url)}
              alt={active.altText ?? productName}
              fill
              sizes="(min-width: 1024px) 50vw, 100vw"
              className="object-cover transition-transform duration-300 ease-out group-hover:scale-150"
              style={{ transformOrigin: zoomOrigin }}
              priority
            />
            <span className="glass glossy absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full text-ink-900 opacity-0 shadow-float transition-opacity duration-200 ease-smooth group-hover:opacity-100">
              <ZoomIn size={16} />
            </span>
            {hasMultiple && (
              <span className="glass absolute bottom-3 left-3 rounded-full px-2.5 py-1 text-xs text-ink-900">
                {activeIndex + 1} / {images.length}
              </span>
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
              className="glass glossy absolute left-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-ink-900 opacity-100 shadow-float transition-opacity duration-200 ease-smooth lg:opacity-0 lg:group-hover:opacity-100"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                step(1);
              }}
              aria-label="Next image"
              className="glass glossy absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-ink-900 opacity-100 shadow-float transition-opacity duration-200 ease-smooth lg:opacity-0 lg:group-hover:opacity-100"
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
