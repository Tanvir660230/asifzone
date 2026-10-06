"use client";

import { useQuery } from "@tanstack/react-query";
import { useCapabilities } from "@/hooks/use-capability";
import { orderKeys } from "@/components/admin/orders/order-domain";
import { attentionKeys, paymentKeys } from "@/lib/query-keys";
import * as adminOrdersApi from "@/lib/api/admin-orders";
import * as adminReviewsApi from "@/lib/api/admin-reviews";
import * as adminFeedbackApi from "@/lib/api/admin-feedback";
import * as paymentsAdminApi from "@/lib/api/payments-admin";

const POLL_MS = 60_000;

/**
 * The "something is waiting on an admin" counts, shared by the dashboard's Action Center and the sidebar's badges.
 * Each query is gated on the permission its endpoint enforces (so a role without it never fires a request that would
 * 403) and uses the same queryKey as the page that owns that data, so React Query de-duplicates them — the sidebar,
 * dashboard and e.g. the Payments overview read one cached response, not three.
 */
export function useAttentionCounts() {
  const { can, ready } = useCapabilities();

  const orderStats = useQuery({
    queryKey: orderKeys.stats,
    queryFn: adminOrdersApi.getOrderStats,
    enabled: can("orders.view"),
    refetchInterval: POLL_MS,
  });
  const payments = useQuery({
    queryKey: paymentKeys.overview,
    queryFn: paymentsAdminApi.getPaymentsOverview,
    enabled: can("payments.view"),
    refetchInterval: POLL_MS,
  });
  // pageSize 1: only the list's `total` is wanted here, not the rows.
  const pendingReviews = useQuery({
    queryKey: attentionKeys.pendingReviews,
    queryFn: () => adminReviewsApi.listReviewsAdmin({ status: "PENDING", pageSize: 1 }),
    enabled: can("content.manage"),
    refetchInterval: POLL_MS * 2,
  });
  const unreadFeedback = useQuery({
    queryKey: attentionKeys.unreadFeedback,
    queryFn: () => adminFeedbackApi.listFeedback({ status: "unread", pageSize: 1 }),
    enabled: can("content.manage"),
    refetchInterval: POLL_MS * 2,
  });

  return {
    orderStats: orderStats.data,
    payments: payments.data,
    pendingReviews: pendingReviews.data?.total,
    unreadFeedback: unreadFeedback.data?.total,
    /** True until every query this admin is allowed to run has answered once — lets callers show a skeleton instead
     * of a premature "all clear". (v5 `isLoading` is false for a disabled query, so a gated-off one never blocks.) */
    loading: !ready || orderStats.isLoading || payments.isLoading || pendingReviews.isLoading || unreadFeedback.isLoading,
  };
}
