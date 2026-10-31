"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getStoreCapabilities } from "@/lib/api/admin-home";
import type { NavAccess, NavBadgeSource, StoreCapability } from "@/lib/admin/navigation";
import { isFeatureEnabled } from "@/lib/admin/features";
import { useCapabilities } from "@/hooks/use-capability";
import { useAttentionCounts } from "@/hooks/use-attention-counts";

/** What the navigation manifest needs to know about this admin and installation — capabilities, feature flags and what
 * the store's own data says it does (Q-G). */
export function useNavAccess(): NavAccess & { ready: boolean } {
  const { can, ready } = useCapabilities();
  const store = useQuery({ queryKey: ["admin", "store-capabilities"], queryFn: getStoreCapabilities, enabled: ready, staleTime: 10 * 60_000 });
  const production = store.data?.production;
  return useMemo(
    () => ({ can, flagEnabled: isFeatureEnabled, storeHas: (c: StoreCapability) => (c === "production" ? production === true : false), ready }),
    [can, ready, production],
  );
}

/** Work-queue counts for nodes that declare a `badge` — the same numbers as the dashboard's Action Center. */
export function useNavBadges(): Record<NavBadgeSource, number> {
  const attention = useAttentionCounts();
  return {
    orders: (attention.orderStats?.pending ?? 0) + (attention.orderStats?.returnRequestsPending ?? 0),
    messages: (attention.pendingReviews ?? 0) + (attention.unreadFeedback ?? 0),
    // The module adds both up; its pages show their own share, so a count on Messages points at the page it belongs to.
    inbox: attention.unreadFeedback ?? 0,
    reviews: attention.pendingReviews ?? 0,
    finance: attention.financeAlerts ?? 0,
  };
}
