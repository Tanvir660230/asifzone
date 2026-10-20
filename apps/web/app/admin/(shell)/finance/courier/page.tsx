"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Download, Scale, Truck, Wallet } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { EmptyState } from "@/components/admin/empty-state";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { StatTile } from "@/components/admin/stat-tile";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import * as booksApi from "@/lib/api/finance-books";
import type { CourierOrderRow } from "@/lib/api/finance-books";
import { formatBookDate, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Owner's books §3.6: the courier's side of the books on one page — what the books expect from Steadfast next to its own
 * balance, payouts to bring in and post, and the parcels that need a look (unpaid, stuck, status mismatch, partial). */
export default function CourierCheckPage() {
  const { can, ready } = useCapabilities();
  const queryClient = useQueryClient();
  const allowed = can("finance.view");
  const rec = useQuery({ queryKey: booksApi.booksKeys.courier(), queryFn: booksApi.getCourierReconciliation, enabled: allowed });
  const accounts = useQuery({ queryKey: financeApi.financeKeys.accounts(), queryFn: financeApi.listFinancialAccounts, enabled: allowed });
  const [dest, setDest] = useState("");
  const payInto = (accounts.data?.financialAccounts ?? []).filter((a) => a.isActive && ["BANK", "MOBILE_WALLET", "CASH"].includes(a.kind));
  const destination = dest || rec.data?.settings.payoutAccountId || "";
  const imp = useMutation({
    mutationFn: () => booksApi.importCourierPayouts(destination),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ["finance"] });
      if (r.problems.length) toast.error(`${r.imported.length} imported; ${r.problems.length} couldn't be read — import their payout file in Courier & gateway payouts`);
      else toast.success(r.imported.length ? `${r.imported.length} payout${r.imported.length === 1 ? "" : "s"} brought in as drafts — check and post them` : `Nothing new (${r.alreadyRecorded} already recorded)`);
    },
    onError: (e) => toast.error(getErrorMessage(e, "Steadfast's payouts couldn't be read")),
  });

  if (ready && !allowed) return <div><ModuleTabs /><EmptyState icon={Truck} title="This page isn't available to your role" /></div>;
  const d = rec.data;
  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader title="Steadfast check" description="What Steadfast should hold for you, next to what it says it holds — and every parcel that needs a look." />
      {rec.isLoading && <Skeleton className="h-40 w-full" />}
      {rec.isError && <Alert variant="danger" title="The courier check couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => rec.refetch()}>Retry</Button>}>{getErrorMessage(rec.error, "")}</Alert>}
      {d && (
        <>
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="Balances">
            <StatTile label="Steadfast should pay you" value={formatPrice(Math.round(d.books.expectedFromCourier))} icon={<Truck />} tone="accent" />
            <StatTile label="Steadfast's own balance" value={d.courier.balance === null ? "—" : formatPrice(Math.round(d.courier.balance))} icon={<Wallet />} />
            <StatTile label="Difference" value={d.courier.difference === null ? "—" : formatPrice(Math.round(d.courier.difference))} tone={d.courier.difference ? "warning" : "default"} icon={<Scale />} />
          </section>
          <p className="text-xs text-fg-muted">
            Collected and not yet paid out {formatPrice(d.books.codClearing)}, less charges booked against it {formatPrice(d.books.chargesAccrued)}.
            {d.courier.error ? " Steadfast's balance couldn't be read right now — check its panel." : " A difference usually means a payout not posted yet, a partial delivery not settled, or a charge the rate card got wrong."}
          </p>

          <Card className="space-y-3 p-4 sm:p-5">
            <div>
              <h2 className="text-[17px] font-semibold tracking-tight text-fg">Bring in Steadfast’s payouts</h2>
              <p className="text-sm text-fg-muted">Each new payout becomes a draft, matched to its orders by consignment. Check the money reached the account, then post it.</p>
            </div>
            {can("finance.transact") && (
              <div className="flex flex-wrap items-end gap-3">
                <Field htmlFor="payout-dest" label="Steadfast pays into" className="w-full sm:w-72">
                  <Select id="payout-dest" value={destination} onChange={(e) => setDest(e.target.value)}>
                    <option value="">Choose…</option>
                    {payInto.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </Select>
                </Field>
                <Button disabled={!destination} loading={imp.isPending} onClick={() => imp.mutate()} data-testid="import-payouts"><Download className="h-4 w-4" /> Import payouts</Button>
              </div>
            )}
            {d.draftPayouts.length > 0 ? (
              <ul className="divide-y divide-line-subtle text-sm" data-testid="draft-payouts">
                {d.draftPayouts.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>{p.reference} · {formatBookDate(p.date)}</span>
                    <span className="flex items-center gap-3"><span className="tabular-nums">{formatPrice(p.net)}</span><Link href="/admin/finance/settlements" className="text-sm font-medium text-accent hover:underline">Check & post</Link></span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="flex items-center gap-2 text-sm text-fg-muted"><CheckCircle2 className="h-4 w-4 text-success-600" aria-hidden /> No draft payouts waiting.</p>
            )}
          </Card>

          <OrderList title={`Delivered, not paid out after ${d.settings.unsettledDays} days`} hint="Ask Steadfast about these, or look for them in a payout not imported yet." rows={d.unsettled} testId="unsettled" />
          <OrderList title={`On the way more than ${d.settings.staleDays} days`} hint="Possibly lost — check the parcel on Steadfast; claim it if it's lost." rows={d.stale} testId="stale" />
          <OrderList title="Order status and Steadfast disagree" hint="Delivered here but not at Steadfast, or the other way round. Fix the order, or mark it delivered outside the courier." rows={d.statusMismatch} testId="mismatch" />
          <OrderList title="Partly delivered" hint="Record which items came back on the order, so revenue, stock and the payout agree." rows={d.partialDeliveries} testId="partial" badge={(o) => ("reconciled" in o && o.reconciled ? <Badge variant="success">items reconciled</Badge> : <Badge variant="warning">to reconcile</Badge>)} />
        </>
      )}
    </div>
  );
}

function OrderList({ title, hint, rows, testId, badge }: { title: string; hint: string; rows: CourierOrderRow[]; testId: string; badge?: (o: CourierOrderRow) => React.ReactNode }) {
  return (
    <section className="space-y-2" data-testid={testId}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-fg">{title}</h2>
        <span className={cn("text-sm tabular-nums", rows.length ? "text-warning-700" : "text-fg-muted")}>{rows.length ? `${rows.length} order${rows.length === 1 ? "" : "s"}` : "none"}</span>
      </div>
      <p className="text-sm text-fg-muted">{hint}</p>
      {rows.length > 0 && (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Order</TableHeaderCell>
                <TableHeaderCell>Customer</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Steadfast</TableHeaderCell>
                <TableHeaderCell>Booked</TableHeaderCell>
                <TableHeaderCell align="right">Total</TableHeaderCell>
              </tr>
            </TableHead>
            <tbody>
              {rows.slice(0, 50).map((o) => (
                <TableRow key={o.id}>
                  <TableCell><Link href={`/admin/orders/${o.id}`} className="font-medium text-accent hover:underline">{o.orderNumber}</Link></TableCell>
                  <TableCell>{o.customerName}</TableCell>
                  <TableCell><span className="flex flex-wrap items-center gap-1.5">{o.status.toLowerCase().replace(/_/g, " ")}{badge?.(o)}</span></TableCell>
                  <TableCell>{o.courierStatus ?? "—"}</TableCell>
                  <TableCell>{o.bookedOn ? formatBookDate(o.bookedOn) : "—"}</TableCell>
                  <TableCell align="right" className="tabular-nums">{formatPrice(o.total)}</TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
          {rows.length > 50 && <p className="px-4 py-2 text-xs text-fg-subtle">and {rows.length - 50} more</p>}
        </Card>
      )}
    </section>
  );
}
