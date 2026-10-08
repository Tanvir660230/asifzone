"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info, Wallet, TrendingUp, Package, Clock, Receipt, Banknote, Undo2, Truck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile, StatTileSkeleton } from "@/components/admin/stat-tile";
import { MetricDrillDown, type DrillTarget } from "@/components/admin/analytics/metric-drill-down";
import * as analyticsApi from "@/lib/api/admin-analytics";
import * as biApi from "@/lib/api/bi";
import { formatBusinessDate, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

// Every number here is a registry metric computed by the server (docs/METRICS_REGISTRY.md); this page only formats them.
export default function FinancialAnalyticsPage() {
  const { data: overview } = useQuery({ queryKey: ["bi-financial-overview"], queryFn: biApi.getExecutiveOverview });
  const { data: profitTrend } = useQuery({ queryKey: ["bi-financial-profit-trend"], queryFn: () => analyticsApi.getProfitTrend(30) });
  const { data: costs } = useQuery({ queryKey: ["bi-financial-costs"], queryFn: () => analyticsApi.getFinancialCostBreakdown(undefined) });
  const { data: tax } = useQuery({ queryKey: ["bi-financial-tax"], queryFn: () => analyticsApi.getEstimatedTax(undefined) });

  const recentTrend = profitTrend ? [...profitTrend.series].reverse().slice(0, 14) : [];
  // Click a "This month" tile to break it down (registry groupings) with links to the filtered lists.
  const [target, setTarget] = useState<DrillTarget | null>(null);
  const drill = (metric: string) => setTarget({ metric, range: { preset: "this_month" }, rangeLabel: "This month" });

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-fg">Financial Analytics</h2>
        <p className="mt-1 text-sm text-ink-500">
          Realised sales (COD at delivery, online at payment), returns, refunds and cash — one definition per number.
        </p>
      </div>

      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-500">This month</h2>
        <p className="-mt-2 mb-3 text-[12px] text-fg-subtle">Click a number to see what it&apos;s made of.</p>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
          {!overview ? (
            Array.from({ length: 11 }).map((_, i) => <StatTileSkeleton key={i} />)
          ) : (
            <>
              <StatTile onClick={() => drill("gross_merchandise_sales")} label="Gross merchandise (as charged)" value={formatPrice(overview.grossMerchandiseThisMonth)} icon={<Wallet size={18} />} />
              <StatTile onClick={() => drill("discounts")} label="Discounts" value={formatPrice(overview.discountsThisMonth)} icon={<Receipt size={18} />} />
              <StatTile onClick={() => drill("merchandise_vat")} label="Merchandise VAT" value={formatPrice(overview.merchandiseVatThisMonth)} icon={<Receipt size={18} />} />
              <StatTile onClick={() => drill("merchandise_refunds")} label="Merchandise refunds" value={formatPrice(overview.merchandiseRefundsThisMonth)} icon={<Undo2 size={18} />} />
              <StatTile onClick={() => drill("realised_net_sales")} label="Realised net sales" value={formatPrice(overview.revenueThisMonth)} icon={<TrendingUp size={18} />} tone="accent" trendPct={overview.revenueGrowthPct} />
              <StatTile onClick={() => drill("shipping_charged")} label="Shipping charged" value={formatPrice(overview.shippingThisMonth)} icon={<Truck size={18} />} />
              <StatTile onClick={() => drill("tax_collected")} label="VAT collected" value={formatPrice(overview.taxThisMonth)} icon={<Receipt size={18} />} />
              <StatTile onClick={() => drill("refunds")} label="All refunds" value={formatPrice(overview.refundsThisMonth)} icon={<Undo2 size={18} />} />
              <StatTile onClick={() => drill("collected_cash")} label="Collected cash" value={formatPrice(overview.collectedCashThisMonth)} icon={<Banknote size={18} />} />
              <StatTile onClick={() => drill("returns")} label="Returns (goods back)" value={formatPrice(overview.returnsThisMonth)} icon={<Undo2 size={18} />} />
              <StatTile onClick={() => drill("net_sales")} label="Net sales incl. shipping, less returns" value={formatPrice(overview.netSalesInclShippingThisMonth)} icon={<Wallet size={18} />} />
            </>
          )}
        </div>
        <p className="mt-2 text-xs text-ink-400">
          Realised net sales = gross merchandise − discounts − merchandise VAT − merchandise refunds. Shipping and VAT are reported
          separately. A refund first covers any overpayment, then merchandise (up to what is left of the order), then shipping and
          other charges.
          {overview && overview.merchandiseVatUnrecordedOrdersThisMonth > 0
            ? ` ${overview.merchandiseVatUnrecordedOrdersThisMonth} order(s) this month have no VAT record, so their merchandise is shown as charged.`
            : ""}
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-500">Right now</h2>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
          {!overview ? (
            Array.from({ length: 3 }).map((_, i) => <StatTileSkeleton key={i} />)
          ) : (
            <>
              <StatTile label="Outstanding COD" value={formatPrice(overview.outstandingCod)} icon={<Truck size={18} />} />
              <StatTile label="Refunds owed" value={formatPrice(overview.refundDue)} icon={<Undo2 size={18} />} tone={overview.refundDue > 0 ? "warning" : "default"} />
              <StatTile label="Balance due" value={formatPrice(overview.pendingPaymentsAmount)} icon={<Clock size={18} />} tone={overview.pendingPaymentsCount > 0 ? "warning" : "default"} />
            </>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-500">Lifetime</h2>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
          {!overview ? (
            Array.from({ length: 6 }).map((_, i) => <StatTileSkeleton key={i} />)
          ) : (
            <>
              <StatTile label="Gross margin (lifetime, recorded cost)" value={formatPrice(overview.grossProfitLifetime)} icon={<Wallet size={18} />} tone="accent" trendPct={overview.profitGrowthPct} />
              <StatTile label="Inventory value (current cost)" value={formatPrice(overview.inventoryValue)} icon={<Package size={18} />} />
              <StatTile label="Refund rate" value={`${overview.refundRatePct.toFixed(1)}%`} icon={<Receipt size={18} />} />
              <StatTile label="Return rate" value={`${overview.returnRatePct.toFixed(1)}%`} icon={<Receipt size={18} />} />
              <StatTile label="Cancelled rate" value={`${overview.cancelledRatePct.toFixed(1)}%`} icon={<Receipt size={18} />} />
            </>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-500">Money leaving the business (lifetime)</h2>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
          {!costs ? (
            Array.from({ length: 3 }).map((_, i) => <StatTileSkeleton key={i} />)
          ) : (
            <>
              <StatTile label="Refunds paid out" value={formatPrice(costs.refundCost)} icon={<Receipt size={18} />} />
              <StatTile label="Discounts given" value={formatPrice(costs.discountCost)} icon={<Receipt size={18} />} />
              <StatTile label="Courier round-trip loss" value={formatPrice(costs.courierLossCost)} icon={<Receipt size={18} />} tone={costs.courierLossCount > 0 ? "warning" : "default"} />
            </>
          )}
        </div>
      </section>

      <section>
        <Card>
          <CardHeader>
            <CardTitle>Daily net merchandise sales vs. cost vs. margin (last 30 days)</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {recentTrend.length === 0 ? (
              <p className="py-8 text-center text-sm text-ink-400">No orders recorded yet.</p>
            ) : (
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="border-b border-ink-100 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                    <th className="pb-2 pr-4">Date</th>
                    <th className="pb-2 pr-4">Net merchandise</th>
                    <th className="pb-2 pr-4">COGS</th>
                    <th className="pb-2">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {recentTrend.map((p) => (
                    <tr key={p.date} className="border-b border-ink-50 last:border-0">
                      <td className="py-2 pr-4 text-ink-600">{formatBusinessDate(p.date)}</td>
                      <td className="py-2 pr-4 text-ink-800">{formatPrice(p.revenue)}</td>
                      <td className="py-2 pr-4 text-ink-600">{formatPrice(p.cogs)}</td>
                      <td className={cn("py-2 font-medium", p.profit >= 0 ? "text-success-600" : "text-danger-600")}>{formatPrice(p.profit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="mt-3 text-xs text-ink-400">
              Cost of goods and margin use the cost recorded on each order line when it was sold; margin excludes VAT. Lines with no recorded cost
              (sold before cost was recorded, or with no cost price) are left out rather than counted at zero
              {profitTrend && profitTrend.costCoverage.missing > 0 ? ` — ${profitTrend.costCoverage.missing} such line(s) in this window` : ""}.
            </p>
          </CardContent>
        </Card>
      </section>

      <section>
        <Card>
          <CardHeader>
            <CardTitle>
              <TrendingUp size={16} className="mr-1.5 inline" /> VAT collected (lifetime)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!tax ? (
              <StatTileSkeleton />
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
                <StatTile label="VAT on orders" value={formatPrice(tax.estimatedTax)} icon={<Receipt size={18} />} tone="accent" />
                <StatTile label="Realised net sales" value={formatPrice(tax.revenue)} icon={<Wallet size={18} />} />
                <StatTile label="Orders without a VAT record" value={String(tax.taxUnrecordedOrders ?? 0)} icon={<Receipt size={18} />} />
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <Card className="flex items-start gap-3 border-info-100 bg-info-50/60 p-4">
        <Info size={18} className="mt-0.5 shrink-0 text-info-600" />
        <p className="text-sm text-info-700">
          VAT is summed from each order&apos;s own tax record. Orders placed before tax was recorded are counted, not estimated — changing the tax
          rate today never changes a past figure.
        </p>
      </Card>
      <MetricDrillDown target={target} onClose={() => setTarget(null)} />
    </div>
  );
}
