"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { siteConfig } from "@/lib/site-config";

export function Hero() {
  return (
    <section className="relative flex h-[70vh] min-h-[420px] items-center justify-center overflow-hidden bg-ink-900 text-center text-cream-50">
      <div className="absolute inset-0 bg-gradient-to-b from-ink-950/60 via-ink-900/30 to-ink-900" />
      <div className="relative z-10 px-4">
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mb-4 text-xs uppercase tracking-[0.3em] text-brass-300"
        >
          New Season
        </motion.p>
        <motion.h1
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.7 }}
          className="font-display text-4xl sm:text-5xl lg:text-6xl"
        >
          {siteConfig.tagline}
        </motion.h1>
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.6 }}
        >
          <Link
            href="/search"
            className="mt-8 inline-block border border-cream-50 px-8 py-3 text-sm uppercase tracking-wide transition-colors hover:bg-cream-50 hover:text-ink-900"
          >
            Shop the collection
          </Link>
        </motion.div>
      </div>
    </section>
  );
}
