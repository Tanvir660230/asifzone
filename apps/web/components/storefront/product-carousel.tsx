"use client";

import { motion } from "framer-motion";
import type { Product } from "@clothing-brand/shared";
import { ProductCard } from "./product-card";

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};

const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4 } },
};

interface ProductCarouselProps {
  title: string;
  eyebrow?: string;
  products: Product[];
}

export function ProductCarousel({ title, eyebrow, products }: ProductCarouselProps) {
  if (products.length === 0) return null;

  return (
    <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      {eyebrow && <p className="mb-2 text-xs uppercase tracking-[0.3em] text-brass-300">{eyebrow}</p>}
      <h2 className="mb-6 font-display text-xl text-ink-900 sm:text-2xl">{title}</h2>
      <motion.div
        variants={container}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-60px" }}
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2"
      >
        {products.map((product) => (
          <motion.div
            key={product.id}
            variants={item}
            className="w-[45vw] shrink-0 snap-start sm:w-56"
          >
            <ProductCard product={product} />
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}
