"use client";

import { useQuery } from "@tanstack/react-query";
import { useOptionalCustomer } from "@/hooks/use-current-customer";
import { getBuyAgainProductIds } from "@/lib/api/customers";
import { fetchProductsByIds } from "@/lib/api/storefront";
import { availabilityOf } from "@/lib/availability-display";
import { ProductCarousel } from "./product-carousel";
import { ProductCarouselSkeleton } from "./skeletons/product-carousel-skeleton";

/** "Buy again" for a signed-in customer: what they have received before, latest delivery first, limited to what can be
 * bought today. Guests and customers with nothing delivered yet see nothing at all. */
export function BuyAgainRail() {
  const { data: customerData } = useOptionalCustomer();
  const customer = customerData?.customer;
  const { data: products, isPending } = useQuery({
    queryKey: ["buy-again", customer?.id],
    enabled: Boolean(customer),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { productIds } = await getBuyAgainProductIds();
      const { items } = await fetchProductsByIds(productIds);
      const rank = new Map(productIds.map((id, i) => [id, i]));
      return items.filter((p) => availabilityOf(p).inStock).sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
    },
  });

  if (!customer) return null;
  if (isPending) return <ProductCarouselSkeleton />;
  if (!products || products.length === 0) return null;

  const firstName = customer.name.trim().split(/\s+/)[0];
  return <ProductCarousel eyebrow={firstName ? `Welcome back, ${firstName}` : "Welcome back"} title="Buy again" subtitle="From your past orders, in stock now." products={products} />;
}
