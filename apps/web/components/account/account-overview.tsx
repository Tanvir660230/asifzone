"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Package, Gift, RotateCcw } from "lucide-react";
import { useCurrentCustomer } from "@/hooks/use-current-customer";
import { listMyOrders } from "@/lib/api/customers";
import { listMyReturnRequests } from "@/lib/api/return-requests";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

const CHIP_CLASS =
  "flex items-center gap-2 rounded-full border border-ink-100 bg-cream-50 px-3.5 py-2 text-sm text-ink-700 transition-colors duration-150 ease-smooth hover:border-ink-300 hover:bg-ink-50";

/** Persistent "who you are + at a glance" strip shown above the sidebar/content split on every
 * /account page — was previously the Profile-page-only AccountDashboardSummary, but the info
 * (latest order, points, pending returns) is account-wide context, not something specific to the
 * Profile form, so it now lives in the shared shell layout instead. */
export function AccountOverview() {
  const { data: customerData, isLoading: customerLoading } = useCurrentCustomer();
  const { data: ordersData } = useQuery({
    queryKey: ["my-orders", { page: 1, pageSize: 1 }],
    queryFn: () => listMyOrders({ page: 1, pageSize: 1 }),
  });
  const { data: returnsData } = useQuery({
    queryKey: ["my-return-requests", { status: "PENDING", forDashboard: true }],
    queryFn: () => listMyReturnRequests({ status: "PENDING", pageSize: 1 }),
  });

  const customer = customerData?.customer;
  const orderCount = ordersData?.total ?? 0;
  const pendingReturns = returnsData?.total ?? 0;

  if (customerLoading || !customer) {
    return (
      <div className="mb-8 flex animate-pulse items-center gap-4">
        <div className="h-14 w-14 shrink-0 rounded-full bg-ink-100" />
        <div className="space-y-2">
          <div className="h-4 w-32 rounded bg-ink-100" />
          <div className="h-3 w-40 rounded bg-ink-100" />
        </div>
      </div>
    );
  }

  return (
    <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-ink-900 font-display text-lg text-cream-50">
          {initials(customer.name) || "?"}
        </div>
        <div>
          <p className="font-display text-xl text-ink-900">{customer.name}</p>
          <p className="text-sm text-ink-500">{customer.email ?? customer.phone ?? ""}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link href="/account/orders" className={CHIP_CLASS}>
          <Package size={15} className="text-ink-400" />
          {orderCount} order{orderCount === 1 ? "" : "s"}
        </Link>
        <Link href="/account/reward-points" className={CHIP_CLASS}>
          <Gift size={15} className="text-ink-400" />
          {customer.rewardPoints ?? 0} pts
        </Link>
        <Link href="/account/returns" className={CHIP_CLASS}>
          <RotateCcw size={15} className="text-ink-400" />
          {pendingReturns === 0 ? "No pending returns" : `${pendingReturns} pending return${pendingReturns === 1 ? "" : "s"}`}
        </Link>
      </div>
    </div>
  );
}
