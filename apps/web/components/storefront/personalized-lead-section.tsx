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

interface PersonalizedLeadSectionProps {
  categoryTree: CategoryTreeNode[];
  eyebrow?: string | null;
  /** `{category}` is replaced with the visitor's most-recently-viewed category name. */
  titleTemplate?: string | null;
}

/** The very first personalized thing a returning visitor sees, right after the hero — keyed to
 * whichever category they looked at most recently. Renders nothing for a first-time visitor (no
 * "recently viewed" signal yet), so the homepage stays generic until there's real signal to act on. */
export function PersonalizedLeadSection({ categoryTree, eyebrow, titleTemplate }: PersonalizedLeadSectionProps) {
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

  const title = (titleTemplate || "More {category}, picked for you").replace("{category}", category.name);

  return <ProductCarousel eyebrow={eyebrow || "Welcome back"} title={title} products={products} />;
}
