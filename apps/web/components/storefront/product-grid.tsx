"use client";

import type { ReactNode } from "react";
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

interface ProductGridProps {
  products: Product[];
  /** Overrides the plain default empty-state text — e.g. a category page's premium "Coming Soon" panel. */
  emptyState?: ReactNode;
}

export function ProductGrid({ products, emptyState }: ProductGridProps) {
  if (products.length === 0) {
    return emptyState ?? <p className="py-16 text-center text-ink-400">No products found.</p>;
  }

  return (
    <motion.div
      variants={container}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-60px" }}
      className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4"
    >
      {products.map((product) => (
        <motion.div key={product.id} variants={item}>
          <ProductCard product={product} />
        </motion.div>
      ))}
    </motion.div>
  );
}
