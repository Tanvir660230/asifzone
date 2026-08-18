"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RankedBarList, type RankedBarListItem } from "@/components/admin/ranked-bar-list";
import { DemandForecastTable } from "@/components/admin/demand-forecast-table";
import { SlowMovingTable } from "@/components/admin/slow-moving-table";
import { ProductSalesHeatmap } from "@/components/admin/product-sales-heatmap";
import * as analyticsApi from "@/lib/api/admin-analytics";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

type RangeOption = 7 | 30 | 90 | "all";
const RANGE_OPTIONS: RangeOption[] = [7, 30, 90, "all"];

function toBarItems<T>(rows: T[] | undefined, opts: { key: (r: T) => string; label: (r: T) => string; value: (r: T) => number; valueLabel: (r: T) => string }): RankedBarListItem[] {
  return (rows ?? []).map((r) => ({ key: opts.key(r), label: opts.label(r), value: opts.value(r), valueLabel: opts.valueLabel(r) }));
}

export default function ProductIntelligencePage() {
  const [range, setRange] = useState<RangeOption>(30);
  const apiDays = range === "all" ? undefined : range;
  const legacyDays = range === "all" ? 365 : range;

  const { data: mostViewed } = useQuery({ queryKey: ["bi-products-most-viewed", legacyDays], queryFn: () => analyticsApi.getMostViewedProducts(legacyDays, 8) });
  const { data: mostWishlisted } = useQuery({ queryKey: ["bi-products-wishlisted"], queryFn: () => analyticsApi.getMostWishlisted(8) });
  const { data: mostAdded } = useQuery({ queryKey: ["bi-products-added", apiDays], queryFn: () => analyticsApi.getMostAddedToCart(apiDays, 8) });
  const { data: mostRemoved } = useQuery({ queryKey: ["bi-products-removed", apiDays], queryFn: () => analyticsApi.getMostRemovedFromCart(apiDays, 8) });

  const { data: conversion } = useQuery({ queryKey: ["bi-products-conversion", apiDays], queryFn: () => analyticsApi.getProductConversionRates(apiDays) });

  const { data: topRevenue } = useQuery({ queryKey: ["bi-products-revenue", legacyDays], queryFn: () => analyticsApi.getTopProducts(legacyDays, 8) });
  const { data: topProfit } = useQuery({ queryKey: ["bi-products-profit", apiDays], queryFn: () => analyticsApi.getHighestProfitProducts(apiDays, 8) });

  const { data: risk } = useQuery({ queryKey: ["bi-products-risk", apiDays], queryFn: () => analyticsApi.getProductRiskMetrics(apiDays, 10) });

  const { data: fbt } = useQuery({ queryKey: ["bi-products-fbt", apiDays], queryFn: () => analyticsApi.getFrequentlyBoughtTogetherPairs(apiDays, 8) });

  const { data: variants } = useQuery({ queryKey: ["bi-products-variants", apiDays], queryFn: () => analyticsApi.getVariantPerformance(apiDays, 10) });
  const { data: sizeColor } = useQuery({ queryKey: ["bi-products-size-color", apiDays], queryFn: () => analyticsApi.getSizeColorPerformance(apiDays) });

  const { data: heatmap } = useQuery({ queryKey: ["bi-products-heatmap"], queryFn: () => analyticsApi.getProductSalesHeatmap(14, 10) });

  const { data: turnover } = useQuery({ queryKey: ["bi-products-turnover", apiDays], queryFn: () => analyticsApi.getInventoryTurnover(apiDays, 8) });
  const { data: demandForecast } = useQuery({ queryKey: ["bi-products-demand-forecast"], queryFn: () => analyticsApi.getDemandForecast(14, 10) });
  const { data: slowMoving } = useQuery({ queryKey: ["bi-products-slow-moving", legacyDays], queryFn: () => analyticsApi.getSlowMovingProducts(legacyDays, 10) });

  const conversionSorted = conversion?.products ?? [];
  const topConverting = conversionSorted.slice(0, 10);
  const bottomConverting = [...conversionSorted].reverse().slice(0, 10);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl tracking-tight text-ink-900 sm:text-3xl">Product Intelligence</h1>
          <p className="mt-1 text-sm text-ink-500">Which products earn attention, which convert it, and which need restocking.</p>
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

      {/* Interest */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Most viewed</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBarList
              items={toBarItems(mostViewed?.products, {
                key: (p) => p.id,
                label: (p) => p.name,
                value: (p) => p.views,
                valueLabel: (p) => p.views.toLocaleString("en-BD"),
              })}
              emptyLabel="No views recorded yet."
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Most wishlisted (lifetime)</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBarList
              items={toBarItems(mostWishlisted?.products, {
                key: (p) => p.id,
                label: (p) => p.name,
                value: (p) => p.count,
                valueLabel: (p) => p.count.toLocaleString("en-BD"),
              })}
              emptyLabel="No wishlist activity yet."
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Most added to cart</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBarList
              items={toBarItems(mostAdded?.products, {
                key: (p) => p.id,
                label: (p) => p.name,
                value: (p) => p.count,
                valueLabel: (p) => p.count.toLocaleString("en-BD"),
              })}
              emptyLabel="No add-to-cart activity yet for this range."
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Most removed from cart</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBarList
              items={toBarItems(mostRemoved?.products, {
                key: (p) => p.id,
                label: (p) => p.name,
                value: (p) => p.count,
                valueLabel: (p) => p.count.toLocaleString("en-BD"),
              })}
              emptyLabel="No cart-removal activity yet for this range."
            />
          </CardContent>
        </Card>
      </section>

      {/* Conversion */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Highest conversion (views → orders)</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBarList
              items={toBarItems(topConverting, {
                key: (p) => p.id,
                label: (p) => p.name,
                value: (p) => p.conversionRatePct,
                valueLabel: (p) => `${p.conversionRatePct.toFixed(1)}%`,
              })}
              emptyLabel="Not enough view data yet."
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Lowest conversion</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBarList
              items={toBarItems(bottomConverting, {
                key: (p) => p.id,
                label: (p) => p.name,
                value: (p) => Math.max(p.conversionRatePct, 0.01),
                valueLabel: (p) => `${p.conversionRatePct.toFixed(1)}%`,
              })}
              emptyLabel="Not enough view data yet."
            />
          </CardContent>
        </Card>
      </section>

      {/* Revenue & Profit */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{`Highest revenue (${range === "all" ? "365d" : `${range}D`})`}</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBarList
              items={toBarItems(topRevenue?.products, {
                key: (p) => p.productId ?? p.name,
                label: (p) => p.name,
                value: (p) => p.revenue,
                valueLabel: (p) => formatPrice(p.revenue),
              })}
              emptyLabel="No sales recorded yet."
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Highest profit (est.)</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBarList
              items={toBarItems(topProfit?.products, {
                key: (p) => p.id,
                label: (p) => p.name,
                value: (p) => p.profit,
                valueLabel: (p) => formatPrice(p.profit),
              })}
              emptyLabel="No sales recorded yet."
            />
            <p className="mt-3 text-xs text-ink-400">Profit is revenue minus estimated cost at current cost price — not an exact historical margin.</p>
          </CardContent>
        </Card>
      </section>

      {/* Risk */}
      <section>
        <Card>
          <CardHeader>
            <CardTitle>Return &amp; refund risk</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {!risk || risk.products.length === 0 ? (
              <p className="py-8 text-center text-sm text-ink-400">No orders recorded yet for this range.</p>
            ) : (
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-ink-100 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                    <th className="pb-2 pr-4">Product</th>
                    <th className="pb-2 pr-4">Return rate</th>
                    <th className="pb-2 pr-4">Refund rate (order-level)</th>
                    <th className="pb-2">Orders</th>
                  </tr>
                </thead>
                <tbody>
                  {risk.products.map((p) => (
                    <tr key={p.id} className="border-b border-ink-50 last:border-0">
                      <td className="py-2 pr-4 font-medium text-ink-800">{p.name}</td>
                      <td className={cn("py-2 pr-4", p.returnRatePct > 20 ? "font-medium text-danger-600" : "text-ink-600")}>
                        {p.returnRatePct.toFixed(1)}%
                      </td>
                      <td className={cn("py-2 pr-4", p.refundRatePct > 20 ? "font-medium text-danger-600" : "text-ink-600")}>
                        {p.refundRatePct.toFixed(1)}%
                      </td>
                      <td className="py-2 text-ink-500">{p.totalOrders}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="mt-3 text-xs text-ink-400">
              Refund rate is an order-level signal (of orders containing this product, how many ended up fully refunded) — not an exact
              per-item figure, since refunds aren&apos;t recorded per line item.
            </p>
          </CardContent>
        </Card>
      </section>

      {/* Cross-sell */}
      <section>
        <Card>
          <CardHeader>
            <CardTitle>Frequently bought together</CardTitle>
          </CardHeader>
          <CardContent>
            {!fbt || fbt.pairs.length === 0 ? (
              <p className="py-8 text-center text-sm text-ink-400">Not enough multi-product orders yet to detect pairs.</p>
            ) : (
              <ul className="divide-y divide-ink-50">
                {fbt.pairs.map((pair, i) => (
                  <li key={i} className="flex items-center justify-between py-2.5 text-sm">
                    <span className="text-ink-800">
                      {pair.productA} <span className="text-ink-400">+</span> {pair.productB}
                    </span>
                    <span className="font-semibold tabular-nums text-ink-600">{pair.coCount} orders</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Variant Intelligence */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Variant (SKU) performance</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {!variants || variants.variants.length === 0 ? (
              <p className="py-8 text-center text-sm text-ink-400">No sales recorded yet for this range.</p>
            ) : (
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-ink-100 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                    <th className="pb-2 pr-4">SKU</th>
                    <th className="pb-2 pr-4">Product</th>
                    <th className="pb-2 pr-4">Size / Color</th>
                    <th className="pb-2 pr-4">Units sold</th>
                    <th className="pb-2">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {variants.variants.map((v) => (
                    <tr key={v.sku} className="border-b border-ink-50 last:border-0">
                      <td className="py-2 pr-4 font-mono text-xs text-ink-500">{v.sku}</td>
                      <td className="py-2 pr-4 text-ink-800">{v.productName}</td>
                      <td className="py-2 pr-4 text-ink-600">
                        {v.size} / {v.color}
                      </td>
                      <td className="py-2 pr-4 text-ink-600">{v.unitsSold}</td>
                      <td className="py-2 text-ink-800">{formatPrice(v.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Size performance</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBarList
              items={toBarItems(sizeColor?.sizes, {
                key: (s) => s.value,
                label: (s) => s.value,
                value: (s) => s.unitsSold,
                valueLabel: (s) => `${s.unitsSold} · ${formatPrice(s.revenue)}`,
              })}
              emptyLabel="No sales recorded yet."
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Color performance</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBarList
              items={toBarItems(sizeColor?.colors, {
                key: (c) => c.value,
                label: (c) => c.value,
                value: (c) => c.unitsSold,
                valueLabel: (c) => `${c.unitsSold} · ${formatPrice(c.revenue)}`,
              })}
              emptyLabel="No sales recorded yet."
            />
          </CardContent>
        </Card>
      </section>

      {/* Sales heatmap */}
      <section>
        <Card>
          <CardHeader>
            <CardTitle>Product sales heatmap (top 10 × last 14 days)</CardTitle>
          </CardHeader>
          <CardContent>{heatmap && <ProductSalesHeatmap data={heatmap} />}</CardContent>
        </Card>
      </section>

      {/* Inventory Intelligence */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Inventory turnover</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBarList
              items={toBarItems(turnover?.products, {
                key: (p) => p.id,
                label: (p) => p.name,
                value: (p) => p.turnoverRatio,
                valueLabel: (p) => `${p.turnoverRatio.toFixed(2)}x`,
              })}
              emptyLabel="No turnover data yet — needs both sales and cost-priced stock on hand."
            />
            <p className="mt-3 text-xs text-ink-400">COGS sold ÷ current inventory value — a practical stand-in for average inventory, since stock isn&apos;t snapshotted over time.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Restock prediction</CardTitle>
          </CardHeader>
          <CardContent>{demandForecast && <DemandForecastTable variants={demandForecast.variants} />}</CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{`Dead stock (${range === "all" ? "365d" : `${range}D`})`}</CardTitle>
          </CardHeader>
          <CardContent>{slowMoving && <SlowMovingTable products={slowMoving.products} />}</CardContent>
        </Card>
      </section>

      <Card className="flex items-start gap-3 border-info-100 bg-info-50/60 p-4">
        <Info size={18} className="mt-0.5 shrink-0 text-info-600" />
        <p className="text-sm text-info-700">
          Highest CTR and Most Clicked aren&apos;t shown yet — they need impression tracking (was a product shown vs. clicked) across every
          product card store-wide, which doesn&apos;t exist today. Planned as a focused follow-up.
        </p>
      </Card>
    </div>
  );
}
