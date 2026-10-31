"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { SegmentedControl } from "@/components/ui/tabs";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { ProfitDashboard, type ProfitPeriod } from "@/components/admin/finance/profit-dashboard";
import { useCapabilities } from "@/hooks/use-capability";
import { useUrlState } from "@/hooks/use-url-state";
import { getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import * as booksApi from "@/lib/api/finance-books";
import { formatBookDate, formatPrice } from "@/lib/format";
import { GRAINS, presetRange, PROFIT_PRESETS } from "@/lib/profit-period";
import { urlParam } from "@/lib/url-state";
import { cn } from "@/lib/utils";
import { PermissionState } from "@/components/admin/permission-state";

const today = () => new Date().toLocaleDateString("en-CA");
const PERIOD_URL = { view: urlParam.enum(PROFIT_PRESETS, "30d"), from: urlParam.date(), to: urlParam.date(), gran: urlParam.optionalEnum(GRAINS) };

/** Owner's books §8–§9 and the Profit dashboard (docs/FINANCE_PROFIT_DASHBOARD.md): how much the business kept for any
 * period — by day, week or month, with the sales, ads and costs behind it — then what each order and product really earned,
 * and an estimate of the weeks before the books started. The period lives in the URL, so a view can be bookmarked. */
export default function ProfitPage() {
  const { can, ready } = useCapabilities();
  const allowed = can("finance.view");
  const t = today();
  const [url, setUrl] = useUrlState(PERIOD_URL);
  const preset = url.view;
  const fallback = presetRange("30d", t);
  const range = preset === "custom" ? { from: url.from || fallback.from, to: url.to || fallback.to } : presetRange(preset, t);
  const period: ProfitPeriod = { preset, ...range, grain: url.gran };
  const { from, to } = range;
  const onPeriod = (patch: Partial<ProfitPeriod>) => {
    // A preset clears custom dates and the grouping; Custom starts from the range on screen; editing a date makes it custom.
    if (patch.grain !== undefined) setUrl({ gran: patch.grain });
    else if (patch.preset && patch.preset !== "custom") setUrl({ view: patch.preset, from: "", to: "", gran: "" });
    else setUrl({ view: "custom", from: patch.from ?? from, to: patch.to ?? to });
  };
  const [view, setView] = useState<"orders" | "products">("products");
  const bad = from > to;
  const report = useQuery({ queryKey: booksApi.booksKeys.profit({ from, to }), queryFn: () => booksApi.getProfit({ from, to }), enabled: allowed && !bad });
  const business = useQuery({ queryKey: financeApi.businessKeys.settings(), queryFn: financeApi.getBusiness, enabled: allowed });
  const opening = business.data?.business.openingDate ?? null;
  const launch = useQuery({ queryKey: booksApi.booksKeys.launch({}), queryFn: () => booksApi.getLaunchReport({}), enabled: allowed && Boolean(opening) });

  if (ready && !allowed) return <div><ModuleTabs /><PermissionState icon={TrendingUp} page="Profit" /></div>;
  const r = report.data;
  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader title="Profit" description="What the business kept — today, this week, this month or any days you pick — and the sales, ads and costs behind it." />
      {ready && <ProfitDashboard period={period} onChange={onPeriod} />}
      {r?.ladder && <ProfitLadder report={r} />}
      <h2 className="pt-4 text-[20px] font-semibold tracking-tight text-fg">By product and order</h2>
      {report.isLoading && <Skeleton className="h-48 w-full" />}
      {report.isError && <Alert variant="danger" title="Profit couldn't be worked out" action={<Button size="sm" variant="outline" onClick={() => report.refetch()}>Retry</Button>}>{getErrorMessage(report.error, "")}</Alert>}
      {r && (
        <>
          {r.totals.outsideSales > 0 && r.totals.outsideSaleCostPct === null && (
            <Alert variant="warning" title="Sales outside the website have no cost of goods">
              Parcels sent straight through Steadfast took goods with them, but no order says which. Set their cost as a share of the cash in <Link href="/admin/finance/center" className="text-accent hover:underline">Finance Center › Settings</Link> — until then profit is too high by their cost.
            </Alert>
          )}
          <SegmentedControl aria-label="Show profit by" value={view} onChange={setView} options={[{ value: "products", label: "By product" }, { value: "orders", label: "By order" }] as const} />
          {view === "products" ? (
            r.products.length === 0 ? <p className="text-sm text-fg-muted">No sales in this period.</p> : (
              <Card className="overflow-hidden p-0">
                <Table>
                  <TableHead><tr><TableHeaderCell>Product</TableHeaderCell><TableHeaderCell align="right">Sold</TableHeaderCell><TableHeaderCell align="right">Sales</TableHeaderCell><TableHeaderCell align="right">Costs</TableHeaderCell><TableHeaderCell align="right">Earned</TableHeaderCell></tr></TableHead>
                  <tbody>
                    {r.products.map((p) => (
                      <TableRow key={p.name}>
                        <TableCell className="font-medium text-fg">{p.name}</TableCell>
                        <TableCell align="right" className="tabular-nums">{p.units}</TableCell>
                        <TableCell align="right" className="tabular-nums">{formatPrice(p.sales)}</TableCell>
                        <TableCell align="right" className="tabular-nums">{formatPrice(p.costs)}</TableCell>
                        <TableCell align="right" className={cn("tabular-nums font-medium", p.contribution < 0 ? "text-danger-600" : "text-fg")}>{formatPrice(p.contribution)}{p.marginPct !== null && <span className="block text-xs font-normal text-fg-muted">{p.marginPct}%</span>}</TableCell>
                      </TableRow>
                    ))}
                  </tbody>
                </Table>
              </Card>
            )
          ) : r.orders.length === 0 ? <p className="text-sm text-fg-muted">No sales in this period.</p> : (
            <Card className="overflow-hidden p-0">
              <Table>
                <TableHead><tr><TableHeaderCell>Order</TableHeaderCell><TableHeaderCell align="right">Sales</TableHeaderCell><TableHeaderCell align="right">Goods</TableHeaderCell><TableHeaderCell align="right">Courier</TableHeaderCell><TableHeaderCell align="right">Ads</TableHeaderCell><TableHeaderCell align="right">Earned</TableHeaderCell></tr></TableHead>
                <tbody>
                  {r.orders.slice(0, 200).map((o) => (
                    <TableRow key={o.orderId}>
                      <TableCell><Link href={`/admin/orders/${o.orderId}`} className="font-medium text-accent hover:underline">{o.orderNumber}</Link><span className="block text-xs text-fg-muted">{formatBookDate(o.date)}</span></TableCell>
                      <TableCell align="right" className="tabular-nums">{formatPrice(o.sales)}</TableCell>
                      <TableCell align="right" className="tabular-nums">{formatPrice(o.cogs + o.packaging)}</TableCell>
                      <TableCell align="right" className="tabular-nums">{formatPrice(o.courier + o.gateway)}</TableCell>
                      <TableCell align="right" className="tabular-nums">{formatPrice(o.ads)}</TableCell>
                      <TableCell align="right" className={cn("tabular-nums font-medium", o.contribution < 0 ? "text-danger-600" : "text-fg")}>{formatPrice(o.contribution)}</TableCell>
                    </TableRow>
                  ))}
                </tbody>
              </Table>
              <p className="px-4 py-2 text-xs text-fg-subtle">Losing orders first. A missing cost shows as zero goods — fix it in Finance exceptions.</p>
            </Card>
          )}
        </>
      )}
      {opening && launch.data?.period && (
        <Card className="space-y-3 p-5 sm:p-6" data-testid="launch-report">
          <div>
            <h2 className="text-[17px] font-semibold tracking-tight text-fg">Before the books started</h2>
            <p className="text-sm text-fg-muted">{formatBookDate(launch.data.period.from)} – {formatBookDate(launch.data.period.to)} · an estimate from the orders, today’s cost prices, the courier rate card and recorded ad spend. Not in the books.</p>
          </div>
          <dl className="divide-y divide-line-subtle text-sm">
            <Line label={`Delivered sales · ${launch.data.orders.delivered} orders`} value={launch.data.sales} strong />
            <Line label="Cost of the goods (at cost price)" value={-launch.data.cogs} />
            <Line label={`Courier charges${launch.data.courierRateCard ? "" : " (no rate card yet)"}`} value={-launch.data.courier} />
            <Line label="Ads" value={-launch.data.ads} />
            <Line label="Left before running costs" value={launch.data.contribution} strong />
          </dl>
          {launch.data.missingCost.length > 0 && (
            <Alert variant="warning" title="Some products have no cost price">
              {launch.data.missingCost.map((m) => `${m.name} (${m.units})`).join(", ")} — counted at zero cost. Add their cost price in Products.
            </Alert>
          )}
        </Card>
      )}
    </div>
  );
}

/** The books profit ladder (blueprint P2.4, owner decisions Q2 = A, Q15 = A): net sales to net profit in the books' own
 * figures, stock corrections on their own line, and badges for what the figures still lean on. Book figures only —
 * Analytics' margins are sales estimates. */
function ProfitLadder({ report }: { report: booksApi.ProfitReport }) {
  const c = report.completeness;
  const sales = report.ladder!.find((s) => s.key === "netSales")?.amount ?? 0;
  return (
    <Card className="space-y-3 p-5 sm:p-6" data-testid="profit-ladder">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold tracking-tight text-fg">Books profit</h2>
          <p className="text-sm text-fg-muted">{formatBookDate(report.period.from)} – {formatBookDate(report.period.to)} · from the books, ending at the income statement&rsquo;s net profit.</p>
        </div>
        {c && (
          <div className="flex flex-wrap gap-1.5" aria-label="How complete these figures are">
            {c.monthStatus && <Badge variant={c.monthStatus === "CLOSED" ? "success" : "neutral"}>{c.monthStatus === "CLOSED" ? "Month closed" : "Month open"}</Badge>}
            {c.missingCostLines > 0 ? <Link href="/admin/finance/exceptions" className="rounded-full"><Badge variant="warning">{c.missingCostLines} sale{c.missingCostLines === 1 ? "" : "s"} without a cost</Badge></Link> : <Badge variant="success">Every sale costed</Badge>}
            {c.estimatedCostLines > 0 && <Badge variant="neutral" title="Booked at an estimated cost (labelled ESTIMATED)">{c.estimatedCostLines} estimated cost{c.estimatedCostLines === 1 ? "" : "s"}</Badge>}
          </div>
        )}
      </div>
      <dl className="divide-y divide-line-subtle text-sm">
        {report.ladder!.map((s) => (
          <Line key={s.key} label={s.label} value={s.amount} strong={s.subtotal || s.key === "netSales"} of={sales} href={s.key === "stockCorrections" ? "/admin/inventory" : s.key === "otherCosts" ? "/admin/finance/statements" : undefined} />
        ))}
      </dl>
    </Card>
  );
}

/** One line of the bridge. With `of` (the sales total) a line also shows its share of sales — a thin bar and the percent —
 * so the costs that matter stand out without reading every figure. */
function Line({ label, value: raw, strong, href, of }: { label: string; value: number; strong?: boolean; href?: string; of?: number }) {
  const value = raw === 0 ? 0 : raw; // −0 (a negated zero cost) would read as minus zero
  // The sales line is the 100% every other line is measured against — no bar of its own.
  const pct = of && of > 0 && value !== of ? (Math.abs(value) / of) * 100 : null;
  return (
    <div className="flex items-center gap-3 py-2.5">
      <dt className={cn("min-w-0 flex-1", strong ? "font-medium text-fg" : "text-fg-muted")}>{href ? <Link href={href} className="hover:text-accent hover:underline">{label}</Link> : label}</dt>
      {of !== undefined && (
        <dd className="flex w-12 shrink-0 items-center justify-end gap-2 text-xs tabular-nums text-fg-subtle sm:w-40" aria-label={pct === null ? undefined : `${pct.toFixed(1)}% of sales`}>
          <span className={cn("hidden h-1 flex-1 overflow-hidden rounded-full bg-ink-100", pct !== null && "sm:block")} aria-hidden>
            {pct !== null && pct > 0 && <span className={cn("block h-full min-w-1 rounded-full", strong ? (value < 0 ? "bg-danger-500" : "bg-success-500") : "bg-ink-300")} style={{ width: `${Math.min(100, pct)}%` }} />}
          </span>
          <span className="w-10 text-right">{pct === null || pct === 0 ? "" : pct < 0.1 ? "<0.1%" : `${pct < 1 ? pct.toFixed(1) : Math.round(pct)}%`}</span>
        </dd>
      )}
      <dd className={cn("w-28 shrink-0 text-right tabular-nums sm:w-32", strong ? "font-semibold" : "", value < 0 && strong ? "text-danger-600" : "text-fg")}>{value < 0 ? `−${formatPrice(-value)}` : formatPrice(value)}</dd>
    </div>
  );
}
