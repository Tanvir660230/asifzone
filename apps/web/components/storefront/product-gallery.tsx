"use client";

import { useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, X, ZoomIn } from "lucide-react";
import type { ProductImage } from "@clothing-brand/shared";
import { env } from "@/lib/env";
import { cn } from "@/lib/utils";

export function ProductGallery({ images, productName }: { images: ProductImage[]; productName: string }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [zoomOrigin, setZoomOrigin] = useState("50% 50%");
  const active = images[activeIndex];

  function handleMouseMove(e: MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setZoomOrigin(`${x}% ${y}%`);
  }

  function step(delta: number) {
    setActiveIndex((i) => (i + delta + images.length) % images.length);
  }

  return (
    <div>
      <div
        className="group relative aspect-square cursor-zoom-in overflow-hidden rounded-xl bg-ink-100"
        onMouseMove={handleMouseMove}
        onClick={() => active && setLightboxOpen(true)}
      >
        {active ? (
          <>
            <Image
              src={`${env.apiUrl}${active.url}`}
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
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-ink-300">No image</div>
        )}
      </div>

      {images.length > 1 && (
        <div className="mt-3 grid grid-cols-5 gap-2">
          {images.map((img, i) => (
            <button
              key={img.id}
              onClick={() => setActiveIndex(i)}
              className={cn(
                "relative aspect-square overflow-hidden rounded border",
                i === activeIndex ? "border-brass-400" : "border-transparent",
              )}
            >
              <Image src={`${env.apiUrl}${img.url}`} alt="" fill sizes="10vw" className="object-cover" />
            </button>
          ))}
        </div>
      )}

      {lightboxOpen &&
        active &&
        createPortal(
          <AnimatePresence>
            <motion.div
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

              {images.length > 1 && (
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
                  src={`${env.apiUrl}${active.url}`}
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
