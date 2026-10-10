"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Receipt } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import { Input } from "@/components/ui/input";
import { Table, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { EmptyState } from "@/components/admin/empty-state";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { EVENT_LABEL, STATUS } from "@/components/admin/orders/detail/accounting-section";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import { listOrders } from "@/lib/api/admin-orders";
import * as financeApi from "@/lib/api/finance";
import { formatBookDate, formatStoreDateTime } from "@/lib/format";

const statusOf = (status: string) => STATUS[status] ?? { label: status.toLowerCase(), variant: "neutral" as const };

/** An order number ("#1042" or "1042") → the order; anything that matches no number is tried as an order id. */
async function findOrderTrail(term: string) {
  const t = term.replace(/^#/, "").trim();
  const found = await listOrders({ search: t, pageSize: 5 }).catch(() => null);
  const items = found?.items ?? [];
  const hit = items.find((o) => o.orderNumber.replace(/^#/, "").toLowerCase() === t.toLowerCase()) ?? (items.length === 1 ? items[0] : null);
  const trail = await financeApi.orderAccounting(hit?.id ?? t);
  // an id the books don't know is indistinguishable from a typo — say so rather than link to a missing order
  if (!hit && trail.events.length === 0) throw new Error(`No order matches “${term}”.`);
  return { ...trail, orderNumber: hit?.orderNumber ?? null };
}

/** Sales accounting (docs/FINANCE_PHASE_3.md §10): how commerce reaches the books — the projector's state, its events,
 * and one order's accounting trail. Amounts come from the dashboard's own engine; nothing here edits commerce. */
export default function SalesAccountingPage() {
  const { can, ready } = useCapabilities();
  const queryClient = useQueryClient();
  const allowed = can("finance.view");
  const status = useQuery({ queryKey: [...financeApi.financeKeys.all, "commerce-status"], queryFn: financeApi.commerceStatus, enabled: allowed });
  const [orderTerm, setOrderTerm] = useState("");
  const [lookup, setLookup] = useState<string | null>(null);
  const trail = useQuery({ queryKey: [...financeApi.financeKeys.all, "order-trail", lookup], queryFn: () => findOrderTrail(lookup!), enabled: Boolean(lookup), retry: false });

  const sync = useMutation({
    mutationFn: (full: boolean) => financeApi.syncCommerce(full),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: financeApi.financeKeys.all });
      toast.success(r.skipped ? `Not run: ${String(r.skipped).toLowerCase().replace(/_/g, " ")}` : `${r.orders} order(s) checked · ${r.recorded} event(s) recorded · ${r.posted} posted${r.failed ? ` · ${r.failed} failed` : ""}`);
    },
    onError: (err) => toast.error(getErrorMessage(err, "The sync couldn't run")),
  });

  if (ready && !allowed) {
    return (
      <div>
        <ModuleTabs />
        <EmptyState icon={Receipt} title="Finance is limited to finance roles" />
      </div>
    );
  }
  const s = status.data;
  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader
        title="Sales accounting"
        description="Sales, payments, refunds, returns and store credit reach the books as accounting events, with the dashboard's own revenue and cost figures. Commerce is only read, never changed."
        action={
          can("finance.reconcile") && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" loading={sync.isPending && sync.variables === true} onClick={() => sync.mutate(true)}>Re-check everything</Button>
              <Button size="sm" loading={sync.isPending && sync.variables === false} onClick={() => sync.mutate(false)} data-testid="sync-now">Sync now</Button>
            </div>
          )
        }
      />
      {s && !s.readiness.ready && (
        <Alert variant="warning" title="Accounts not mapped">
          Commerce can&apos;t post until these are mapped: {s.readiness.missing.join(", ")}.
        </Alert>
      )}
      {s && !s.openingDate && <Alert variant="info" title="The books haven't started">Set the Financial Opening Date first — sales before it are carried by the opening balances.</Alert>}
      {s && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="sales-status">
          {[
            ["Books start", s.openingDate ? formatBookDate(s.openingDate) : "not set"],
            ["Last sync", s.lastRunAt ? formatStoreDateTime(s.lastRunAt) : "never"],
            ["Events posted", String(s.events.POSTED ?? 0)],
            ["Waiting / failed", `${s.events.RECEIVED ?? 0} / ${s.events.FAILED ?? 0}`],
          ].map(([label, value]) => (
            <Card key={label} className="p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">{label}</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-ink-900">{value}</p>
            </Card>
          ))}
        </div>
      )}

      <Card className="overflow-hidden p-0">
        <HScrollShadow>
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Event</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell align="right">Count</TableHeaderCell>
              </tr>
            </TableHead>
            <tbody>
              {s?.eventsByType.map((e) => (
                <TableRow key={`${e.type}-${e.status}`}>
                  <TableCell>
                    <span className="block text-ink-900">{EVENT_LABEL[e.type] ?? e.type}</span>
                    <span className="block font-mono text-[11px] text-ink-500">{e.type}</span>
                  </TableCell>
                  <TableCell><Badge variant={statusOf(e.status).variant}>{statusOf(e.status).label}</Badge></TableCell>
                  <TableCell align="right" className="tabular-nums">{e.count}</TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        </HScrollShadow>
        {s && s.eventsByType.length === 0 && <EmptyState icon={Receipt} title="Nothing in the books from commerce yet" description="Run a sync once the opening date is set." />}
      </Card>

      <Card className="space-y-3 p-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">An order&apos;s accounting trail</h2>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (orderTerm.trim()) setLookup(orderTerm.trim());
          }}
        >
          <Input aria-label="Order number" placeholder="Order number, e.g. 1042" value={orderTerm} onChange={(e) => setOrderTerm(e.target.value)} className="min-w-0 max-w-sm flex-1" />
          <Button type="submit" variant="outline" disabled={!orderTerm.trim()} loading={trail.isFetching}>Show</Button>
        </form>
        {trail.isError && <p className="text-sm text-danger-600">{getErrorMessage(trail.error)}</p>}
        {trail.data && (
          <div className="space-y-2">
            <Link href={`/admin/orders/${trail.data.orderId}`} className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
              {trail.data.orderNumber ? `Open order ${trail.data.orderNumber.startsWith("#") ? "" : "#"}${trail.data.orderNumber}` : "Open the order"}
              <ArrowUpRight size={14} aria-hidden />
            </Link>
            <ul className="divide-y divide-line-subtle text-sm" data-testid="order-trail">
              {trail.data.events.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <span className="w-24 whitespace-nowrap tabular-nums text-ink-600">{formatBookDate(e.financialDate)}</span>
                  <span className="order-last w-full min-w-0 sm:order-none sm:w-auto sm:flex-1">
                    <span className="block text-ink-900">{EVENT_LABEL[e.eventType] ?? e.eventType}</span>
                    <span className="block break-all font-mono text-[11px] text-ink-500">{e.eventKey}</span>
                  </span>
                  <Badge variant={statusOf(e.status).variant}>{statusOf(e.status).label}</Badge>
                  {e.journalEntry && (
                    <span className="text-xs text-ink-500">
                      journal #{e.journalEntry.number}
                      {e.journalEntry.reversedBy ? ` (reversed by #${e.journalEntry.reversedBy.number})` : ""}
                    </span>
                  )}
                </li>
              ))}
              {trail.data.events.length === 0 && <li className="py-2 text-ink-500">Nothing in the books for this order (not realised, or before the opening date).</li>}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
}
