"use client";

import { useQuery } from "@tanstack/react-query";
import { Info, Wallet, TrendingUp, Package, Clock, Receipt } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile, StatTileSkeleton } from "@/components/admin/stat-tile";
import * as analyticsApi from "@/lib/api/admin-analytics";
import * as biApi from "@/lib/api/bi";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function FinancialAnalyticsPage() {
  const { data: overview } = useQuery({ queryKey: ["bi-financial-overview"], queryFn: biApi.getExecutiveOverview });
  const { data: profitTrend } = useQuery({ queryKey: ["bi-financial-profit-trend"], queryFn: () => analyticsApi.getProfitTrend(30) });
  const { data: costs } = useQuery({ queryKey: ["bi-financial-costs"], queryFn: () => analyticsApi.getFinancialCostBreakdown(undefined) });
  const { data: tax } = useQuery({ queryKey: ["bi-financial-tax"], queryFn: () => analyticsApi.getEstimatedTax(undefined) });

  const recentTrend = profitTrend ? [...profitTrend.series].reverse().slice(0, 14) : [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl tracking-tight text-ink-900 sm:text-3xl">Financial Analytics</h1>
        <p className="mt-1 text-sm text-ink-500">Revenue, cost, profit, and the money leaving the business through refunds, discounts, and courier loss.</p>
      </div>

      {/* Lifetime — reused directly from the Executive Overview */}
      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-500">Lifetime</h2>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
          {!overview ? (
            Array.from({ length: 6 }).map((_, i) => <StatTileSkeleton key={i} />)
          ) : (
            <>
              <StatTile label="Gross Profit (lifetime, est.)" value={formatPrice(overview.grossProfitLifetime)} icon={<Wallet size={18} />} tone="accent" trendPct={overview.profitGrowthPct} />
              <StatTile label="Inventory Value" value={formatPrice(overview.inventoryValue)} icon={<Package size={18} />} />
              <StatTile label="Pending Payments" value={formatPrice(overview.pendingPaymentsAmount)} icon={<Clock size={18} />} tone={overview.pendingPaymentsCount > 0 ? "warning" : "default"} />
              <StatTile label="Refund Rate" value={`${overview.refundRatePct.toFixed(1)}%`} icon={<Receipt size={18} />} />
              <StatTile label="Return Rate" value={`${overview.returnRatePct.toFixed(1)}%`} icon={<Receipt size={18} />} />
              <StatTile label="Cancelled Rate" value={`${overview.cancelledRatePct.toFixed(1)}%`} icon={<Receipt size={18} />} />
            </>
          )}
        </div>
      </section>

      {/* Cost of doing business */}
      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-500">Cost breakdown (lifetime)</h2>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
          {!costs ? (
            Array.from({ length: 3 }).map((_, i) => <StatTileSkeleton key={i} />)
          ) : (
            <>
              <StatTile label="Refunded order value" value={formatPrice(costs.refundCost)} icon={<Receipt size={18} />} />
              <StatTile label="Discounts given away" value={formatPrice(costs.discountCost)} icon={<Receipt size={18} />} />
              <StatTile label="Courier round-trip loss" value={formatPrice(costs.courierLossCost)} icon={<Receipt size={18} />} tone={costs.courierLossCount > 0 ? "warning" : "default"} />
            </>
          )}
        </div>
      </section>

      {/* Profit trend */}
      <section>
        <Card>
          <CardHeader>
            <CardTitle>Daily revenue vs. cost vs. profit (last 30 days)</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {recentTrend.length === 0 ? (
              <p className="py-8 text-center text-sm text-ink-400">No orders recorded yet.</p>
            ) : (
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="border-b border-ink-100 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                    <th className="pb-2 pr-4">Date</th>
                    <th className="pb-2 pr-4">Revenue</th>
                    <th className="pb-2 pr-4">Est. COGS</th>
                    <th className="pb-2">Est. profit</th>
                  </tr>
                </thead>
                <tbody>
                  {recentTrend.map((p) => (
                    <tr key={p.date} className="border-b border-ink-50 last:border-0">
                      <td className="py-2 pr-4 text-ink-600">{new Date(p.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</td>
                      <td className="py-2 pr-4 text-ink-800">{formatPrice(p.revenue)}</td>
                      <td className="py-2 pr-4 text-ink-600">{formatPrice(p.cogs)}</td>
                      <td className={cn("py-2 font-medium", p.profit >= 0 ? "text-success-600" : "text-danger-600")}>{formatPrice(p.profit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="mt-3 text-xs text-ink-400">COGS is estimated against current cost price — OrderItem never snapshots cost at sale time.</p>
          </CardContent>
        </Card>
      </section>

      {/* Tax */}
      <section>
        <Card>
          <CardHeader>
            <CardTitle>
              <TrendingUp size={16} className="mr-1.5 inline" /> Estimated tax collected (lifetime)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!tax ? (
              <StatTileSkeleton />
            ) : !tax.taxEnabled ? (
              <p className="text-sm text-ink-500">Tax collection isn&apos;t enabled in Settings — nothing to estimate.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
                <StatTile label="Store tax rate" value={`${tax.defaultTaxRatePct}%`} icon={<Receipt size={18} />} />
                <StatTile label="Estimated tax" value={formatPrice(tax.estimatedTax)} icon={<Receipt size={18} />} tone="accent" />
                <StatTile label="Revenue this basis" value={formatPrice(tax.revenue)} icon={<Wallet size={18} />} />
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <Card className="flex items-start gap-3 border-info-100 bg-info-50/60 p-4">
        <Info size={18} className="mt-0.5 shrink-0 text-info-600" />
        <p className="text-sm text-info-700">
          Tax is an estimate against the store&apos;s <em>current</em> flat rate applied to windowed revenue — orders never snapshot a tax
          amount per line, so this can&apos;t reconstruct a real historical figure if the rate has changed.
        </p>
      </Card>
    </div>
  );
}
