"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import type { CategoryTreeNode } from "@/lib/api/storefront";
import { resolveImageUrl } from "@/lib/image-url";

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
};

const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4 } },
};

export function CategoryGrid({
  categories,
  heading = "Shop by Category",
}: {
  categories: CategoryTreeNode[];
  heading?: string | null;
}) {
  if (categories.length === 0) return null;

  return (
    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      <h2 className="mb-8 text-center font-display text-2xl text-ink-900">{heading || "Shop by Category"}</h2>
      {/* flex-wrap + fixed-fraction card widths instead of a CSS grid — a grid with only a
          handful of categories leaves the unused columns as dead empty space pinned to one side;
          flex-wrap collapses and centers the same row instead, so a small catalog still reads as
          a deliberate, finished layout rather than an unfinished one. */}
      <motion.div
        variants={container}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-60px" }}
        className="flex flex-wrap justify-center gap-4"
      >
        {categories.map((cat) => (
          <motion.div key={cat.id} variants={item} className="w-[calc(50%-8px)] sm:w-[calc(33.333%-11px)] lg:w-[calc(25%-12px)]">
            <Link href={`/category/${cat.slug}`} className="group relative block aspect-[4/5] overflow-hidden rounded bg-ink-100">
              {cat.imageUrl ? (
                <Image
                  src={resolveImageUrl(cat.imageUrl)}
                  alt={cat.imageAltText || cat.name}
                  fill
                  sizes="(min-width: 1024px) 25vw, 50vw"
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                />
              ) : (
                // No category photo uploaded yet — a flat ink tile reads as a deliberate
                // placeholder rather than a broken image. Name isn't repeated here since the
                // bottom label already shows it.
                <div className="h-full bg-ink-950 transition-transform duration-500 group-hover:scale-105" />
              )}
              <div className="absolute inset-0 flex items-end bg-gradient-to-t from-ink-950/60 to-transparent p-4">
                <span className="text-sm uppercase tracking-wide text-cream-50">{cat.name}</span>
              </div>
            </Link>
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}
