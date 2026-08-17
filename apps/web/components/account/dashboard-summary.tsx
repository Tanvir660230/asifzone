"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { useCurrentCustomer } from "@/hooks/use-current-customer";
import { listMyOrders } from "@/lib/api/customers";
import { listMyReturnRequests } from "@/lib/api/return-requests";
import { orderStatusBadgeClass, orderStatusLabel } from "@/lib/format";

const CARD_CLASS =
  "block border border-ink-100 bg-cream-50 p-4 transition-colors duration-150 ease-smooth hover:border-ink-300";

function CardSkeleton() {
  return (
    <div className="animate-pulse border border-ink-100 bg-cream-50 p-4">
      <div className="h-3 w-20 rounded bg-ink-100" />
      <div className="mt-2 h-5 w-24 rounded bg-ink-100" />
    </div>
  );
}

/** At-a-glance strip shown above the profile form — previously "/account" (labeled "Profile" in
 * the nav, so this wasn't a mislabeled dashboard, just a genuinely missing one) surfaced nothing
 * beyond the profile-edit form itself, despite every one of these three facts already being
 * available from other account pages' own queries. Each card links to that fuller page. */
export function AccountDashboardSummary() {
  const { data: customerData } = useCurrentCustomer();
  const { data: ordersData, isLoading: ordersLoading } = useQuery({
    queryKey: ["my-orders", { page: 1, pageSize: 1 }],
    queryFn: () => listMyOrders({ page: 1, pageSize: 1 }),
  });
  const { data: returnsData, isLoading: returnsLoading } = useQuery({
    queryKey: ["my-return-requests", { status: "PENDING", forDashboard: true }],
    queryFn: () => listMyReturnRequests({ status: "PENDING", pageSize: 1 }),
  });

  const latestOrder = ordersData?.items[0];
  const pendingReturns = returnsData?.total ?? 0;
  const points = customerData?.customer?.rewardPoints;

  return (
    <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
      {ordersLoading ? (
        <CardSkeleton />
      ) : (
        <Link href={latestOrder ? `/account/orders/${latestOrder.id}` : "/account/orders"} className={CARD_CLASS}>
          <p className="text-xs uppercase tracking-wide text-ink-400">Latest order</p>
          {latestOrder ? (
            <div className="mt-1.5 flex items-center gap-2">
              <span className="font-display text-base text-ink-900">{latestOrder.orderNumber}</span>
              <Badge className={orderStatusBadgeClass(latestOrder.status)}>{orderStatusLabel(latestOrder.status)}</Badge>
            </div>
          ) : (
            <p className="mt-1.5 text-sm text-ink-500">No orders yet</p>
          )}
        </Link>
      )}

      <Link href="/account/reward-points" className={CARD_CLASS}>
        <p className="text-xs uppercase tracking-wide text-ink-400">Reward points</p>
        <p className="mt-1.5 font-display text-base text-ink-900">{points ?? 0} pts</p>
      </Link>

      {returnsLoading ? (
        <CardSkeleton />
      ) : (
        <Link href="/account/returns" className={CARD_CLASS}>
          <p className="text-xs uppercase tracking-wide text-ink-400">Pending returns</p>
          <p className="mt-1.5 font-display text-base text-ink-900">
            {pendingReturns === 0 ? "None" : pendingReturns}
          </p>
        </Link>
      )}
    </div>
  );
}
