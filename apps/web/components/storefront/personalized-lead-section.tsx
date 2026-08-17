"use client";

import { useEffect, useState } from "react";
import type { Product } from "@clothing-brand/shared";
import type { CategoryTreeNode } from "@/lib/api/storefront";
import { fetchRecommendedProducts } from "@/lib/api/storefront";
import { getViewedCategoryIds } from "@/lib/recently-viewed";
import { ProductCarousel } from "./product-carousel";
import { ProductCarouselSkeleton } from "./skeletons/product-carousel-skeleton";

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
  // null = not resolved yet, [] = resolved with nothing to show — distinct from "no viewing
  // history at all" (hasSignal below) so a skeleton can reserve this section's height for the
  // brief window between "we know which category to recommend from" (synchronous, from
  // localStorage) and "the recommended products actually arrived" (async fetch), instead of the
  // whole section popping in — and shifting everything below it — only once the fetch resolves.
  const [products, setProducts] = useState<Product[] | null>(null);
  const [hasSignal, setHasSignal] = useState<boolean | null>(null);

  useEffect(() => {
    const [leadingCategoryId] = getViewedCategoryIds();
    const match = leadingCategoryId ? flattenCategories(categoryTree).find((c) => c.id === leadingCategoryId) : undefined;
    if (!match) {
      setHasSignal(false);
      return;
    }

    setHasSignal(true);
    setCategory(match);
    fetchRecommendedProducts({ categoryIds: [leadingCategoryId!], limit: 8 })
      .then(({ items }) => setProducts(items))
      .catch(() => setProducts([]));
  }, [categoryTree]);

  if (!hasSignal) return null;
  if (products === null) return <ProductCarouselSkeleton />;
  if (products.length === 0) return null;

  const title = (titleTemplate || "More {category}, picked for you").replace("{category}", category!.name);

  return <ProductCarousel eyebrow={eyebrow || "Welcome back"} title={title} products={products} />;
}
