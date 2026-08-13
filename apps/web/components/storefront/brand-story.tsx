"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";

const FALLBACK_TAGLINE = "Considered clothing, made to last";

interface BrandStoryProps {
  storeName: string;
  tagline?: string | null;
  heading?: string | null;
  bodyText?: string | null;
  ctaLabel?: string | null;
  ctaHref?: string | null;
  imageUrl?: string | null;
}

export function BrandStory({ storeName, tagline, heading, bodyText, ctaLabel, ctaHref, imageUrl }: BrandStoryProps) {
  return (
    <section className="bg-ink-950 py-24 text-center text-cream-50">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.7 }}
        className="mx-auto max-w-xl px-4"
      >
        {imageUrl && (
          <div className="relative mx-auto mb-8 h-56 w-full max-w-md overflow-hidden rounded-lg sm:h-72">
            <Image src={imageUrl} alt={heading || storeName} fill sizes="(min-width: 640px) 448px, 100vw" className="object-cover" />
          </div>
        )}
        <p className="mb-4 text-xs uppercase tracking-[0.3em] text-brass-300">Our Philosophy</p>
        <h2 className="font-display text-3xl leading-snug sm:text-4xl">{heading || tagline || FALLBACK_TAGLINE}</h2>
        <p className="mt-6 text-sm leading-relaxed text-ink-300">
          {bodyText ||
            `Every ${storeName} piece is chosen for fabric, fit, and finish first — fewer, better garments built to outlast a season.`}
        </p>
        <Link
          href={ctaHref || "/search"}
          className="mt-8 inline-block border border-cream-50 px-8 py-3 text-sm uppercase tracking-wide transition-colors hover:bg-cream-50 hover:text-ink-900"
        >
          {ctaLabel || "Explore the collection"}
        </Link>
      </motion.div>
    </section>
  );
}
