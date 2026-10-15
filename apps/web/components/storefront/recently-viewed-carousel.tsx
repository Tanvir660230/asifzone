"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { Product } from "@clothing-brand/shared";
import { fetchProductsByIds } from "@/lib/api/storefront";
import { getRecentlyViewed } from "@/lib/recently-viewed";
import { ProductCarousel } from "./product-carousel";
import { ProductCarouselSkeleton } from "./skeletons/product-carousel-skeleton";

interface RecentlyViewedCarouselProps {
  /** Excludes this product id from the list — e.g. the PDP shouldn't show the product you're already viewing. */
  excludeProductId?: string;
  title?: string;
  /** Shown when there's genuinely no browsing history (not while still resolving) — the homepage
   * usage leaves this unset, since a blank section is the right outcome there; the dedicated
   * /account/browsing-history page, where this is the entire page content rather than one of
   * several sections, passes a real message instead of otherwise showing nothing at all. */
  emptyState?: ReactNode;
  /** Fewer products than this and the section stays hidden — on the product page a single card is not worth a row. */
  minProducts?: number;
}

export function RecentlyViewedCarousel({ excludeProductId, title = "Recently Viewed", emptyState = null, minProducts = 1 }: RecentlyViewedCarouselProps) {
  // null = not resolved yet — reserves the carousel's height via a skeleton for the window
  // between "we know there's viewing history" (synchronous, from localStorage) and "the actual
  // products came back" (async fetch), instead of popping the whole section in once the fetch
  // resolves and shifting everything below it.
  const [products, setProducts] = useState<Product[] | null>(null);
  const [hasSignal, setHasSignal] = useState<boolean | null>(null);

  useEffect(() => {
    const viewed = getRecentlyViewed().filter((v) => v.productId !== excludeProductId);
    // Not enough history for this section: no skeleton first, nothing at all.
    if (viewed.length < Math.max(1, minProducts)) {
      setHasSignal(false);
      return;
    }
    setHasSignal(true);
    fetchProductsByIds(viewed.map((v) => v.productId))
      .then(({ items }) => setProducts(items))
      .catch(() => setProducts([]));
  }, [excludeProductId, minProducts]);

  if (hasSignal === null) return null;
  if (!hasSignal) return <>{emptyState}</>;
  if (products === null) return <ProductCarouselSkeleton />;
  if (products.length === 0) return <>{emptyState}</>;
  if (products.length < minProducts) return null;

  return <ProductCarousel title={title} products={products} />;
}
