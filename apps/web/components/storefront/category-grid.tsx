"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import type { CategoryTreeNode } from "@/lib/api/storefront";
import { env } from "@/lib/env";

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
};

const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4 } },
};

export function CategoryGrid({ categories }: { categories: CategoryTreeNode[] }) {
  if (categories.length === 0) return null;

  return (
    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      <h2 className="mb-8 text-center font-display text-2xl text-ink-900">Shop by Category</h2>
      <motion.div
        variants={container}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-60px" }}
        className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
      >
        {categories.map((cat) => (
          <motion.div key={cat.id} variants={item}>
            <Link href={`/category/${cat.slug}`} className="group relative block aspect-[4/5] overflow-hidden rounded bg-ink-100">
              {cat.imageUrl ? (
                <Image
                  src={cat.imageUrl.startsWith("http") ? cat.imageUrl : `${env.apiUrl}${cat.imageUrl}`}
                  alt={cat.name}
                  fill
                  sizes="(min-width: 1024px) 25vw, 50vw"
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                />
              ) : (
                <div className="flex h-full items-center justify-center bg-ink-200 text-ink-400">{cat.name}</div>
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
