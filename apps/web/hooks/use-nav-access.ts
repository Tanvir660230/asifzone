"use client";

import { useMemo } from "react";
import type { NavAccess, NavBadgeSource } from "@/lib/admin/navigation";
import { isFeatureEnabled } from "@/lib/admin/features";
import { useCapabilities } from "@/hooks/use-capability";
import { useAttentionCounts } from "@/hooks/use-attention-counts";

/** What the navigation manifest needs to know about this admin and installation — capabilities and feature flags. */
export function useNavAccess(): NavAccess & { ready: boolean } {
  const { can, ready } = useCapabilities();
  return useMemo(() => ({ can, flagEnabled: isFeatureEnabled, ready }), [can, ready]);
}

/** Work-queue counts for nodes that declare a `badge` — the same numbers as the dashboard's Action Center. */
export function useNavBadges(): Record<NavBadgeSource, number> {
  const attention = useAttentionCounts();
  return {
    orders: (attention.orderStats?.pending ?? 0) + (attention.orderStats?.returnRequestsPending ?? 0),
    messages: (attention.pendingReviews ?? 0) + (attention.unreadFeedback ?? 0),
  };
}
