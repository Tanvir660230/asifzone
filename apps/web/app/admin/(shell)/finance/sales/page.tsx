"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Receipt } from "lucide-react";
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
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";

const STATUS_BADGE: Record<string, "success" | "warning" | "danger" | "neutral"> = { POSTED: "success", RECEIVED: "warning", FAILED: "danger", IGNORED: "neutral" };

/** Sales accounting (docs/FINANCE_PHASE_3.md §10): how commerce reaches the books — the projector's state, its events,
 * and one order's accounting trail. Amounts come from the dashboard's own engine; nothing here edits commerce. */
export default function SalesAccountingPage() {
  const { can, ready } = useCapabilities();
  const queryClient = useQueryClient();
  const allowed = can("finance.view");
  const status = useQuery({ queryKey: [...financeApi.financeKeys.all, "commerce-status"], queryFn: financeApi.commerceStatus, enabled: allowed });
  const [orderId, setOrderId] = useState("");
  const [lookup, setLookup] = useState<string | null>(null);
  const trail = useQuery({ queryKey: [...financeApi.financeKeys.all, "order-trail", lookup], queryFn: () => financeApi.orderAccounting(lookup!), enabled: Boolean(lookup) });

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
        <div className="grid gap-3 sm:grid-cols-4" data-testid="sales-status">
          {[
            ["Books start", s.openingDate ? s.openingDate.slice(0, 10) : "not set"],
            ["Last sync", s.lastRunAt ? new Date(s.lastRunAt).toLocaleString() : "never"],
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
                  <TableCell className="font-mono text-xs">{e.type}</TableCell>
                  <TableCell><Badge variant={STATUS_BADGE[e.status] ?? "neutral"}>{e.status.toLowerCase()}</Badge></TableCell>
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
        <div className="flex gap-2">
          <Input aria-label="Order id" placeholder="Order id" value={orderId} onChange={(e) => setOrderId(e.target.value)} className="max-w-sm" />
          <Button variant="outline" disabled={!orderId.trim()} onClick={() => setLookup(orderId.trim())}>Show</Button>
        </div>
        {trail.data && (
          <ul className="divide-y divide-line-subtle text-sm" data-testid="order-trail">
            {trail.data.events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-3 py-2">
                <span className="w-24 text-ink-600">{e.financialDate}</span>
                <span className="flex-1 font-mono text-xs">{e.eventKey}</span>
                <Badge variant={STATUS_BADGE[e.status] ?? "neutral"}>{e.status.toLowerCase()}</Badge>
                {e.journalEntry && <span className="text-xs text-ink-500">journal #{e.journalEntry.number}{e.journalEntry.reversedBy ? ` (reversed by #${e.journalEntry.reversedBy.number})` : ""}</span>}
              </li>
            ))}
            {trail.data.events.length === 0 && <li className="py-2 text-ink-500">Nothing in the books for this order (not realised, or before the opening date).</li>}
          </ul>
        )}
      </Card>
    </div>
  );
}
