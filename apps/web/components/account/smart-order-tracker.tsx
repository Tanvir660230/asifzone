"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Circle, Truck } from "lucide-react";
import type { OrderStatus } from "@clothing-brand/shared";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listMyOrders } from "@/lib/api/customers";
import { orderStatusBadgeClass, orderStatusLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

const STEPS: { status: OrderStatus; label: string }[] = [
  { status: "CONFIRMED", label: "Confirmed" },
  { status: "PROCESSING", label: "Processing" },
  { status: "PACKED", label: "Packed" },
  { status: "SHIPPED", label: "Shipped" },
  { status: "DELIVERED", label: "Delivered" },
];

// Statuses that fall outside the happy-path progression — shown as a plain status message
// instead of forcing them onto a step index that wouldn't mean anything for them.
const EXCEPTION_STATUSES: OrderStatus[] = ["CANCELLED", "RETURNED", "REFUNDED", "PARTIALLY_DELIVERED"];

const EXCEPTION_MESSAGES: Partial<Record<OrderStatus, string>> = {
  CANCELLED: "This order was cancelled.",
  RETURNED: "This order was returned.",
  REFUNDED: "This order has been refunded.",
  PARTIALLY_DELIVERED: "Part of this order was delivered — the rest is being resolved.",
};

/** Compact "latest order" progress card for the account dashboard — full history timeline lives
 * on the order detail page, this is just enough to tell someone where their most recent order
 * stands without leaving the dashboard. */
export function SmartOrderTracker() {
  const { data, isLoading } = useQuery({
    queryKey: ["my-orders", { page: 1, pageSize: 1, forTracker: true }],
    queryFn: () => listMyOrders({ page: 1, pageSize: 1 }),
  });

  if (isLoading) {
    return (
      <div className="mb-8 animate-pulse rounded-xl border border-ink-100 bg-cream-50 p-6 sm:p-8">
        <div className="h-3 w-24 rounded bg-ink-100" />
        <div className="mt-3 h-5 w-32 rounded bg-ink-100" />
        <div className="mt-6 h-8 w-full rounded bg-ink-100" />
      </div>
    );
  }

  const order = data?.items[0];
  if (!order) return null;

  const isException = EXCEPTION_STATUSES.includes(order.status);
  const stepIndex = STEPS.findIndex((s) => s.status === order.status);

  return (
    <Card className="mb-8">
      <CardContent className="py-6 sm:py-7">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-ink-400">Latest order</p>
            <Link href={`/account/orders/${order.id}`} className="font-display text-lg text-ink-900 hover:text-brass-600">
              {order.orderNumber}
            </Link>
          </div>
          <Badge className={orderStatusBadgeClass(order.status)}>{orderStatusLabel(order.status)}</Badge>
        </div>

        {isException ? (
          <p className="text-sm text-ink-500">{EXCEPTION_MESSAGES[order.status]}</p>
        ) : (
          <div className="flex items-center">
            {STEPS.map((step, i) => {
              const done = i <= stepIndex;
              return (
                <div key={step.status} className="flex flex-1 items-center last:flex-none">
                  <div className="flex flex-col items-center gap-1.5">
                    {done ? (
                      <CheckCircle2 size={18} className="shrink-0 text-brass-600" />
                    ) : (
                      <Circle size={18} className="shrink-0 text-ink-200" />
                    )}
                    <span className={cn("text-center text-[11px] leading-tight", done ? "text-ink-900" : "text-ink-400")}>
                      {step.label}
                    </span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className={cn("mx-1 mb-4 h-0.5 flex-1", i < stepIndex ? "bg-brass-600" : "bg-ink-100")} />
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          <Link href={`/account/orders/${order.id}`}>
            <Button variant="outline" size="sm">
              View details
            </Button>
          </Link>
          {order.courierTrackingLink && order.status === "SHIPPED" && (
            <a href={order.courierTrackingLink} target="_blank" rel="noopener noreferrer">
              <Button variant="ghost" size="sm">
                <Truck size={14} /> Track parcel
              </Button>
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
