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
    <section className="mx-auto max-w-7xl px-4 py-[calc(4rem*var(--section-rhythm))] sm:px-6 lg:px-8">
      <h2 className="ui-section-heading mb-8 text-center font-display text-ink-900">{heading || "Shop by Category"}</h2>
      {/* `.ui-tile-grid`: up to 4 columns, fewer on narrower screens, and a small catalog stays centred. */}
      <motion.div
        variants={container}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-60px" }}
        className="ui-tile-grid"
      >
        {categories.map((cat) => (
          <motion.div key={cat.id} variants={item}>
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
              <div className="absolute inset-0 flex items-end bg-gradient-to-t from-[color:var(--tile-scrim)] to-transparent p-4">
                <span className="text-sm ui-caps text-[color:var(--tile-label)]">{cat.name}</span>
              </div>
            </Link>
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}
