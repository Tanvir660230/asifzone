"use client";

import { useEffect, useState } from "react";
import type { Product } from "@clothing-brand/shared";
import { fetchProductsByIds } from "@/lib/api/storefront";
import { getRecentlyViewed } from "@/lib/recently-viewed";
import { ProductCarousel } from "./product-carousel";

interface RecentlyViewedCarouselProps {
  /** Excludes this product id from the list — e.g. the PDP shouldn't show the product you're already viewing. */
  excludeProductId?: string;
  title?: string;
}

export function RecentlyViewedCarousel({ excludeProductId, title = "Recently Viewed" }: RecentlyViewedCarouselProps) {
  const [products, setProducts] = useState<Product[]>([]);

  useEffect(() => {
    const viewed = getRecentlyViewed().filter((v) => v.productId !== excludeProductId);
    if (viewed.length === 0) {
      setProducts([]);
      return;
    }
    fetchProductsByIds(viewed.map((v) => v.productId))
      .then(({ items }) => setProducts(items))
      .catch(() => setProducts([]));
  }, [excludeProductId]);

  return <ProductCarousel title={title} products={products} />;
}
