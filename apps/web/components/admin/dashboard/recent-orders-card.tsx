"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, ShoppingBag } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import * as adminOrdersApi from "@/lib/api/admin-orders";
import { formatPrice, initials, orderStatusBadgeClass, orderStatusShortLabel, timeAgo } from "@/lib/format";

const LIMIT = 7;

/** The newest orders at a glance — who, what, how much, where it stands — each row opening the order itself. */
export function RecentOrdersCard({ enabled = true }: { enabled?: boolean }) {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-recent-orders"],
    queryFn: () => adminOrdersApi.listOrders({ page: 1, pageSize: LIMIT, sortBy: "createdAt", sortDir: "desc" }),
    enabled,
    refetchInterval: 60_000,
  });

  return (
    <Card className="flex flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line-subtle px-5 py-4 sm:px-6">
        <h2 className="font-display text-lg tracking-tight text-ink-900">Recent orders</h2>
        <Link
          href="/admin/orders"
          className="flex shrink-0 items-center gap-1 text-sm font-medium text-ink-500 transition-colors duration-150 ease-smooth hover:text-ink-900"
        >
          All orders <ArrowUpRight size={14} />
        </Link>
      </div>

      {isLoading ? (
        <ul className="divide-y divide-line-subtle">
          {Array.from({ length: 5 }).map((_, i) => (
            <li key={i} className="flex items-center gap-3 px-5 py-3.5 sm:px-6">
              <div className="h-9 w-9 shrink-0 rounded-full ui-skeleton" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-28 rounded ui-skeleton" />
                <div className="h-3 w-40 rounded ui-skeleton" />
              </div>
              <div className="h-4 w-16 rounded ui-skeleton" />
            </li>
          ))}
        </ul>
      ) : !data || data.items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
          <ShoppingBag size={22} className="text-ink-300" />
          <p className="text-sm text-ink-500">No orders yet — they&apos;ll show up here as they come in.</p>
        </div>
      ) : (
        <ul className="divide-y divide-line-subtle">
          {data.items.map((order) => {
            const first = order.itemsSummary.firstItem;
            const more = order.itemsSummary.totalItems - (first?.quantity ?? 0);
            return (
              <li key={order.id}>
                <Link
                  href={`/admin/orders/${order.id}`}
                  className="group flex items-center gap-3 px-5 py-3 transition-colors duration-150 ease-smooth hover:bg-ink-50/70 focus-visible:bg-ink-50 focus-visible:outline-none sm:px-6"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink-100 text-xs font-semibold text-ink-600">
                    {initials(order.customerName) || "?"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink-900">{order.customerName}</span>
                    <span className="block truncate text-xs text-ink-500">
                      {first ? `${first.name}${more > 0 ? ` +${more} more` : ""}` : "—"} · {timeAgo(order.createdAt)}
                    </span>
                    <span className="block truncate font-mono text-[11px] text-ink-400">#{order.orderNumber}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-sm font-semibold tabular-nums text-ink-900">{formatPrice(order.total)}</span>
                    <Badge className={orderStatusBadgeClass(order.status)}>{orderStatusShortLabel(order.status)}</Badge>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
