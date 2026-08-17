"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Package } from "lucide-react";
import { OrderSummaryCard } from "@/components/storefront/order-summary-card";
import { AccountPageHeader } from "@/components/account/account-page-header";
import { AccountEmptyState } from "@/components/account/account-empty-state";
import { Button } from "@/components/ui/button";
import { listMyOrders } from "@/lib/api/customers";

function OrderSummaryCardSkeleton() {
  return (
    <div className="animate-pulse rounded-lg border border-ink-100 p-6">
      <div className="mb-4 flex items-center justify-between border-b border-ink-100 pb-4">
        <div className="h-3 w-14 rounded bg-ink-100" />
        <div className="h-3 w-24 rounded bg-ink-100" />
      </div>
      <div className="space-y-2">
        <div className="h-3 w-full rounded bg-ink-100" />
        <div className="h-3 w-2/3 rounded bg-ink-100" />
      </div>
    </div>
  );
}

export default function AccountOrdersPage() {
  const { data, isLoading } = useQuery({ queryKey: ["my-orders"], queryFn: () => listMyOrders() });

  return (
    <div>
      <AccountPageHeader title="Order history" description="Track and review everything you've ordered." />

      {isLoading && (
        <div className="space-y-6">
          {Array.from({ length: 3 }, (_, i) => (
            <OrderSummaryCardSkeleton key={i} />
          ))}
        </div>
      )}
      {!isLoading && data?.items.length === 0 && (
        <AccountEmptyState
          icon={Package}
          title="No orders yet"
          description="Once you place an order, it'll show up here."
          action={
            <Link href="/search">
              <Button size="sm">Start shopping</Button>
            </Link>
          }
        />
      )}

      <div className="space-y-6">
        {data?.items.map((order) => (
          <div key={order.id}>
            <div className="mb-2 flex items-center justify-between">
              <Link href={`/account/orders/${order.id}`} className="text-sm font-medium text-ink-900 hover:text-brass-600">
                {order.orderNumber}
              </Link>
              <span className="text-xs text-ink-400">{new Date(order.createdAt).toLocaleDateString()}</span>
            </div>
            <OrderSummaryCard order={order} />
          </div>
        ))}
      </div>
    </div>
  );
}
