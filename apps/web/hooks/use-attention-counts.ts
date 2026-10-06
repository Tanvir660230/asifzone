"use client";

import { useQuery } from "@tanstack/react-query";
import { adminCan } from "@/lib/auth";
import { useCurrentAdmin } from "@/hooks/use-current-admin";
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
  const { data: me } = useCurrentAdmin();
  const admin = me?.admin;

  const orderStats = useQuery({
    queryKey: ["admin-order-stats"],
    queryFn: adminOrdersApi.getOrderStats,
    enabled: adminCan(admin, "orders.read"),
    refetchInterval: POLL_MS,
  });
  const payments = useQuery({
    queryKey: ["payments-overview"],
    queryFn: paymentsAdminApi.getPaymentsOverview,
    enabled: adminCan(admin, "payments.read"),
    refetchInterval: POLL_MS,
  });
  // pageSize 1: only the list's `total` is wanted here, not the rows.
  const pendingReviews = useQuery({
    queryKey: ["attention", "pending-reviews"],
    queryFn: () => adminReviewsApi.listReviewsAdmin({ status: "PENDING", pageSize: 1 }),
    enabled: adminCan(admin, "content.manage"),
    refetchInterval: POLL_MS * 2,
  });
  const unreadFeedback = useQuery({
    queryKey: ["attention", "unread-feedback"],
    queryFn: () => adminFeedbackApi.listFeedback({ status: "unread", pageSize: 1 }),
    enabled: adminCan(admin, "content.manage"),
    refetchInterval: POLL_MS * 2,
  });

  return {
    orderStats: orderStats.data,
    payments: payments.data,
    pendingReviews: pendingReviews.data?.total,
    unreadFeedback: unreadFeedback.data?.total,
    /** True until every query this admin is allowed to run has answered once — lets callers show a skeleton instead
     * of a premature "all clear". (v5 `isLoading` is false for a disabled query, so a gated-off one never blocks.) */
    loading: !admin || orderStats.isLoading || payments.isLoading || pendingReviews.isLoading || unreadFeedback.isLoading,
  };
}
