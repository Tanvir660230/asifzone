"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { resolveImageUrl } from "@/lib/image-url";

interface BrandStoryProps {
  storeName: string;
  tagline?: string | null;
  eyebrow?: string | null;
  heading?: string | null;
  bodyText?: string | null;
  ctaLabel?: string | null;
  ctaHref?: string | null;
  imageUrl?: string | null;
}

export function BrandStory({ storeName, tagline, eyebrow, heading, bodyText, ctaLabel, ctaHref, imageUrl }: BrandStoryProps) {
  return (
    <section data-band="story" className="ui-band-inverse bg-ink-950 py-[calc(6rem*var(--section-rhythm))] text-center text-cream-50">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.7 }}
        className="mx-auto px-4"
      >
        {/* The image's width and height are theme tokens (a small vignette, or a large editorial photograph). */}
        {imageUrl && (
          <div className="relative mx-auto mb-8 h-56 w-full max-w-[var(--story-media-max-w)] overflow-hidden rounded-lg sm:h-[var(--story-media-h-sm)]">
            <Image src={resolveImageUrl(imageUrl)} alt={heading || storeName} fill sizes="(min-width: 1024px) 1024px, 100vw" className="object-cover" />
          </div>
        )}
        {/* The old max-w-xl column minus its padding, so the copy wraps exactly as before. */}
        <div className="mx-auto max-w-[34rem]">
          <p className="mb-4 text-xs ui-eyebrow text-[color:var(--band-accent,rgb(var(--color-brass-300)))]">{eyebrow || "Our Philosophy"}</p>
          <h2 className="font-display text-3xl leading-snug sm:text-4xl">{heading || tagline || storeName}</h2>
          {/* No invented copy: the story is the store's own words, or nothing. */}
          {bodyText && <p className="mt-6 text-sm leading-relaxed text-ink-300">{bodyText}</p>}
          <Link
            href={ctaHref || "/search"}
            className="mt-8 inline-block border border-cream-50 px-8 py-3 text-sm ui-caps transition-colors hover:bg-cream-50 hover:text-ink-900"
          >
            {ctaLabel || "Explore the collection"}
          </Link>
        </div>
      </motion.div>
    </section>
  );
}
