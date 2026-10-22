"use client";

import { useQuery } from "@tanstack/react-query";
import type { AdminOrderListItem } from "@clothing-brand/shared";
import { getOrderRisk, type OrderRisk } from "@/lib/api/admin-analytics";

/** Statuses where a risk read can still change a decision (confirm, call first, or don't send). */
const UNDECIDED = new Set(["PENDING", "CONFIRMED", "PROCESSING", "PACKED"]);

/** COD risk for the undecided orders on screen — one batched lookup per page (§4.8). Empty while loading or on error:
 * the badge is a hint, never something the list waits for. */
export function useOrderRisk(items: readonly AdminOrderListItem[], enabled = true): Record<string, OrderRisk> {
  const ids = items.filter((o) => !o.deletedAt && UNDECIDED.has(o.status)).map((o) => o.id);
  const { data } = useQuery({
    queryKey: ["order-risk", ids],
    queryFn: () => getOrderRisk(ids),
    enabled: enabled && ids.length > 0,
    staleTime: 60_000,
  });
  return data?.orders ?? {};
}
