"use client";

import { useQuery } from "@tanstack/react-query";
import type { Product } from "@clothing-brand/shared";
import { useCartStore } from "@/store/cart";
import { getBundleForProduct, getProductRail } from "@/lib/api/storefront";
import { availabilityOf } from "@/lib/availability-display";
import { pickCartSuggestions } from "@/lib/cart-suggestions";

/** "Complete your order" for the current bag: the products of a bundle it belongs to first (they unlock its saving),
 * then what is often bought with the three most recently added products — nothing already in the bag, nothing sold out.
 * Shared by the cart page and the bag drawer (one cached query per bag content). */
export function useCartSuggestions(enabled = true, limit = 8) {
  const productIds = useCartStore((s) => [...new Set(s.items.map((i) => i.productId))].join(","));
  return useQuery({
    queryKey: ["cart-suggestions", productIds, limit],
    enabled: enabled && productIds.length > 0,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<{ products: Product[]; bundleName: string | null }> => {
      const inBag = new Set(productIds.split(","));
      const anchors = [...inBag].reverse().slice(0, 3);
      const results = await Promise.all(
        anchors.map((id) =>
          Promise.all([
            getBundleForProduct(id).catch(() => ({ result: null })),
            getProductRail(id, "frequentlyBought").catch(() => ({ items: [] as Product[] })),
          ]),
        ),
      );
      const bundles = results.map(([b]) => b.result).filter((b) => b !== null);
      const sources = [...bundles.map((b) => b.suggestedProducts), ...results.map(([, rail]) => rail.items)];
      return { products: pickCartSuggestions(sources, inBag, (p) => availabilityOf(p).inStock, limit), bundleName: bundles[0]?.bundle.name ?? null };
    },
  });
}
