"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCapabilities } from "@/hooks/use-capability";
import { orderKeys } from "@/components/admin/orders/order-domain";
import { attentionKeys, paymentKeys } from "@/lib/query-keys";
import * as adminHomeApi from "@/lib/api/admin-home";

const POLL_MS = 60_000;

/**
 * The "something is waiting on an admin" counts, shared by the sidebar badges, the notification bell and Home's
 * Action Center — one composite poll (GET /api/v1/admin/attention, Blueprint V2 PERF-03) instead of five. The server
 * returns `null` for every section this admin may not read. React Query pauses the poll while the tab is hidden.
 *
 * The order stats and payments overview it carries are also written into those endpoints' own cache keys, so the
 * Orders and Payments pages open on fresh numbers instead of firing a duplicate request.
 */
export function useAttentionCounts() {
  const { ready } = useCapabilities();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: attentionKeys.all,
    queryFn: adminHomeApi.getAttention,
    enabled: ready,
    refetchInterval: POLL_MS,
  });
  const data = query.data;

  useEffect(() => {
    if (data?.orders) queryClient.setQueryData(orderKeys.stats, data.orders);
    if (data?.payments) queryClient.setQueryData(paymentKeys.overview, data.payments);
  }, [data, queryClient]);

  return {
    orderStats: data?.orders ?? undefined,
    payments: data?.payments ?? undefined,
    pendingReviews: data?.pendingReviews ?? undefined,
    unreadFeedback: data?.unreadFeedback ?? undefined,
    unreadNotifications: data?.unreadNotifications ?? 0,
    /** True until the first answer — lets callers show a skeleton instead of a premature "all clear". */
    loading: !ready || query.isLoading,
  };
}
