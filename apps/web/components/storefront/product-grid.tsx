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
  /** Set when this grid is the page's opening content (e.g. a category listing) so its first row
   * isn't lazy-loaded — see ProductCard's `priority` prop. Left off by default since most
   * ProductGrid call sites (homepage sections, search results, wishlist) aren't reliably
   * above the fold. Capped at the widest row (4, `lg:grid-cols-4`) regardless of viewport, since
   * over-marking images as priority competes for bandwidth with the one that's actually the LCP. */
  priority?: boolean;
}

export function ProductGrid({ products, emptyState, priority }: ProductGridProps) {
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
      {products.map((product, i) => (
        <motion.div key={product.id} variants={item}>
          <ProductCard product={product} priority={priority && i < 4} />
        </motion.div>
      ))}
    </motion.div>
  );
}
