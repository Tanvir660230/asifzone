"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import type { Banner } from "@clothing-brand/shared";
import { cn } from "@/lib/utils";

const AUTO_ADVANCE_MS = 6000;

export function HeroCarousel({ banners }: { banners: Banner[] }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (banners.length <= 1) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % banners.length), AUTO_ADVANCE_MS);
    return () => clearInterval(timer);
  }, [banners.length]);

  const banner = banners[index];
  if (!banner) return null;

  function goTo(delta: 1 | -1) {
    setIndex((i) => (i + delta + banners.length) % banners.length);
  }

  const slide = (
    <div className="relative h-[70vh] min-h-[420px] touch-pan-y overflow-hidden bg-ink-900">
      <AnimatePresence mode="sync">
        <motion.div
          key={banner.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1 }}
          drag={banners.length > 1 ? "x" : false}
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.2}
          onDragEnd={(_, info) => {
            if (info.offset.x < -60) goTo(1);
            else if (info.offset.x > 60) goTo(-1);
          }}
          className="absolute inset-0 flex items-center justify-center text-center text-cream-50"
        >
          <motion.div
            initial={{ opacity: 0, scale: 1.06 }}
            animate={{ opacity: 0.7, scale: 1 }}
            transition={{ duration: 6, ease: "linear" }}
            className="absolute inset-0"
          >
            <Image
              src={banner.imageUrl}
              alt={banner.title ?? ""}
              fill
              priority={index === 0}
              sizes="100vw"
              className="object-cover"
            />
          </motion.div>
          <div className="absolute inset-0 bg-gradient-to-b from-ink-950/50 via-ink-900/20 to-ink-900/70" />
          {(banner.title || banner.subtitle) && (
            <div className="relative z-10 px-4">
              {banner.subtitle && (
                <motion.p
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2, duration: 0.6 }}
                  className="mb-4 text-xs uppercase tracking-[0.3em] text-brass-300"
                >
                  {banner.subtitle}
                </motion.p>
              )}
              {banner.title && (
                <motion.h2
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.35, duration: 0.7 }}
                  className="font-display text-4xl sm:text-5xl lg:text-6xl"
                >
                  {banner.title}
                </motion.h2>
              )}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );

  return (
    <section className="relative">
      {banner.linkUrl ? <Link href={banner.linkUrl}>{slide}</Link> : slide}

      {banners.length > 1 && (
        <div className="glass absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 gap-2 rounded-full px-3 py-2">
          {banners.map((b, i) => (
            <button
              key={b.id}
              onClick={() => setIndex(i)}
              aria-label={`Slide ${i + 1}`}
              className={cn(
                "h-1.5 rounded-full transition-all duration-300 ease-smooth",
                i === index ? "w-6 bg-brass-400" : "w-1.5 bg-cream-50/60 hover:bg-cream-50",
              )}
            />
          ))}
        </div>
      )}
    </section>
  );
}
