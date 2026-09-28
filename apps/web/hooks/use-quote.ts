"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { QuoteDto, QuoteRequestInput } from "@clothing-brand/shared";
import { getQuote } from "@/lib/api/quote";
import { useCartStore } from "@/store/cart";

/** The server quote for a cart, refetched whenever what is being priced changes (items, coupon, address). The cart's
 * locally cached prices are display placeholders only — every total shown comes from here (PRICING_INVARIANTS §7). */
export function useQuote(request: QuoteRequestInput | null, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ["quote", request],
    queryFn: async () => (await getQuote(request!)).quote,
    enabled: Boolean(request && request.items.length > 0) && (opts.enabled ?? true),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: false,
  });
}

/** The quote for the persisted cart alone (no coupon, no address) — what the cart page, drawer and sticky bar show.
 * They share one query key, so React Query makes a single request for all of them. */
export function useCartQuote() {
  const items = useCartStore((s) => s.items);
  const request = { items: items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })) };
  return useQuote(request);
}

/** A cart line's server-priced amount (sum of its flash/list segments), or null while the quote loads. */
export function quoteLineAmount(quote: QuoteDto | undefined, variantId: string): number | null {
  const line = quote?.lines.find((l) => l.variantId === variantId);
  return line ? line.amount : null;
}
