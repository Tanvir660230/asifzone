"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { OrderSummaryCard } from "@/components/storefront/order-summary-card";
import { listMyOrders } from "@/lib/api/customers";

function OrderSummaryCardSkeleton() {
  return (
    <div className="animate-pulse border border-ink-100 p-6">
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
      <h1 className="mb-6 font-display text-2xl text-ink-900">Order history</h1>

      {isLoading && (
        <div className="space-y-6">
          {Array.from({ length: 3 }, (_, i) => (
            <OrderSummaryCardSkeleton key={i} />
          ))}
        </div>
      )}
      {!isLoading && data?.items.length === 0 && (
        <p className="text-ink-400">
          No orders yet —{" "}
          <Link href="/search" className="text-brass-600 underline hover:text-brass-500">
            start shopping
          </Link>
          .
        </p>
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
