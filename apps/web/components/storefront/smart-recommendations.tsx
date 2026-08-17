"use client";

import { useEffect, useState } from "react";
import type { Product } from "@clothing-brand/shared";
import { fetchTrendingProducts } from "@/lib/api/storefront";
import { getBudgetRange } from "@/lib/recently-viewed";
import { ProductCarousel } from "./product-carousel";
import { ProductCarouselSkeleton } from "./skeletons/product-carousel-skeleton";
import { RecentlyViewedCarousel } from "./recently-viewed-carousel";

export function SmartRecommendations({ title }: { title?: string | null }) {
  // null = not resolved yet — see RecentlyViewedCarousel for why this reserves space via a
  // skeleton rather than popping the section in once the (async) fetch resolves. hasBudgetSignal
  // is read inside the effect (not during render) since getBudgetRange() depends on
  // localStorage — reading it synchronously during render would return a different value on the
  // server (no localStorage) than on the client's first render, a hydration mismatch.
  const [trendingInBudget, setTrendingInBudget] = useState<Product[] | null>(null);
  const [hasBudgetSignal, setHasBudgetSignal] = useState(false);

  useEffect(() => {
    const budget = getBudgetRange();
    setHasBudgetSignal(budget !== null);
    if (budget) {
      fetchTrendingProducts({ minPrice: budget.min, maxPrice: budget.max })
        .then(({ items }) => setTrendingInBudget(items))
        .catch(() => setTrendingInBudget([]));
    }
  }, []);

  return (
    <>
      <RecentlyViewedCarousel />
      {hasBudgetSignal && trendingInBudget === null && <ProductCarouselSkeleton />}
      {trendingInBudget !== null && trendingInBudget.length > 0 && (
        <ProductCarousel title={title || "Trending In Your Budget"} products={trendingInBudget} />
      )}
    </>
  );
}
