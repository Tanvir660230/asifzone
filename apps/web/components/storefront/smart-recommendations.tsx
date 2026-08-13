"use client";

import { useEffect, useState } from "react";
import type { Product } from "@clothing-brand/shared";
import { fetchTrendingProducts } from "@/lib/api/storefront";
import { getBudgetRange } from "@/lib/recently-viewed";
import { ProductCarousel } from "./product-carousel";
import { RecentlyViewedCarousel } from "./recently-viewed-carousel";

export function SmartRecommendations({ title }: { title?: string | null }) {
  const [trendingInBudget, setTrendingInBudget] = useState<Product[]>([]);

  useEffect(() => {
    const budget = getBudgetRange();
    if (budget) {
      fetchTrendingProducts({ minPrice: budget.min, maxPrice: budget.max })
        .then(({ items }) => setTrendingInBudget(items))
        .catch(() => setTrendingInBudget([]));
    }
  }, []);

  return (
    <>
      <RecentlyViewedCarousel />
      {trendingInBudget.length > 0 && (
        <ProductCarousel title={title || "Trending In Your Budget"} products={trendingInBudget} />
      )}
    </>
  );
}
