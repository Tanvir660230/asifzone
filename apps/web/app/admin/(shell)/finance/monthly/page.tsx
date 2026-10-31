"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { CalendarRange, ChevronDown, ChevronRight } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableCell, TableHead, TableHeaderCell, TableMessageRow, TableRow, TableSkeleton } from "@/components/ui/table";
import { PageHeader } from "@/components/admin/page-header";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as booksApi from "@/lib/api/finance-books";
import type { ProfitMonth } from "@/lib/api/finance-books";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PermissionState } from "@/components/admin/permission-state";

const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const lastDay = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);

/** Profit month by month since the books started (docs/FINANCE_PROFIT_DASHBOARD.md §5): what each month sold and what the
 * goods, packing, delivery, fees, ads and running costs took — and how sure the month is (estimated costs, open
 * exceptions, parcels the courier hasn't paid for), so a month is closed only when nothing is left to settle. A month
 * opens to its orders. */
export default function MonthlyProfitPage() {
  const { can, ready } = useCapabilities();
  const allowed = can("finance.view");
  const q = useQuery({ queryKey: ["finance", "profit", "monthly"], queryFn: booksApi.getProfitByMonth, enabled: allowed });
  const [open, setOpen] = useState<string | null>(null);
  if (ready && !allowed) return <PermissionState icon={CalendarRange} page="Finance" />;
  const months = [...(q.data?.months ?? [])].reverse();
  const total = months.reduce((s, m) => ({ sales: s.sales + m.sales, profit: s.profit + m.profit }), { sales: 0, profit: 0 });

  return (
    <div className="space-y-6">
      <PageHeader title="Month by month" description={`Every month since the books started${q.data?.booksStartedOn ? ` (${q.data.booksStartedOn})` : ""}: what it sold, what it cost and what was left — and what is still to settle before the month can be closed.`} />
      {q.data && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Card className="p-4"><p className="text-sm text-fg-muted">Sales since the start</p><p className="text-2xl font-semibold tabular-nums text-fg">{formatPrice(total.sales)}</p></Card>
          <Card className="p-4"><p className="text-sm text-fg-muted">Profit since the start</p><p className={cn("text-2xl font-semibold tabular-nums", total.profit < 0 ? "text-danger-700" : "text-fg")}>{formatPrice(total.profit)}</p></Card>
          <Card className="p-4"><p className="text-sm text-fg-muted">Months ready to close</p><p className="text-2xl font-semibold tabular-nums text-fg">{months.filter((m) => m.readyToClose).length} of {months.filter((m) => m.status !== "CLOSED").length} open</p></Card>
        </div>
      )}
      {q.isError && <Alert variant="danger" title="The months couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => q.refetch()}>Retry</Button>}>{getErrorMessage(q.error, "")}</Alert>}
      <Card className="overflow-hidden p-0">
        <HScrollShadow>
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Month</TableHeaderCell>
                <TableHeaderCell align="right">Sales</TableHeaderCell>
                <TableHeaderCell align="right">Goods</TableHeaderCell>
                <TableHeaderCell align="right">Packing</TableHeaderCell>
                <TableHeaderCell align="right">Delivery</TableHeaderCell>
                <TableHeaderCell align="right">Fees</TableHeaderCell>
                <TableHeaderCell align="right">Ads</TableHeaderCell>
                <TableHeaderCell align="right">Running</TableHeaderCell>
                <TableHeaderCell align="right">Stock fixes</TableHeaderCell>
                <TableHeaderCell align="right">Profit</TableHeaderCell>
                <TableHeaderCell>Still to settle</TableHeaderCell>
              </tr>
            </TableHead>
            <tbody>
              {q.isLoading && <TableSkeleton rows={4} cols={11} />}
              {q.isSuccess && months.length === 0 && <TableMessageRow colSpan={11}>The books haven&apos;t started yet.</TableMessageRow>}
              {months.map((m) => (
                <Fragment key={m.month}>
                  <TableRow className="cursor-pointer" onClick={() => setOpen(open === m.month ? null : m.month)} data-testid="month-row">
                    <TableCell>
                      <button type="button" className="flex min-h-11 items-center gap-1.5 font-medium text-fg" aria-expanded={open === m.month}>
                        {open === m.month ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
                        {monthName(m.month)}
                      </button>
                      <span className="block pl-6 text-xs text-fg-muted">{m.orders} orders{m.marginPct !== null ? ` · ${m.marginPct}%` : ""}</span>
                    </TableCell>
                    {[m.sales, m.goods, m.packaging, m.delivery, m.paymentFees, m.ads, m.running, m.stockCorrections].map((v, i) => <TableCell key={i} align="right" className="tabular-nums">{formatPrice(v)}</TableCell>)}
                    <TableCell align="right" className={cn("font-semibold tabular-nums", m.profit < 0 ? "text-danger-700" : "text-fg")}>{formatPrice(m.profit)}</TableCell>
                    <TableCell><Settle m={m} /></TableCell>
                  </TableRow>
                  {open === m.month && (
                    <tr><td colSpan={11} className="bg-surface-muted px-4 py-3"><MonthOrders month={m.month} /></td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </Table>
        </HScrollShadow>
      </Card>
      <p className="text-xs text-fg-muted">Stock fixes are count differences and cost corrections — stock put right, not goods sold. The months add up to the income statement. Goods marked as estimated get their real cost once purchase bills are in; a month is closed from <Link href="/admin/finance/month-end" className="font-medium text-accent hover:underline">Month-end</Link>.</p>
    </div>
  );
}

function Settle({ m }: { m: ProfitMonth }) {
  if (m.status === "CLOSED") return <Badge variant="neutral">Closed</Badge>;
  const items = [
    m.estimatedCostPct ? `${m.estimatedCostPct}% of goods cost estimated` : null,
    m.openExceptions ? `${m.openExceptions} open exception${m.openExceptions === 1 ? "" : "s"}` : null,
    m.unpaidByCourier.parcels ? `${m.unpaidByCourier.parcels} parcels unpaid · ${formatPrice(m.unpaidByCourier.amount)}` : null,
  ].filter(Boolean);
  if (!items.length) return m.readyToClose ? <Badge variant="success">Ready to close</Badge> : <span className="text-xs text-fg-muted">Month not over</span>;
  return <span className="block min-w-48 text-xs text-warning-700">{items.join(" · ")}</span>;
}

function MonthOrders({ month }: { month: string }) {
  const q = useQuery({ queryKey: ["finance", "profit", "month-orders", month], queryFn: () => booksApi.getProfit({ from: `${month}-01`, to: lastDay(month) }) });
  if (q.isLoading) return <Skeleton className="h-24 w-full" />;
  if (q.isError || !q.data) return <p className="text-sm text-danger-700">{getErrorMessage(q.error, "The orders couldn't be loaded")}</p>;
  const worst = q.data.orders.slice(0, 15);
  if (!worst.length) return <p className="text-sm text-fg-muted">No delivered orders in this month yet.</p>;
  return (
    <div className="space-y-2">
      <p className="text-sm text-fg-muted">{q.data.totals.orders} orders · contribution {formatPrice(q.data.totals.contribution)} · net profit {formatPrice(q.data.totals.netProfit)} — the {worst.length} that earned least:</p>
      <ul className="divide-y divide-line-subtle rounded-xl bg-surface">
        {worst.map((o) => (
          <li key={o.orderId} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm">
            <Link href={`/admin/orders/${o.orderId}`} className="w-40 font-medium text-accent hover:underline">{o.orderNumber}</Link>
            <span className="tabular-nums text-fg-muted">sold {formatPrice(o.sales)} · goods {formatPrice(o.cogs)} · courier {formatPrice(o.courier)} · ads {formatPrice(o.ads)}</span>
            <span className={cn("ml-auto font-semibold tabular-nums", o.contribution < 0 ? "text-danger-700" : "text-fg")}>{formatPrice(o.contribution)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
