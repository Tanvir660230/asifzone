"use client";

import Link from "next/link";
import { motion } from "framer-motion";

const FALLBACK_TAGLINE = "Considered clothing, made to last";

export function Hero({ tagline }: { tagline?: string | null }) {
  return (
    <section className="relative flex h-[70vh] min-h-[420px] items-center justify-center overflow-hidden bg-gradient-to-b from-ink-800 via-ink-900 to-ink-950 text-center text-cream-50">
      <div className="absolute inset-0 bg-gradient-to-b from-ink-950/50 via-transparent to-ink-950/40" />
      <div className="relative z-10 px-4">
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mb-4 text-xs uppercase tracking-[0.3em] text-brass-300"
        >
          New Season
        </motion.p>
        <motion.h2
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.7 }}
          className="font-display text-4xl sm:text-5xl lg:text-6xl"
        >
          {tagline ?? FALLBACK_TAGLINE}
        </motion.h2>
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.6 }}
        >
          <Link
            href="/search"
            className="mt-8 inline-block rounded-full border border-cream-50 px-8 py-3 text-sm uppercase tracking-wide transition-all duration-300 ease-smooth hover:scale-105 hover:bg-cream-50 hover:text-ink-900"
          >
            Shop the collection
          </Link>
        </motion.div>
      </div>
    </section>
  );
}
