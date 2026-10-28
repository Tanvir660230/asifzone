"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCapabilities } from "@/hooks/use-capability";
import { orderKeys } from "@/components/admin/orders/order-domain";
import { attentionKeys, paymentKeys } from "@/lib/query-keys";
import * as adminHomeApi from "@/lib/api/admin-home";
import { alertKeys as financeAlertKeys, getFinanceAlerts } from "@/lib/api/finance";

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
  const { can, ready } = useCapabilities();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: attentionKeys.all,
    queryFn: adminHomeApi.getAttention,
    enabled: ready,
    refetchInterval: POLL_MS,
  });
  const data = query.data;
  // Finance alerts (docs/FINANCE_ALERTS.md) stay out of the composite: they compute the cash forecast and payroll, too heavy
  // for a one-minute poll of every admin. Owners with finance.view poll them every five minutes; critical + warning count.
  const finance = useQuery({ queryKey: financeAlertKeys.all, queryFn: getFinanceAlerts, enabled: ready && can("finance.view"), refetchInterval: POLL_MS * 5 });

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
    openErrors: data?.openErrors ?? undefined,
    /** Receipts flagged as a possible duplicate and not explained (blueprint P0.3). */
    possibleDuplicatePurchases: data?.possibleDuplicatePurchases ?? undefined,
    /** Count losses waiting for approval and bottles a booking couldn't fill. */
    stockWaiting: data?.stock ?? undefined,
    /** Parcels on their way back after a cancellation, and how many are past the follow-up days. */
    parcelsToReceive: data?.parcelsToReceive ?? undefined,
    financeAlerts: finance.data ? finance.data.counts.critical + finance.data.counts.warning : undefined,
    /** Finance alerts by severity, for Home's Action Center (undefined without finance.view). */
    financeAlertCounts: finance.data?.counts,
    /** The finance alerts themselves — Home names the critical ones and the courier's unpaid parcels. */
    financeAlertList: finance.data?.alerts,
    /** True until the first answer — lets callers show a skeleton instead of a premature "all clear". Waits for the
     * finance alerts too (when this admin reads them), so the count doesn't jump once they arrive. */
    loading: !ready || query.isLoading || finance.isLoading,
  };
}
