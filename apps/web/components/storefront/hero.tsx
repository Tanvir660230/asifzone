"use client";

import type { CSSProperties } from "react";
import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import type { SectionAppearance } from "@clothing-brand/shared";
import { resolveImageUrl } from "@/lib/image-url";
import { bandTone } from "@/lib/band-tone";

/** The two hero compositions a store can force per section (Style → Photo position), each the full set of hero tokens
 * that make it work — the same values the base design (stacked) and the editorial theme (split) declare in ui-tokens —
 * so forcing one never mixes its layout with the other's proportions. */
const HERO_COMPOSITION: Record<"stacked" | "split", CSSProperties> = {
  stacked: {
    "--hero-align": "center",
    "--hero-layout-lg": "block",
    "--hero-media-aspect-lg": "21 / 9",
    "--hero-content-max-w-lg": "none",
    "--hero-copy-pad-lg": "1rem",
    "--hero-media-offset-lg": "3.5rem",
  } as CSSProperties,
  split: {
    "--hero-align": "left",
    "--hero-layout-lg": "grid",
    "--hero-media-aspect-lg": "4 / 5",
    "--hero-content-max-w-lg": "80rem",
    "--hero-copy-pad-lg": "2rem",
    "--hero-media-offset-lg": "0",
  } as CSSProperties,
};

/** Shown only when the hero section has no button label of its own — store- and category-neutral on purpose. */
const FALLBACK_CTA_LABEL = "Explore the collection";

interface HeroProps {
  /** The store's name: the headline of last resort, so the hero never invents a message for the store. */
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
  /** The store's own choice for this section (Storefront Studio → Style); absent = the theme decides. */
  tone?: SectionAppearance["tone"];
  layout?: SectionAppearance["layout"];
}

/** The homepage hero when no hero banners are active. Its message is entirely the store's (Admin → Homepage → Hero, then
 * the tagline, then the store name); the theme decides how it looks — alignment, stacked or side-by-side composition,
 * and (as `data-band="hero"` of `ui-band-inverse`) whether it is a dark or a light section — unless the store chose a
 * tone or layout for it. */
export function Hero({
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
  tone,
  layout,
}: HeroProps) {
  const copy = (
    <div className="ui-hero-copy relative z-10 px-4">
      {subtext && (
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="mb-4 text-xs ui-eyebrow text-[color:var(--band-accent,rgb(var(--color-brass-300)))]"
        >
          {subtext}
        </motion.p>
      )}
      <motion.h2
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08, duration: 0.4 }}
        className="font-display text-4xl sm:text-5xl lg:text-6xl"
      >
        {headline || tagline || storeName}
      </motion.h2>
      {bodyText && (
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12, duration: 0.4 }}
          className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-ink-300 sm:text-lg"
        >
          {bodyText}
        </motion.p>
      )}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.16, duration: 0.35 }}
      >
        <Link
          href={ctaHref || "/search"}
          className="mr-[var(--hero-primary-mr)] mt-8 inline-block rounded-[var(--control-radius)] border border-cream-50 bg-[color:var(--hero-cta-fill)] px-8 py-3 text-sm ui-caps text-[color:var(--hero-cta-text)] transition-[transform,background-color,color] duration-300 ease-smooth hover:scale-105 hover:bg-cream-50 hover:text-ink-900"
        >
          {ctaLabel || FALLBACK_CTA_LABEL}
        </Link>
        {secondaryCtaLabel && secondaryCtaHref && (
          <Link
            href={secondaryCtaHref}
            className="ui-hero-secondary group ml-[var(--hero-secondary-ml)] mt-8 inline-flex items-center gap-1 px-4 py-3 text-sm ui-caps underline-offset-4 hover:underline"
          >
            {secondaryCtaLabel}
            <span aria-hidden="true" className="transition-transform duration-200 ease-smooth group-hover:translate-x-0.5">
              →
            </span>
          </Link>
        )}
      </motion.div>
    </div>
  );

  if (!imageUrl) {
    return (
      <section
        data-band="hero"
        data-tone={bandTone(tone)}
        className="ui-band-inverse ui-hero relative flex h-[70vh] min-h-[420px] items-center justify-center overflow-hidden bg-ink-950 text-cream-50"
      >
        {copy}
      </section>
    );
  }

  // With an image the copy leads and the image follows — stacked at full width, or beside it from 1024px when the theme
  // (or the store, `layout`) asks for it — an editorial composition rather than text laid over a photo, so the headline
  // never depends on the picture's contrast.
  const layoutStyle = layout === "stacked" || layout === "split" ? HERO_COMPOSITION[layout] : undefined;
  return (
    <section
      data-band="hero"
      data-tone={bandTone(tone)}
      style={layoutStyle}
      className="ui-band-inverse ui-hero overflow-hidden bg-ink-950 pt-16 text-cream-50 sm:pt-20 lg:pt-24"
    >
      <div className="ui-hero-layout">
        {copy}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.6 }}
          className="ui-hero-media mx-auto mt-12 max-w-7xl px-4 pb-4 sm:mt-14 sm:px-6 sm:pb-6 lg:px-8 lg:pb-8"
        >
          <div className="ui-hero-media-frame relative overflow-hidden rounded-2xl bg-ink-900">
            <Image
              src={resolveImageUrl(imageUrl)}
              alt={imageAltText || headline || storeName}
              fill
              priority
              sizes="(min-width: 1280px) 1216px, 100vw"
              className="object-cover"
            />
          </div>
        </motion.div>
      </div>
    </section>
  );
}
