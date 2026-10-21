"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Plus } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { EmptyState } from "@/components/admin/empty-state";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import * as booksApi from "@/lib/api/finance-books";
import type { PrepaidCost } from "@/lib/api/finance-books";
import { formatBookDate, formatPrice } from "@/lib/format";
import { idempotencyKeyFor, settleIdempotencyKey } from "@/lib/idempotency";

const today = () => new Date().toLocaleDateString("en-CA");
const STATUS: Record<PrepaidCost["status"], { label: string; variant: "success" | "warning" | "danger" | "neutral" }> = {
  RUNNING: { label: "in use", variant: "success" }, ENDING_SOON: { label: "ending soon", variant: "warning" }, FINISHED: { label: "used up", variant: "neutral" },
  AWAITING_PAYMENT: { label: "payment waiting", variant: "warning" }, NOT_PAID: { label: "not paid", variant: "danger" },
};

/** Owner's books §6.1: costs paid now for a period — each month carries its own share, with what is left and renewals. */
export default function PrepaidPage() {
  const { can, ready } = useCapabilities();
  const queryClient = useQueryClient();
  const allowed = can("finance.view");
  const list = useQuery({ queryKey: booksApi.booksKeys.prepaid(), queryFn: booksApi.listPrepaid, enabled: allowed });
  const [adding, setAdding] = useState(false);
  const [ending, setEnding] = useState<PrepaidCost | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["finance"] });

  if (ready && !allowed) return <div><ModuleTabs /><EmptyState icon={CalendarClock} title="Prepaid costs aren't available to your role" /></div>;
  const d = list.data;
  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader
        title="Prepaid costs"
        description="A year of hosting, a domain, rent in advance: paid once, then used up month by month — so each month's profit carries its share."
        action={can("finance.transact") && <Button size="sm" onClick={() => setAdding(true)} data-testid="new-prepaid"><Plus className="h-4 w-4" /> Prepaid cost</Button>}
      />
      {list.isLoading && <Skeleton className="h-40 w-full" />}
      {list.isError && <Alert variant="danger" title="Prepaid costs couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => list.refetch()}>Retry</Button>}>{getErrorMessage(list.error, "")}</Alert>}
      {d && (d.prepaid.length === 0 ? (
        <EmptyState icon={CalendarClock} title="Nothing prepaid yet" description="Add hosting, the domain or advance rent with the dates it covers." />
      ) : (
        <>
          <p className="text-sm text-fg-muted">Still to be used: <span className="font-medium tabular-nums text-fg">{formatPrice(d.totals.remaining)}</span>{d.totals.endingSoon ? ` · ${d.totals.endingSoon} ending within 30 days` : ""}</p>
          <div className="grid gap-3 lg:grid-cols-2">
            {d.prepaid.map((p) => {
              const usedPct = p.amount ? Math.min(100, Math.round((p.used / p.amount) * 100)) : 0;
              return (
                <Card key={p.id} className="space-y-3 p-4 sm:p-5" data-testid="prepaid-card">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-fg">{p.name}</p>
                      <p className="text-xs text-fg-muted">{p.number} · {p.expenseAccount.name}{p.payee ? ` · ${p.payee}` : ""} · paid {formatBookDate(p.paidOn)}{p.paidFrom ? ` from ${p.paidFrom.name}` : ""}</p>
                    </div>
                    <Badge variant={STATUS[p.status].variant}>{STATUS[p.status].label}</Badge>
                  </div>
                  <div>
                    <div className="h-2 overflow-hidden rounded-full bg-ink-100" role="progressbar" aria-valuenow={usedPct} aria-valuemin={0} aria-valuemax={100} aria-label={`${usedPct}% used`}>
                      <div className="h-full rounded-full bg-accent" style={{ width: `${usedPct}%` }} />
                    </div>
                    <div className="mt-1.5 flex flex-wrap justify-between gap-2 text-xs text-fg-muted">
                      <span>Used {formatPrice(p.used)} of {formatPrice(p.amount)}</span>
                      <span>{formatBookDate(p.serviceStart)} → {formatBookDate(p.serviceEnd)}{p.daysLeft ? ` · ${p.daysLeft} days left` : ""}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="text-fg-muted">About {formatPrice(p.perMonth)} a month</span>
                    {can("finance.transact") && p.status !== "FINISHED" && <Button size="sm" variant="outline" onClick={() => setEnding(p)}>End early</Button>}
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      ))}
      {adding && <PrepaidModal onClose={() => setAdding(false)} onDone={() => { setAdding(false); refresh(); }} />}
      {ending && <EndModal prepaid={ending} onClose={() => setEnding(null)} onDone={() => { setEnding(null); refresh(); }} />}
    </div>
  );
}

function PrepaidModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const chart = useQuery({ queryKey: financeApi.ledgerKeys.chart(), queryFn: financeApi.listChart });
  const money = useQuery({ queryKey: financeApi.financeKeys.accounts(), queryFn: financeApi.listFinancialAccounts });
  const expense = useMemo(() => (chart.data?.accounts ?? []).filter((a) => a.isPostable && a.isActive && !a.restricted && (a.type === "EXPENSE" || a.type === "OTHER_EXPENSE")), [chart.data]);
  const paying = (money.data?.financialAccounts ?? []).filter((a) => a.isActive && ["CASH", "BANK", "MOBILE_WALLET"].includes(a.kind));
  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [start, setStart] = useState(today());
  const [end, setEnd] = useState("");
  const [fromId, setFromId] = useState("");
  const [payee, setPayee] = useState("");
  const [remind, setRemind] = useState("30");
  const [renewal, setRenewal] = useState("");
  const body = {
    name: name.trim(), expenseAccountId: accountId, amount: Number(amount), serviceStart: start, serviceEnd: end, fromFinancialAccountId: fromId, paidOn: today(), payee: payee.trim() || null,
    remindDaysBefore: Number(remind) || 0, renewalAmount: Number(renewal) > 0 ? Number(renewal) : null,
  };
  const valid = Boolean(name.trim() && accountId && fromId && start && end && end >= start) && Number(amount) > 0;
  const save = useMutation({
    mutationFn: () => booksApi.createPrepaid(body, idempotencyKeyFor("prepaid", body)),
    onSuccess: (r) => { settleIdempotencyKey("prepaid"); toast.success(r.prepaid.paymentStatus === "POSTED" ? `${r.prepaid.number} paid` : `${r.prepaid.number} — its payment waits for approval`); onDone(); },
    onError: (e) => toast.error(getErrorMessage(e, "The prepaid cost couldn't be saved")),
  });
  return (
    <Modal open onClose={onClose} title="Prepaid cost" description="Paid now from the account you choose; used up over the dates it covers." widthClassName="max-w-lg"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!valid} loading={save.isPending} onClick={() => save.mutate()} data-testid="save-prepaid">Pay {Number(amount) > 0 ? formatPrice(Number(amount)) : ""}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field htmlFor="pp-name" label="What" required className="sm:col-span-2"><Input id="pp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="VPS hosting — 1 year" maxLength={160} /></Field>
        <Field htmlFor="pp-acc" label="Expense it belongs to" required className="sm:col-span-2">
          <Select id="pp-acc" value={accountId} onChange={(e) => setAccountId(e.target.value)}><option value="">Choose…</option>{expense.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</Select>
        </Field>
        <Field htmlFor="pp-amount" label="Amount" required><Input id="pp-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field htmlFor="pp-from" label="Paid from" required>
          <Select id="pp-from" value={fromId} onChange={(e) => setFromId(e.target.value)}><option value="">Choose…</option>{paying.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
        </Field>
        <Field htmlFor="pp-start" label="Covers from" required><Input id="pp-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field htmlFor="pp-end" label="Until" required error={end && end < start ? "Before the start" : undefined}><Input id="pp-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        <Field htmlFor="pp-payee" label="Paid to" className="sm:col-span-2"><Input id="pp-payee" value={payee} onChange={(e) => setPayee(e.target.value)} maxLength={200} /></Field>
        <Field htmlFor="pp-remind" label="Remind me (days before the end)"><Input id="pp-remind" inputMode="numeric" value={remind} onChange={(e) => setRemind(e.target.value.replace(/\D/g, "").slice(0, 3))} /></Field>
        <Field htmlFor="pp-renewal" label="Renewal expected to cost" hint="Optional"><Input id="pp-renewal" inputMode="decimal" value={renewal} onChange={(e) => setRenewal(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function EndModal({ prepaid, onClose, onDone }: { prepaid: PrepaidCost; onClose: () => void; onDone: () => void }) {
  const [end, setEnd] = useState(today());
  const save = useMutation({
    mutationFn: () => booksApi.updatePrepaid(prepaid.id, { serviceEnd: end }),
    onSuccess: () => { toast.success("Ended — what was left is booked in that month"); onDone(); },
    onError: (e) => toast.error(getErrorMessage(e, "Couldn't end it")),
  });
  return (
    <Modal open onClose={onClose} title={`End ${prepaid.name} early`} description="Cancelled, or replaced by something else: what is left is booked as a cost in the ending month." widthClassName="max-w-sm"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!end || end < prepaid.serviceStart} loading={save.isPending} onClick={() => save.mutate()}>End it</Button></>}>
      <Field htmlFor="pe-end" label="Last day of use"><Input id="pe-end" type="date" value={end} min={prepaid.serviceStart} onChange={(e) => setEnd(e.target.value)} /></Field>
    </Modal>
  );
}
