"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { siteConfig } from "@/lib/site-config";

export function BrandStory() {
  return (
    <section className="bg-ink-900 py-24 text-center text-cream-50">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.7 }}
        className="mx-auto max-w-xl px-4"
      >
        <p className="mb-4 text-xs uppercase tracking-[0.3em] text-brass-300">Our Philosophy</p>
        <h2 className="font-display text-3xl leading-snug sm:text-4xl">{siteConfig.tagline}</h2>
        <p className="mt-6 text-sm leading-relaxed text-ink-300">
          Every {siteConfig.name} piece is chosen for fabric, fit, and finish first — fewer, better garments built
          to outlast a season.
        </p>
        <Link
          href="/search"
          className="mt-8 inline-block border border-cream-50 px-8 py-3 text-sm uppercase tracking-wide transition-colors hover:bg-cream-50 hover:text-ink-900"
        >
          Explore the collection
        </Link>
      </motion.div>
    </section>
  );
}
