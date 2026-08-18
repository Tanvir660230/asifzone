"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info, ShoppingBag, Percent, Truck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile, StatTileSkeleton } from "@/components/admin/stat-tile";
import { RankedBarList, type RankedBarListItem } from "@/components/admin/ranked-bar-list";
import * as analyticsApi from "@/lib/api/admin-analytics";
import { formatPrice, orderStatusLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

type RangeOption = 7 | 30 | 90 | "all";
const RANGE_OPTIONS: RangeOption[] = [7, 30, 90, "all"];

function toBarItems<T>(rows: T[] | undefined, opts: { key: (r: T) => string; label: (r: T) => string; value: (r: T) => number; valueLabel: (r: T) => string }): RankedBarListItem[] {
  return (rows ?? []).map((r) => ({ key: opts.key(r), label: opts.label(r), value: opts.value(r), valueLabel: opts.valueLabel(r) }));
}

export default function SalesIntelligencePage() {
  const [range, setRange] = useState<RangeOption>(30);
  const apiDays = range === "all" ? undefined : range;

  const { data: statusCounts } = useQuery({ queryKey: ["bi-sales-status"], queryFn: analyticsApi.getOrderStatusCounts });
  const { data: paymentMethod } = useQuery({ queryKey: ["bi-sales-payment", apiDays], queryFn: () => analyticsApi.getFavoritePaymentMethod(apiDays) });
  const { data: discounts } = useQuery({ queryKey: ["bi-sales-discounts", apiDays], queryFn: () => analyticsApi.getDiscountUsageBreakdown(apiDays) });
  const { data: returns } = useQuery({ queryKey: ["bi-sales-returns", apiDays], queryFn: () => analyticsApi.getReturnRequestAnalytics(apiDays) });
  const { data: courier } = useQuery({ queryKey: ["bi-sales-courier", apiDays], queryFn: () => analyticsApi.getCourierPerformance(apiDays) });

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl tracking-tight text-ink-900 sm:text-3xl">Sales Intelligence</h1>
          <p className="mt-1 text-sm text-ink-500">Order mix, discounts, returns, and how well the courier is actually performing.</p>
        </div>
        <div className="inline-flex shrink-0 items-center gap-0.5 self-start rounded-full border border-ink-100 bg-ink-50/60 p-1">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt}
              onClick={() => setRange(opt)}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-200 ease-smooth",
                range === opt ? "bg-ink-900 text-cream-50 shadow-sm" : "text-ink-500 hover:text-ink-900",
              )}
            >
              {opt === "all" ? "All" : `${opt}D`}
            </button>
          ))}
        </div>
      </div>

      {/* Order mix */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Orders by status (lifetime)</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBarList
              items={toBarItems(statusCounts?.counts, { key: (c) => c.status, label: (c) => orderStatusLabel(c.status), value: (c) => c.count, valueLabel: (c) => c.count.toLocaleString("en-BD") })}
              emptyLabel="No orders yet."
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Payment method (COD vs. prepaid)</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBarList
              items={toBarItems(paymentMethod?.methods, { key: (m) => m.method, label: (m) => m.method, value: (m) => m.orders, valueLabel: (m) => `${m.orders} · ${formatPrice(m.revenue)}` })}
              emptyLabel="No orders recorded yet for this range."
            />
          </CardContent>
        </Card>
      </section>

      {/* Discounts */}
      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-500">Discount usage</h2>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
          {!discounts ? (
            Array.from({ length: 4 }).map((_, i) => <StatTileSkeleton key={i} />)
          ) : (
            <>
              <StatTile label="Orders with a discount" value={`${discounts.ordersWithDiscount} / ${discounts.totalOrders}`} icon={<Percent size={18} />} />
              <StatTile label="Discounted order rate" value={`${discounts.discountedOrderRatePct.toFixed(1)}%`} icon={<Percent size={18} />} />
              <StatTile label="Coupon discount given" value={formatPrice(discounts.couponDiscountTotal)} icon={<Percent size={18} />} />
              <StatTile label="Bundle discount given" value={formatPrice(discounts.bundleDiscountTotal)} icon={<Percent size={18} />} />
            </>
          )}
        </div>
      </section>

      {/* Returns & exchanges */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Return / exchange requests</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {!returns || returns.byTypeStatus.length === 0 ? (
              <p className="py-8 text-center text-sm text-ink-400">No return or exchange requests yet for this range.</p>
            ) : (
              <table className="w-full min-w-[380px] text-sm">
                <thead>
                  <tr className="border-b border-ink-100 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                    <th className="pb-2 pr-4">Type</th>
                    <th className="pb-2 pr-4">Status</th>
                    <th className="pb-2">Count</th>
                  </tr>
                </thead>
                <tbody>
                  {returns.byTypeStatus.map((r) => (
                    <tr key={`${r.type}-${r.status}`} className="border-b border-ink-50 last:border-0">
                      <td className="py-2 pr-4 text-ink-800">{r.type}</td>
                      <td className="py-2 pr-4 text-ink-600">{r.status}</td>
                      <td className="py-2 text-ink-800">{r.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Most common reasons</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBarList
              items={toBarItems(returns?.topReasons, { key: (r) => r.reason, label: (r) => r.reason, value: (r) => r.count, valueLabel: (r) => String(r.count) })}
              emptyLabel="No reasons recorded yet for this range."
            />
            <p className="mt-3 text-xs text-ink-400">Reasons are free text typed by the customer — only exact repeats group together.</p>
          </CardContent>
        </Card>
      </section>

      {/* Courier */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Courier delivery outcomes</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBarList
              items={toBarItems(courier?.byStatus, { key: (s) => s.status, label: (s) => s.status.replace(/_/g, " "), value: (s) => s.count, valueLabel: (s) => String(s.count) })}
              emptyLabel="No orders booked with the courier yet for this range."
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Courier round-trip losses</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-warning-50 text-warning-600">
                <Truck size={18} />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Total loss ({range === "all" ? "lifetime" : `${range}D`})</p>
                <p className="text-xl font-semibold tabular-nums text-ink-900">{courier ? formatPrice(courier.totalLoss) : "—"}</p>
              </div>
            </div>
            <RankedBarList
              items={toBarItems(courier?.lossByReason, { key: (r) => r.reason, label: (r) => r.reason.replace(/_/g, " "), value: (r) => r.amount, valueLabel: (r) => `${formatPrice(r.amount)} · ${r.count}` })}
              emptyLabel="No courier losses recorded yet for this range."
            />
            <p className="mt-3 text-xs text-ink-400">
              An admin-configured estimate (Steadfast exposes no real per-order fee) — see Settings for the rate used.
            </p>
          </CardContent>
        </Card>
      </section>

      <Card className="flex items-start gap-3 border-info-100 bg-info-50/60 p-4">
        <Info size={18} className="mt-0.5 shrink-0 text-info-600" />
        <p className="text-sm text-info-700">
          <ShoppingBag size={14} className="mr-1 inline" />
          Order fulfillment speed (placed → shipped → delivered) lives under Operational Analytics, alongside admin activity — it&apos;s a
          process metric, not a sales one.
        </p>
      </Card>
    </div>
  );
}
