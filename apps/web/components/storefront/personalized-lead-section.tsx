"use client";

import { useEffect, useState } from "react";
import type { Product } from "@clothing-brand/shared";
import type { CategoryTreeNode } from "@/lib/api/storefront";
import { fetchRecommendedProducts } from "@/lib/api/storefront";
import { getViewedCategoryIds } from "@/lib/recently-viewed";
import { ProductCarousel } from "./product-carousel";

function flattenCategories(tree: CategoryTreeNode[]): CategoryTreeNode[] {
  return tree.flatMap((node) => [node, ...flattenCategories(node.children)]);
}

/** The very first personalized thing a returning visitor sees, right after the hero — keyed to
 * whichever category they looked at most recently. Renders nothing for a first-time visitor (no
 * "recently viewed" signal yet), so the homepage stays generic until there's real signal to act on. */
export function PersonalizedLeadSection({ categoryTree }: { categoryTree: CategoryTreeNode[] }) {
  const [category, setCategory] = useState<CategoryTreeNode | null>(null);
  const [products, setProducts] = useState<Product[]>([]);

  useEffect(() => {
    const [leadingCategoryId] = getViewedCategoryIds();
    if (!leadingCategoryId) return;

    const match = flattenCategories(categoryTree).find((c) => c.id === leadingCategoryId);
    if (!match) return;

    setCategory(match);
    fetchRecommendedProducts({ categoryIds: [leadingCategoryId], limit: 8 })
      .then(({ items }) => setProducts(items))
      .catch(() => setProducts([]));
  }, [categoryTree]);

  if (!category || products.length === 0) return null;

  return <ProductCarousel eyebrow="Welcome back" title={`More ${category.name}, picked for you`} products={products} />;
}
