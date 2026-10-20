"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Landmark, ShoppingBag, TrendingUp } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { SegmentedControl } from "@/components/ui/tabs";
import { EmptyState } from "@/components/admin/empty-state";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { StatTile } from "@/components/admin/stat-tile";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import * as booksApi from "@/lib/api/finance-books";
import { formatBookDate, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

const today = () => new Date().toLocaleDateString("en-CA");

/** Owner's books §8–§9: what each order and product really earned — sales less goods, packaging, courier, gateway fees
 * and its share of the ads — down to the books' net profit; and an estimate of the weeks before the books started. */
export default function ProfitPage() {
  const { can, ready } = useCapabilities();
  const allowed = can("finance.view");
  const t = today();
  const [from, setFrom] = useState(`${t.slice(0, 7)}-01`);
  const [to, setTo] = useState(t);
  const [view, setView] = useState<"orders" | "products">("products");
  const period = { from: from || undefined, to: to || undefined };
  const bad = Boolean(from && to && from > to);
  const report = useQuery({ queryKey: booksApi.booksKeys.profit(period), queryFn: () => booksApi.getProfit(period), enabled: allowed && !bad });
  const business = useQuery({ queryKey: financeApi.businessKeys.settings(), queryFn: financeApi.getBusiness, enabled: allowed });
  const opening = business.data?.business.openingDate ?? null;
  const launch = useQuery({ queryKey: booksApi.booksKeys.launch({}), queryFn: () => booksApi.getLaunchReport({}), enabled: allowed && Boolean(opening) });

  if (ready && !allowed) return <div><ModuleTabs /><EmptyState icon={TrendingUp} title="Profit isn't available to your role" /></div>;
  const r = report.data;
  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader title="Profit by order & product" description="What each sale really earned after the goods, packaging, courier, payment fees and its share of the ads — ending at the same net profit as the books." />
      <div className="flex flex-wrap items-end gap-3">
        <Field htmlFor="pf-from" label="From" className="w-40"><Input id="pf-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field htmlFor="pf-to" label="To" className="w-40" error={bad ? "Before From" : undefined}><Input id="pf-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      {report.isLoading && <Skeleton className="h-48 w-full" />}
      {report.isError && <Alert variant="danger" title="Profit couldn't be worked out" action={<Button size="sm" variant="outline" onClick={() => report.refetch()}>Retry</Button>}>{getErrorMessage(report.error, "")}</Alert>}
      {r && (
        <>
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="Totals">
            <StatTile label={`Sales · ${r.totals.orders} orders`} value={formatPrice(Math.round(r.totals.sales))} icon={<ShoppingBag />} />
            <StatTile label={`Left after costs${r.totals.contributionPct === null ? "" : ` · ${Math.round(r.totals.contributionPct)}%`}`} value={formatPrice(Math.round(r.totals.contribution))} tone="accent" icon={<TrendingUp />} />
            <StatTile label="Net profit" value={formatPrice(Math.round(r.totals.netProfit))} href="/admin/finance/statements" icon={<Landmark />} />
          </section>
          {r.totals.sales > 0 && r.totals.cogs === 0 && (
            <Alert variant="warning" title="The cost of the goods isn't known yet">
              Profit here is too high until each product has its cost — confirm your stock&apos;s value in <Link href="/admin/finance/inventory-cutover" className="text-accent hover:underline">Valuation cutover</Link> (it asks the cost per item once).
            </Alert>
          )}
          <Card className="p-5 sm:p-6">
            <h2 className="mb-3 text-[17px] font-semibold tracking-tight text-fg">From sales to profit</h2>
            <dl className="divide-y divide-line-subtle text-sm" data-testid="profit-bridge">
              <Line label="Sales" value={r.totals.sales} strong />
              <Line label="Cost of the goods" value={-r.totals.cogs} />
              <Line label="Packaging" value={-r.totals.packaging} href="/admin/finance/packaging" />
              <Line label="Courier charges" value={-r.totals.courier} href="/admin/finance/courier" />
              <Line label="Payment gateway fees" value={-r.totals.gateway} />
              <Line label="Ads" value={-r.totals.ads} href="/admin/finance/ads" />
              <Line label="Left after each sale's costs" value={r.totals.contribution} strong />
              <Line label="Running costs (rent, salaries, hosting …)" value={-r.totals.otherCosts} href="/admin/finance/expenses" />
              <Line label="Net profit" value={r.totals.netProfit} strong />
            </dl>
          </Card>
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
      {opening && launch.data && (
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

function Line({ label, value, strong, href }: { label: string; value: number; strong?: boolean; href?: string }) {
  return (
    <div className="flex items-baseline gap-3 py-2.5">
      <dt className={cn("min-w-0 flex-1", strong ? "font-medium text-fg" : "text-fg-muted")}>{href ? <Link href={href} className="hover:text-accent hover:underline">{label}</Link> : label}</dt>
      <dd className={cn("w-32 shrink-0 text-right tabular-nums", strong ? "font-semibold" : "", value < 0 && strong ? "text-danger-600" : "text-fg")}>{formatPrice(value === 0 ? 0 : value)}</dd>
    </div>
  );
}
