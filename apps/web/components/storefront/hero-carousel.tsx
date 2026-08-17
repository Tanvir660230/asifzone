"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Pause, Play } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import type { Banner } from "@clothing-brand/shared";
import { cn } from "@/lib/utils";

const AUTO_ADVANCE_MS = 6000;

export function HeroCarousel({ banners }: { banners: Banner[] }) {
  const [index, setIndex] = useState(0);
  // Auto-advance is a WCAG 2.2.2 (pause/stop/hide) concern — it has to be genuinely stoppable, not
  // just paused by accident on hover. Kept as three separate signals rather than one shared
  // boolean: hover/focus are transient (mouse leaving the carousel shouldn't silently cancel an
  // explicit pause), so they're combined with, not overwritten by, the manual toggle.
  const [manuallyPaused, setManuallyPaused] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [hovering, setHovering] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = manuallyPaused || hovering || focused;

  useEffect(() => {
    if (banners.length <= 1 || paused) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % banners.length), AUTO_ADVANCE_MS);
    return () => clearInterval(timer);
  }, [banners.length, paused]);

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
    <section
      className="relative"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      {banner.linkUrl ? <Link href={banner.linkUrl}>{slide}</Link> : slide}

      {banners.length > 1 && (
        <div className="glass absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full px-3 py-2">
          {banners.map((b, i) => (
            <button
              key={b.id}
              onClick={() => setIndex(i)}
              aria-label={`Slide ${i + 1}`}
              aria-current={i === index}
              className={cn(
                "h-1.5 rounded-full transition-all duration-300 ease-smooth",
                i === index ? "w-6 bg-brass-400" : "w-1.5 bg-cream-50/60 hover:bg-cream-50",
              )}
            />
          ))}
          <button
            onClick={() => setManuallyPaused((v) => !v)}
            aria-label={paused ? "Play slideshow" : "Pause slideshow"}
            className="ml-1 flex h-4 w-4 shrink-0 items-center justify-center text-cream-50/80 transition-colors duration-150 ease-smooth hover:text-cream-50"
          >
            {paused ? <Play size={12} /> : <Pause size={12} />}
          </button>
        </div>
      )}
    </section>
  );
}
