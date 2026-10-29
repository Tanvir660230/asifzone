"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Undo2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Money } from "@/components/ui/money";
import { toast } from "@/components/ui/toast";
import { DataTable } from "@/components/admin/data-table";
import type { DataTableColumn } from "@/components/admin/data-table/types";
import { EmptyState } from "@/components/admin/empty-state";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as adminOrdersApi from "@/lib/api/admin-orders";
import type { AwaitingReturnLine } from "@/lib/api/admin-orders";
import * as financeApi from "@/lib/api/finance";
import { formatStoreDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const SOURCE: Record<AwaitingReturnLine["source"], string> = { ORDER_RETURNED: "Order returned", PARTIAL_DELIVERY: "Refused on delivery", EXCHANGE: "Exchange original", ITEM_RETURN: "Item return" };
const today = () => new Date().toLocaleDateString("en-CA");

type Act = { kind: "write-off"; line: AwaitingReturnLine } | { kind: "withdraw"; line: AwaitingReturnLine };

/**
 * Blueprint P0.4 (tab 11; owner decisions Q5, Q13, Q-B, Q-C): goods agreed back that aren't at the shop yet. Receive them on
 * the order; after the store's write-off wait one can be written off as never returned (the owner approves it at or above
 * the count-loss limit — the server decides); an item return nothing of which came back can be withdrawn (the customer
 * keeps it). Lines out past the follow-up days are marked.
 */
export function AwaitingReturns({ data, loading, error, onRetry }: { data: adminOrdersApi.AwaitingReturns | undefined; loading: boolean; error: unknown; onRetry: () => void }) {
  const [act, setAct] = useState<Act | null>(null);
  const columns: DataTableColumn<AwaitingReturnLine>[] = [
    {
      id: "order",
      header: "Order",
      card: "title",
      cell: (l) => (
        <span className="block min-w-0">
          <Link href={`/admin/orders/${l.orderId}`} className="font-medium text-fg underline-offset-2 hover:text-accent hover:underline">{l.orderNumber}</Link>
          <span className="block truncate text-xs text-fg-muted">{l.customerName} · {SOURCE[l.source]}</span>
        </span>
      ),
    },
    {
      id: "item",
      header: "Item",
      cell: (l) => (
        <span className="block min-w-0">
          <span className="block truncate text-fg">{l.productName}</span>
          <span className="block text-xs text-fg-muted">{[l.size, l.color].filter(Boolean).join(" / ")} · {l.units} to come back</span>
        </span>
      ),
    },
    { id: "value", header: "Value", align: "right", cell: (l) => <Money value={l.value} /> },
    {
      id: "out",
      header: "Agreed",
      label: "Agreed",
      cell: (l) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm text-fg">{formatStoreDate(l.agreedAt, { day: "numeric", month: "short" })}</span>
          <Badge variant={l.overdue ? "warning" : "neutral"}>{l.daysOut} day{l.daysOut === 1 ? "" : "s"}</Badge>
        </span>
      ),
    },
    {
      id: "action",
      header: <span className="sr-only">Action</span>,
      label: "Action",
      hideable: false,
      align: "right",
      cell: (l) => (
        <span className="flex flex-wrap justify-end gap-2">
          <Link href={`/admin/orders/${l.orderId}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>Receive</Link>
          {l.source === "ITEM_RETURN" && l.returnRequestId && (
            <Button variant="ghost" size="sm" onClick={() => setAct({ kind: "withdraw", line: l })}>Customer keeps it</Button>
          )}
          {l.canWriteOff && <Button variant="ghost" size="sm" onClick={() => setAct({ kind: "write-off", line: l })} data-testid="write-off-unreturned">Never came back</Button>}
        </span>
      ),
    },
  ];
  return (
    <div className="space-y-3" data-testid="awaiting-returns">
      {data && data.overdue > 0 && (
        <p className="text-sm text-warning-700">
          {data.overdue} item{data.overdue === 1 ? " has" : "s have"} been out more than {data.followUpDays} days — chase the courier or the customer. After {data.lossDays} days you can write one off as never returned.
        </p>
      )}
      <DataTable
        caption="Returns waiting to come back"
        columns={columns}
        rows={data?.lines}
        getRowId={(l) => l.expectationId}
        loading={loading}
        error={error}
        onRetry={onRetry}
        cardBelow="md"
        empty={<EmptyState icon={Undo2} title="Nothing waiting to come back" description="A return agreed while the returns rule is on shows here until its goods are received." />}
      />
      {act && <ActDialog act={act} onClose={() => setAct(null)} />}
    </div>
  );
}

function ActDialog({ act, onClose }: { act: Act; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState(act.kind === "write-off" && act.line.source === "EXCHANGE" ? "Customer kept the item" : "");
  const [tried, setTried] = useState(false);
  const ok = reason.trim().length >= 3;
  const run = useMutation({
    mutationFn: () => (act.kind === "write-off" ? adminOrdersApi.writeOffUnreturned(act.line.expectationId, reason.trim()) : adminOrdersApi.withdrawReturn(act.line.returnRequestId!, reason.trim())),
    onSuccess: () => {
      toast.success(act.kind === "write-off" ? "Written off as never returned" : "Return withdrawn — the customer keeps it");
      void qc.invalidateQueries({ queryKey: ["orders"] });
      onClose();
    },
  });
  const writeOff = act.kind === "write-off";
  return (
    <Modal
      open
      onClose={onClose}
      title={writeOff ? "Never came back" : "Customer keeps it"}
      description={
        writeOff
          ? `${act.line.units} × ${act.line.productName} on ${act.line.orderNumber} is written off as a loss at its recorded cost. Large amounts need the owner.`
          : `The return on ${act.line.orderNumber} is withdrawn: the customer keeps the items and the order charges them again.`
      }
      widthClassName="max-w-md"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant={writeOff ? "destructive" : "primary"} loading={run.isPending} onClick={() => { setTried(true); if (ok) run.mutate(); }} data-testid="act-confirm">
            {writeOff ? "Write off" : "Withdraw return"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {run.isError && <Alert variant="danger" title={writeOff ? "Not written off" : "Not withdrawn"}>{getErrorMessage(run.error, "Try again.")}</Alert>}
        <Field htmlFor="act-reason" label="Reason" required error={tried && !ok ? "Say why (3 characters or more)" : undefined}>
          <Input id="act-reason" maxLength={writeOff ? 200 : 300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={writeOff ? "e.g. Lost by the courier" : "e.g. Customer decided to keep it"} />
        </Field>
      </div>
    </Modal>
  );
}

/**
 * The returns rule itself (tab 11 §7): off until the owner turns it on from a date — after the closed-month comparison on a
 * private copy. Everyone sees whether it is on; only the owner (finance.configure) changes it. Never backdated.
 */
export function ReturnsRuleCard() {
  const qc = useQueryClient();
  const { can } = useCapabilities();
  const owner = can("finance.configure");
  const rule = useQuery({ queryKey: adminOrdersApi.returnsRuleKey, queryFn: adminOrdersApi.getReturnsRule });
  const [date, setDate] = useState(today());
  const save = useMutation({
    mutationFn: (value: string | null) => financeApi.updateBusiness({ returnsReceiptRuleEffectiveDate: value, reason: value ? "Owner turned the returns rule on" : "Owner turned the returns rule off" }),
    onSuccess: (_d, value) => {
      toast.success(value ? "Returns rule set" : "Returns rule turned off");
      void qc.invalidateQueries({ queryKey: adminOrdersApi.returnsRuleKey });
      void qc.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (err) => toast.error(getErrorMessage(err, "Couldn't change the returns rule")),
  });
  if (!rule.data) return null;
  const { active, effectiveAt } = rule.data;
  const scheduled = !active && effectiveAt;
  return (
    <Card className="flex flex-wrap items-end justify-between gap-3 p-4" data-testid="returns-rule">
      <div className="min-w-0 max-w-prose">
        <p className="text-sm font-semibold text-fg">
          Returns rule: {active ? `on since ${formatStoreDate(effectiveAt!)}` : scheduled ? `starts ${formatStoreDate(effectiveAt!)}` : "off"}
        </p>
        <p className="text-sm text-fg-muted">
          {active || scheduled
            ? "A return agreed from then waits here and goes back into stock only when it is received."
            : "Returns go back into stock when they are approved. The owner turns this on once the books are checked."}
        </p>
      </div>
      {owner && (
        <div className="flex flex-wrap items-end gap-2">
          {!active && !scheduled && (
            <Field htmlFor="returns-rule-date" label="Start on" className="w-40">
              <Input id="returns-rule-date" type="date" min={today()} value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          )}
          {active || scheduled ? (
            <Button variant="outline" size="sm" loading={save.isPending} onClick={() => save.mutate(null)}>Turn off</Button>
          ) : (
            <Button size="sm" loading={save.isPending} disabled={!date} onClick={() => save.mutate(date)} data-testid="returns-rule-on">Turn on</Button>
          )}
        </div>
      )}
    </Card>
  );
}
