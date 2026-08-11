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
  const altText = banner.altText || banner.title || "";

  function goTo(delta: 1 | -1) {
    setIndex((i) => (i + delta + banners.length) % banners.length);
  }

  const slide = (
    // Height comes from `aspect-*`, not a viewport-height guess, and is locked to match the
    // recommended upload size (1:1 mobile crop, 3:1 desktop — see the banners admin page): with
    // the container's ratio equal to the image's own ratio, `object-cover` needs zero crop and
    // zero letterboxing at *any* window width, so nothing baked into the banner (headline text,
    // icons) is ever cut off or surrounded by dead space as the page is resized.
    <div className="relative aspect-square touch-pan-y overflow-hidden bg-ink-900 lg:aspect-[3/1]">
      <AnimatePresence mode="sync" initial={false}>
        <motion.div
          key={banner.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
          drag={banners.length > 1 ? "x" : false}
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.2}
          onDragEnd={(_, info) => {
            if (info.offset.x < -60) goTo(1);
            else if (info.offset.x > 60) goTo(-1);
          }}
          className="absolute inset-0 flex items-center justify-center text-center text-cream-50"
        >
          {/* The image itself renders at full opacity immediately — no fade-in — so the hero never
              looks hazy/washed-out on load. `scale` still eases from 1.06 to 1 as a slow, purely
              ambient Ken Burns drift; it's decoupled from opacity so it never delays the reveal. */}
          <motion.div
            initial={{ scale: 1.06 }}
            animate={{ scale: 1 }}
            transition={{ duration: 8, ease: "linear" }}
            className="absolute inset-0"
          >
            {banner.mobileImageUrl ? (
              <>
                <Image
                  src={banner.mobileImageUrl}
                  alt={altText}
                  fill
                  priority={index === 0}
                  sizes="100vw"
                  className="object-cover lg:hidden"
                />
                <Image
                  src={banner.imageUrl}
                  alt={altText}
                  fill
                  priority={index === 0}
                  sizes="100vw"
                  className="hidden object-cover lg:block"
                />
              </>
            ) : (
              <Image
                src={banner.imageUrl}
                alt={altText}
                fill
                priority={index === 0}
                sizes="100vw"
                className="object-cover"
              />
            )}
          </motion.div>
          {(banner.title || banner.subtitle) && (
            <div className="absolute inset-0 bg-gradient-to-b from-ink-950/35 via-transparent to-ink-950/55" />
          )}
          {(banner.title || banner.subtitle) && (
            <div className="relative z-10 px-4">
              {banner.subtitle && (
                <motion.p
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.05, duration: 0.35 }}
                  className="mb-4 text-xs uppercase tracking-[0.3em] text-brass-300"
                >
                  {banner.subtitle}
                </motion.p>
              )}
              {banner.title && (
                <motion.h2
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.12, duration: 0.4 }}
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
