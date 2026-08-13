"use client";

import Link from "next/link";
import { motion } from "framer-motion";

const FALLBACK_TAGLINE = "Considered clothing, made to last";

interface HeroProps {
  tagline?: string | null;
  headline?: string | null;
  subtext?: string | null;
  ctaLabel?: string | null;
  ctaHref?: string | null;
}

export function Hero({ tagline, headline, subtext, ctaLabel, ctaHref }: HeroProps) {
  return (
    <section className="relative flex h-[70vh] min-h-[420px] items-center justify-center overflow-hidden bg-ink-950 text-center text-cream-50">
      <div className="relative z-10 px-4">
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="mb-4 text-xs uppercase tracking-[0.3em] text-brass-300"
        >
          {subtext || "New Season"}
        </motion.p>
        <motion.h2
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08, duration: 0.4 }}
          className="font-display text-4xl sm:text-5xl lg:text-6xl"
        >
          {headline || tagline || FALLBACK_TAGLINE}
        </motion.h2>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.16, duration: 0.35 }}
        >
          <Link
            href={ctaHref || "/search"}
            className="mt-8 inline-block rounded-full border border-cream-50 px-8 py-3 text-sm uppercase tracking-wide transition-all duration-300 ease-smooth hover:scale-105 hover:bg-cream-50 hover:text-ink-900"
          >
            {ctaLabel || "Shop the collection"}
          </Link>
        </motion.div>
      </div>
    </section>
  );
}
