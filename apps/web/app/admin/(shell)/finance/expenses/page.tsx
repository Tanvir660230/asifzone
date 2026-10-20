"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Receipt } from "lucide-react";
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
import { useCreateParam } from "@/hooks/use-create-param";
import { getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import * as booksApi from "@/lib/api/finance-books";
import type { Commitment, CommitmentFrequency, CommitmentPeriod, CostBehaviour } from "@/lib/api/finance";
import { formatPrice } from "@/lib/format";

const PERIOD_BADGE: Record<CommitmentPeriod["status"], { variant: "success" | "warning" | "danger" | "neutral"; label: string }> = {
  PAID: { variant: "success", label: "paid" }, AWAITING_APPROVAL: { variant: "warning", label: "awaiting approval" }, OVERDUE: { variant: "danger", label: "overdue" }, DUE: { variant: "neutral", label: "due" },
};
const STATUS_LABEL: Record<string, string> = { POSTED: "paid", PENDING_APPROVAL: "awaiting approval", REJECTED: "rejected", REVERSED: "reversed" };
const FREQ_LABEL: Record<CommitmentFrequency, string> = { MONTHLY: "monthly", QUARTERLY: "quarterly", YEARLY: "yearly" };
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random()}`);

/** Expenses and recurring commitments (docs/FINANCE_EXPENSES.md): operating costs paid from cash, a bank or a wallet,
 * and the costs owed every period — what is due, overdue and paid, the fixed monthly base and the break-even revenue. */
export default function ExpensesPage() {
  const { can, ready } = useCapabilities();
  const queryClient = useQueryClient();
  const allowed = can("finance.view");
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [recording, setRecording] = useState<{ commitment?: Commitment; period?: CommitmentPeriod } | null>(null);
  const [newCommitment, setNewCommitment] = useState(false);
  useCreateParam("expense", () => setRecording({}));
  const period = { from: from || undefined, to: to || undefined };
  const summary = useQuery({ queryKey: financeApi.expenseKeys.summary(period), queryFn: () => financeApi.getExpenseSummary(period), enabled: allowed && !(from && to && from > to) });
  const list = useQuery({ queryKey: financeApi.expenseKeys.list({ ...period, pageSize: 100 }), queryFn: () => financeApi.listExpenses({ ...period, pageSize: 100 }), enabled: allowed && !(from && to && from > to) });
  const commitments = useQuery({ queryKey: financeApi.expenseKeys.commitments(), queryFn: financeApi.listCommitments, enabled: allowed });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["finance"] });

  if (ready && !allowed) {
    return (
      <div>
        <ModuleTabs />
        <EmptyState icon={Receipt} title="Expenses aren't available to your role" />
      </div>
    );
  }
  const s = summary.data;
  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader
        title="Expenses"
        description="Operating costs paid from cash, a bank or a wallet, and what you owe every month. Costs bought on credit are supplier bills."
        action={can("finance.transact") && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setNewCommitment(true)} data-testid="new-commitment">Recurring cost</Button>
            <Button size="sm" onClick={() => setRecording({})} data-testid="record-expense"><Plus className="h-4 w-4" /> Record expense</Button>
          </div>
        )}
      />

      <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Spent this period" value={s ? formatPrice(s.totals.total) : "…"} hint={s ? `${formatPrice(s.totals.fixed)} fixed · ${formatPrice(s.totals.variable)} variable` : undefined} />
        <Stat label="Fixed costs a month" value={s ? formatPrice(s.fixedMonthlyCommitments) : "…"} hint="From recurring costs" />
        <Stat label="Gross margin" value={s ? (s.grossMarginPct === null ? "—" : `${s.grossMarginPct}%`) : "…"} hint="Same period, from the books" />
        <Stat label="Break-even sales a month" value={s ? (s.breakEvenMonthlyRevenue === null ? "—" : formatPrice(s.breakEvenMonthlyRevenue)) : "…"} hint={s && s.breakEvenMonthlyRevenue === null ? "Needs sales with a margin in the period" : "Fixed costs ÷ gross margin"} />
      </dl>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-ink-900">Recurring costs</h2>
        {commitments.isLoading && <Skeleton className="h-24 w-full" />}
        {commitments.isError && <Alert variant="danger" title="Recurring costs couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => commitments.refetch()}>Retry</Button>}>{getErrorMessage(commitments.error, "")}</Alert>}
        {commitments.data && (commitments.data.commitments.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {commitments.data.commitments.map((c) => (
              <Card key={c.id} className="space-y-3 p-4" data-testid="commitment-card">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-ink-900">{c.name}</p>
                    <p className="text-xs text-ink-500">{formatPrice(c.amount)} {FREQ_LABEL[c.frequency]} on day {c.dayOfMonth} · {c.expenseAccount.code} {c.expenseAccount.name} · {c.costBehaviour === "FIXED" ? "fixed" : "variable"}{c.payee ? ` · ${c.payee}` : ""}</p>
                  </div>
                </div>
                <ul className="space-y-1.5 text-sm">
                  {c.schedule.map((p) => (
                    <li key={p.periodKey} className="flex flex-wrap items-center justify-between gap-2">
                      <span className="tabular-nums text-ink-700">{p.dueDate}</span>
                      <span className="flex items-center gap-2">
                        <Badge variant={PERIOD_BADGE[p.status].variant}>{PERIOD_BADGE[p.status].label}</Badge>
                        {(p.status === "DUE" || p.status === "OVERDUE") && can("finance.transact") && <Button size="sm" variant="outline" onClick={() => setRecording({ commitment: c, period: p })}>Pay</Button>}
                        {p.expense && <span className="text-xs text-ink-500">{p.expense.number}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        ) : (
          <p className="text-sm text-ink-600">No recurring costs yet — add rent, salaries or subscriptions to see what is due each month.</p>
        ))}
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-lg font-semibold text-ink-900">Expenses</h2>
          <div className="flex gap-3">
            <Field htmlFor="ex-from" label="From" className="w-40"><Input id="ex-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field htmlFor="ex-to" label="To" className="w-40" error={from && to && from > to ? "Before From" : undefined}><Input id="ex-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          </div>
        </div>
        {list.isLoading && <Skeleton className="h-32 w-full" />}
        {list.isError && <Alert variant="danger" title="Expenses couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => list.refetch()}>Retry</Button>}>{getErrorMessage(list.error, "")}</Alert>}
        {list.data && (list.data.expenses.length ? (
          <Card className="divide-y divide-line p-0 text-sm">
            {list.data.expenses.map((e) => (
              <div key={e.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-2.5" data-testid="expense-row">
                <span className="min-w-0">
                  <span className="text-ink-900">{e.description}</span>
                  <span className="block text-xs text-ink-500">{e.number} · {e.expenseDate} · {e.expenseAccount.code} {e.expenseAccount.name}{e.paidFrom ? ` · from ${e.paidFrom.name}` : ""}{e.payee ? ` · ${e.payee}` : ""}</span>
                </span>
                <span className="text-right">
                  <span className={e.status === "POSTED" ? "font-medium tabular-nums text-ink-900" : "tabular-nums text-ink-500 line-through"}>{formatPrice(e.amount)}</span>
                  <span className="block text-xs text-ink-500">{e.costBehaviour === "FIXED" ? "fixed" : "variable"} · {STATUS_LABEL[e.status] ?? e.status}</span>
                </span>
              </div>
            ))}
          </Card>
        ) : (
          <EmptyState icon={Receipt} title="No expenses in this period" description="Record what the business pays for — rent, packaging, ads." />
        ))}
      </section>

      {recording && <ExpenseModal preset={recording} onClose={() => setRecording(null)} onDone={() => { setRecording(null); refresh(); }} />}
      {newCommitment && <CommitmentModal onClose={() => setNewCommitment(false)} onDone={() => { setNewCommitment(false); refresh(); }} />}
    </div>
  );
}

function useAccounts() {
  const chart = useQuery({ queryKey: financeApi.ledgerKeys.chart(), queryFn: financeApi.listChart });
  const money = useQuery({ queryKey: ["finance", "financial-accounts"], queryFn: financeApi.listFinancialAccounts });
  const expense = useMemo(() => (chart.data?.accounts ?? []).filter((a) => a.isPostable && a.isActive && !a.restricted && (a.type === "EXPENSE" || a.type === "OTHER_EXPENSE")), [chart.data]);
  const paying = useMemo(() => (money.data?.financialAccounts ?? []).filter((a) => a.isActive && ["CASH", "BANK", "MOBILE_WALLET"].includes(a.kind)), [money.data]);
  return { expense, paying, loading: chart.isLoading || money.isLoading };
}

function ExpenseModal({ preset, onClose, onDone }: { preset: { commitment?: Commitment; period?: CommitmentPeriod }; onClose: () => void; onDone: () => void }) {
  const { expense, paying } = useAccounts();
  const c = preset.commitment;
  const [accountId, setAccountId] = useState(c?.expenseAccount.id ?? "");
  const [amount, setAmount] = useState(c ? String(c.amount) : "");
  const [fromId, setFromId] = useState(c?.financialAccount?.id ?? "");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [behaviour, setBehaviour] = useState<CostBehaviour>(c?.costBehaviour ?? "VARIABLE");
  const [description, setDescription] = useState(c && preset.period ? `${c.name} — ${preset.period.periodKey}` : "");
  const [payee, setPayee] = useState(c?.payee ?? "");
  const [reference, setReference] = useState("");
  // Owner's books §2: paid from the owner's own pocket — owed back to them, or added as their capital.
  const [pocket, setPocket] = useState<"" | "REIMBURSE" | "CAPITAL">("");
  const [key] = useState(newKey);
  const value = Number(amount);
  const cashAccounts = paying.filter((a) => a.kind === "CASH");
  const valid = Boolean(accountId) && Boolean(fromId) && value > 0 && (Boolean(c) || description.trim().length > 0) && (!pocket || cashAccounts.some((a) => a.id === fromId));
  const save = useMutation({
    mutationFn: () => pocket
      ? booksApi.ownerPaidExpense({ cashFinancialAccountId: fromId, expenseAccountId: accountId, amount: value, expenseDate: date, description: description.trim() || (c ? c.name : "Expense"), payee: payee.trim() || null, reference: reference.trim() || null, funding: pocket }, key)
      : financeApi.recordExpense({
      expenseDate: date, expenseAccountId: accountId, amount: value, fromFinancialAccountId: fromId, costBehaviour: behaviour, description: description.trim() || null, payee: payee.trim() || null, reference: reference.trim() || null,
      ...(c && preset.period ? { commitmentId: c.id, periodKey: preset.period.periodKey } : {}),
    }, key),
    onSuccess: (r) => { toast.success(r.expense.status === "POSTED" ? `${r.expense.number} paid` : `${r.expense.number} waits for approval in Money accounts`); onDone(); },
    onError: (err) => toast.error(getErrorMessage(err, "The expense couldn't be recorded")),
  });
  return (
    <Modal open onClose={onClose} title={c ? `Pay ${c.name}${preset.period ? ` — ${preset.period.periodKey}` : ""}` : "Record an expense"} description="The money leaves the account you choose now. Large payments wait for approval." widthClassName="max-w-lg"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()} data-testid="confirm-expense">Pay {value > 0 ? formatPrice(value) : ""}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field htmlFor="ex-acc" label="Expense" required className="sm:col-span-2">
          <Select id="ex-acc" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Choose…</option>
            {expense.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
          </Select>
        </Field>
        <Field htmlFor="ex-amount" label="Amount" required><Input id="ex-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field htmlFor="ex-date" label="Date"><Input id="ex-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        {!c && (
          <Field htmlFor="ex-pocket" label="Whose money" className="sm:col-span-2" hint={pocket ? "It passes through the cash account you choose — the owner's money in, the expense out" : undefined}>
            <Select id="ex-pocket" value={pocket} onChange={(e) => { setPocket(e.target.value as "" | "REIMBURSE" | "CAPITAL"); setFromId(""); }} data-testid="expense-pocket">
              <option value="">The business’s</option>
              <option value="REIMBURSE">The owner’s own pocket — repay later</option>
              <option value="CAPITAL">The owner’s own pocket — keep it in the business</option>
            </Select>
          </Field>
        )}
        <Field htmlFor="ex-from-acc" label={pocket ? "Through cash account" : "Paid from"} required>
          <Select id="ex-from-acc" value={fromId} onChange={(e) => setFromId(e.target.value)}>
            <option value="">Choose…</option>
            {(pocket ? cashAccounts : paying).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
        <Field htmlFor="ex-beh" label="Cost behaviour" hint="Fixed costs don't change with sales">
          <Select id="ex-beh" value={behaviour} onChange={(e) => setBehaviour(e.target.value as CostBehaviour)}>
            <option value="VARIABLE">Variable</option>
            <option value="FIXED">Fixed</option>
          </Select>
        </Field>
        <Field htmlFor="ex-desc" label="Description" required={!c} className="sm:col-span-2"><Input id="ex-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} /></Field>
        <Field htmlFor="ex-payee" label="Paid to"><Input id="ex-payee" value={payee} onChange={(e) => setPayee(e.target.value)} maxLength={200} /></Field>
        <Field htmlFor="ex-ref" label="Reference" hint="Receipt or cheque number"><Input id="ex-ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} /></Field>
        {paying.length === 0 && <Alert variant="warning" title="No cash, bank or wallet account yet" className="sm:col-span-2">Add one in Finance → Money → Money accounts.</Alert>}
      </div>
    </Modal>
  );
}

function CommitmentModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { expense, paying } = useAccounts();
  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState<CommitmentFrequency>("MONTHLY");
  const [day, setDay] = useState("1");
  const [start, setStart] = useState(() => new Date().toISOString().slice(0, 10));
  const [behaviour, setBehaviour] = useState<CostBehaviour>("FIXED");
  const [fromId, setFromId] = useState("");
  const [payee, setPayee] = useState("");
  const d = Number(day);
  const valid = name.trim().length >= 2 && Boolean(accountId) && Number(amount) > 0 && Number.isInteger(d) && d >= 1 && d <= 28 && Boolean(start);
  const save = useMutation({
    mutationFn: () => financeApi.createCommitment({ name: name.trim(), expenseAccountId: accountId, amount: Number(amount), frequency, dayOfMonth: d, startDate: start, costBehaviour: behaviour, financialAccountId: fromId || null, payee: payee.trim() || null }),
    onSuccess: (c) => { toast.success(`${c.name} added`); onDone(); },
    onError: (err) => toast.error(getErrorMessage(err, "The recurring cost couldn't be saved")),
  });
  return (
    <Modal open onClose={onClose} title="Recurring cost" description="Rent, salaries, subscriptions — anything owed every period. Nothing is paid until you pay a period." widthClassName="max-w-lg"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()} data-testid="confirm-commitment">Add</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field htmlFor="cm-name" label="Name" required className="sm:col-span-2"><Input id="cm-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Shop rent" maxLength={120} /></Field>
        <Field htmlFor="cm-acc" label="Expense" required className="sm:col-span-2">
          <Select id="cm-acc" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Choose…</option>
            {expense.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
          </Select>
        </Field>
        <Field htmlFor="cm-amount" label="Amount" required><Input id="cm-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field htmlFor="cm-freq" label="Every">
          <Select id="cm-freq" value={frequency} onChange={(e) => setFrequency(e.target.value as CommitmentFrequency)}>
            <option value="MONTHLY">Month</option>
            <option value="QUARTERLY">Quarter</option>
            <option value="YEARLY">Year</option>
          </Select>
        </Field>
        <Field htmlFor="cm-day" label="Due on day" hint="1–28" error={day && !(d >= 1 && d <= 28) ? "1–28" : undefined}><Input id="cm-day" inputMode="numeric" value={day} onChange={(e) => setDay(e.target.value)} /></Field>
        <Field htmlFor="cm-start" label="From"><Input id="cm-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field htmlFor="cm-beh" label="Cost behaviour">
          <Select id="cm-beh" value={behaviour} onChange={(e) => setBehaviour(e.target.value as CostBehaviour)}>
            <option value="FIXED">Fixed</option>
            <option value="VARIABLE">Variable</option>
          </Select>
        </Field>
        <Field htmlFor="cm-from" label="Usually paid from">
          <Select id="cm-from" value={fromId} onChange={(e) => setFromId(e.target.value)}>
            <option value="">—</option>
            {paying.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
        <Field htmlFor="cm-payee" label="Paid to" className="sm:col-span-2"><Input id="cm-payee" value={payee} onChange={(e) => setPayee(e.target.value)} maxLength={200} /></Field>
      </div>
    </Modal>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <dt className="text-sm text-ink-600">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums text-ink-900">{value}</dd>
      {hint && <dd className="text-xs text-ink-500">{hint}</dd>}
    </Card>
  );
}
