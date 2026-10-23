"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, ChevronLeft, HandCoins, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import type { PaymentMethod } from "@/lib/api/finance";
import * as booksApi from "@/lib/api/finance-books";
import type { OwnerHome } from "@/lib/api/finance-books";
import { formatPrice, storeCurrencySymbol } from "@/lib/format";
import { idempotencyKeyFor, partnerPaymentScope, settleIdempotencyKey } from "@/lib/idempotency";

export type QuickAddKind = "EXPENSE" | "OWNER_OUT" | "OWNER_IN" | "PAY_PARTNER";

const today = () => new Date().toLocaleDateString("en-CA");
const OWNER_POCKET = "owner";
const PAYING = ["CASH", "BANK", "MOBILE_WALLET"];
const METHOD: Array<{ value: PaymentMethod; label: string }> = [
  { value: "BKASH", label: "bKash" }, { value: "CASH", label: "Cash" }, { value: "NAGAD", label: "Nagad" }, { value: "BANK", label: "Bank" }, { value: "OTHER", label: "Other" },
];

/**
 * One place for everyday money entries (docs/FINANCE_OWNER_HOME.md): a cost paid, the owner taking money out or
 * putting it in, paying a partner. Each is the same entry its own page makes — this is just the short way there.
 */
export function QuickAdd({ home, initial, partnerId, onClose }: { home: OwnerHome; initial?: QuickAddKind; partnerId?: string; onClose: () => void }) {
  const [kind, setKind] = useState<QuickAddKind | undefined>(initial);
  const owner = home.people?.owner?.name ?? "The owner";
  const partners = home.people?.partners ?? [];
  const choices: Array<{ kind: QuickAddKind; title: string; detail: string; icon: typeof Receipt }> = [
    { kind: "EXPENSE", title: "A cost", detail: "Packaging, delivery, ads, hosting — anything you paid for", icon: Receipt },
    { kind: "OWNER_OUT", title: `${owner} took money`, detail: "Money taken out of the business for himself", icon: ArrowUpRight },
    { kind: "OWNER_IN", title: `${owner} put money in`, detail: "His own money added to the business", icon: ArrowDownLeft },
    ...(partners.length ? [{ kind: "PAY_PARTNER" as const, title: "Pay a partner", detail: partners.map((p) => p.name).join(", "), icon: HandCoins }] : []),
  ];
  const title = kind ? choices.find((c) => c.kind === kind)!.title : "Add";

  return (
    <Modal open onClose={onClose} title={title} description={kind ? undefined : "What would you like to record?"} widthClassName="max-w-md">
      {!kind ? (
        <ul className="space-y-2" data-testid="quick-add-choices">
          {choices.map((c) => (
            <li key={c.kind}>
              <button type="button" onClick={() => setKind(c.kind)} className="flex w-full items-center gap-4 rounded-xl border border-line-subtle p-4 text-left transition-colors hover:border-accent hover:bg-accent/5" data-testid={`quick-add-${c.kind.toLowerCase()}`}>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-muted text-fg"><c.icon className="h-5 w-5" /></span>
                <span className="min-w-0"><span className="block text-[15px] font-medium text-fg">{c.title}</span><span className="block text-sm text-fg-muted">{c.detail}</span></span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="space-y-4">
          {!initial && <button type="button" onClick={() => setKind(undefined)} className="-mt-1 inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg"><ChevronLeft className="h-4 w-4" /> Back</button>}
          {kind === "EXPENSE" && <ExpenseForm owner={owner} hasOwner={Boolean(home.people?.owner)} onDone={onClose} />}
          {(kind === "OWNER_OUT" || kind === "OWNER_IN") && <OwnerMoneyForm into={kind === "OWNER_IN"} onDone={onClose} />}
          {kind === "PAY_PARTNER" && <PayPartnerForm partners={partners} initialId={partnerId} onDone={onClose} />}
        </div>
      )}
    </Modal>
  );
}

function useMoneyAccounts(kinds: string[]) {
  const q = useQuery({ queryKey: financeApi.financeKeys.accounts(), queryFn: financeApi.listFinancialAccounts });
  return { ...q, accounts: (q.data?.financialAccounts ?? []).filter((a) => a.isActive && kinds.includes(a.kind)) };
}

function useDone(onDone: () => void, message: string) {
  const qc = useQueryClient();
  return () => { toast.success(message); void qc.invalidateQueries({ queryKey: ["finance"] }); onDone(); };
}

const amountOk = (v: string) => v.trim() !== "" && Number(v) > 0;
/** Everyday costs, most common first. The rest of the chart (depreciation, payroll, adjustments…) is booked by the
 * system or from its own page. */
const EVERYDAY_COSTS = ["6800", "6600", "6500", "6400", "6410", "6100", "6300", "6900"];

function ExpenseForm({ owner, hasOwner, onDone }: { owner: string; hasOwner: boolean; onDone: () => void }) {
  const money = useMoneyAccounts(PAYING);
  const ledger = useQuery({ queryKey: financeApi.financeKeys.ledgerAccounts(), queryFn: financeApi.listLedgerAccounts });
  const expenseAccounts = useMemo(() => (ledger.data?.accounts ?? []).filter((a) => a.isPostable && a.isActive && EVERYDAY_COSTS.includes(a.code)).sort((a, b) => EVERYDAY_COSTS.indexOf(a.code) - EVERYDAY_COSTS.indexOf(b.code)), [ledger.data]);
  const cashBox = money.accounts.find((a) => a.kind === "CASH");
  // Only accounts with money in them can pay; the owner's own money passes through the cash box.
  const payFrom = money.accounts.filter((a) => a.currentBalance > 0);
  const ownerOption = hasOwner && Boolean(cashBox);
  const [amount, setAmount] = useState("");
  const [what, setWhat] = useState("");
  const [account, setAccount] = useState("");
  const [picked, setFrom] = useState("");
  const from = picked || (ownerOption ? OWNER_POCKET : "");
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");
  const done = useDone(onDone, "Cost recorded");
  const valid = amountOk(amount) && account && from && note.trim();
  const save = useMutation({
    mutationFn: async () => {
      const base = { expenseAccountId: account, amount: Number(amount), expenseDate: date, description: note.trim() };
      if (from === OWNER_POCKET) return booksApi.ownerPaidExpense({ ...base, cashFinancialAccountId: cashBox!.id, funding: "CAPITAL" }, idempotencyKeyFor("quick-add:owner-expense", base));
      return financeApi.recordExpense({ ...base, fromFinancialAccountId: from }, idempotencyKeyFor("quick-add:expense", { ...base, from }));
    },
    onSuccess: done,
    onError: (e) => toast.error(getErrorMessage(e, "The cost couldn't be recorded")),
  });
  return (
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (valid) save.mutate(); }}>
      <Field htmlFor="qa-amount" label={`Amount (${storeCurrencySymbol()})`} required><Input id="qa-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></Field>
      <Field htmlFor="qa-date" label="Date"><Input id="qa-date" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field htmlFor="qa-note" label="What was it?" required className="sm:col-span-2"><Input id="qa-note" value={note} onChange={(e) => { setNote(e.target.value); setWhat(e.target.value); }} placeholder="e.g. 200 bubble poly bags" maxLength={300} /></Field>
      <Field htmlFor="qa-account" label="Kind of cost" required className="sm:col-span-2" hint={what && !account ? "Pick the closest — it decides where it shows in profit" : undefined}>
        <Select id="qa-account" value={account} onChange={(e) => setAccount(e.target.value)} disabled={ledger.isLoading}>
          <option value="">Choose…</option>
          {expenseAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
      </Field>
      <Field htmlFor="qa-from" label="Paid from" required className="sm:col-span-2" hint={from === OWNER_POCKET ? `Counted as money ${owner} put in` : undefined}>
        <Select id="qa-from" value={from} onChange={(e) => setFrom(e.target.value)} disabled={money.isLoading}>
          <option value="">Choose…</option>
          {ownerOption && <option value={OWNER_POCKET}>{owner}&apos;s own money</option>}
          {payFrom.map((a) => <option key={a.id} value={a.id}>{a.name} ({formatPrice(a.currentBalance)})</option>)}
        </Select>
      </Field>
      <div className="flex justify-end gap-2 pt-2 sm:col-span-2">
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={!valid} loading={save.isPending} data-testid="quick-add-save">Record cost</Button>
      </div>
    </form>
  );
}

function OwnerMoneyForm({ into, onDone }: { into: boolean; onDone: () => void }) {
  const money = useMoneyAccounts(into ? [...PAYING, "AD_PLATFORM"] : PAYING);
  const choices = into ? money.accounts : money.accounts.filter((a) => a.currentBalance > 0);
  const [amount, setAmount] = useState("");
  const [account, setAccount] = useState("");
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");
  const done = useDone(onDone, into ? "Money put in recorded" : "Money taken out recorded");
  const valid = amountOk(amount) && account;
  const save = useMutation({
    mutationFn: () => {
      const body = { kind: into ? ("INVEST" as const) : ("WITHDRAW" as const), financialAccountId: account, amount: Number(amount), date, note: note.trim() || null };
      return financeApi.ownerMoney(body, idempotencyKeyFor("quick-add:owner-money", body));
    },
    onSuccess: done,
    onError: (e) => toast.error(getErrorMessage(e, "That couldn't be recorded")),
  });
  return (
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (valid) save.mutate(); }}>
      <Field htmlFor="qo-amount" label={`Amount (${storeCurrencySymbol()})`} required><Input id="qo-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></Field>
      <Field htmlFor="qo-date" label="Date"><Input id="qo-date" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field htmlFor="qo-account" label={into ? "Put into" : "Taken from"} required className="sm:col-span-2" hint={money.isLoading || choices.length ? undefined : into ? "Add a cash box, bank or bKash in Money accounts first" : "No account has money in it right now"}>
        <Select id="qo-account" value={account} onChange={(e) => setAccount(e.target.value)} disabled={money.isLoading}>
          <option value="">Choose…</option>
          {choices.map((a) => <option key={a.id} value={a.id}>{a.name}{into ? "" : ` (${formatPrice(a.currentBalance)})`}</option>)}
        </Select>
      </Field>
      <Field htmlFor="qo-note" label="Note" className="sm:col-span-2"><Input id="qo-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={into ? "e.g. for the new cap batch" : "e.g. personal use"} maxLength={300} /></Field>
      <div className="flex justify-end gap-2 pt-2 sm:col-span-2">
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={!valid} loading={save.isPending} data-testid="quick-add-save">Record</Button>
      </div>
    </form>
  );
}

function PayPartnerForm({ partners, initialId, onDone }: { partners: NonNullable<OwnerHome["people"]>["partners"]; initialId?: string; onDone: () => void }) {
  const money = useMoneyAccounts(PAYING);
  const [id, setId] = useState(initialId ?? partners.find((p) => p.owed > 0)?.id ?? partners[0]?.id ?? "");
  const partner = partners.find((p) => p.id === id);
  const [amount, setAmount] = useState(partner && partner.owed > 0 ? String(partner.owed) : "");
  const [account, setAccount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("BKASH");
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");
  const done = useDone(onDone, `Paid ${partner?.name ?? "partner"}`);
  const tooMuch = partner ? Number(amount) > partner.owed : false;
  const valid = partner && amountOk(amount) && !tooMuch && account;
  const save = useMutation({
    mutationFn: () => {
      const body = { fromFinancialAccountId: account, amount: Number(amount), paymentDate: date, method, note: note.trim() || null };
      return financeApi.payPartner(id, body, idempotencyKeyFor(partnerPaymentScope(id), body));
    },
    onSuccess: () => { settleIdempotencyKey(partnerPaymentScope(id)); done(); },
    onError: (e) => toast.error(getErrorMessage(e, "The payment couldn't be recorded")),
  });
  return (
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (valid) save.mutate(); }}>
      <Field htmlFor="qp-partner" label="Partner" className="sm:col-span-2" hint={partner ? (partner.owed > 0 ? `Owed now: ${formatPrice(partner.owed)}` : "Nothing is owed right now — shares are added when each month ends") : undefined}>
        <Select id="qp-partner" value={id} onChange={(e) => { setId(e.target.value); const p = partners.find((x) => x.id === e.target.value); setAmount(p && p.owed > 0 ? String(p.owed) : ""); }}>
          {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </Field>
      <Field htmlFor="qp-amount" label={`Amount (${storeCurrencySymbol()})`} required error={tooMuch ? "More than is owed" : undefined}><Input id="qp-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      <Field htmlFor="qp-date" label="Date"><Input id="qp-date" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field htmlFor="qp-account" label="Paid from" required hint={money.isLoading || money.accounts.some((a) => a.currentBalance > 0) ? undefined : "No account has money in it right now"}><Select id="qp-account" value={account} onChange={(e) => setAccount(e.target.value)} disabled={money.isLoading}><option value="">Choose…</option>{money.accounts.filter((a) => a.currentBalance > 0).map((a) => <option key={a.id} value={a.id}>{a.name} ({formatPrice(a.currentBalance)})</option>)}</Select></Field>
      <Field htmlFor="qp-method" label="How"><Select id="qp-method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>{METHOD.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</Select></Field>
      <Field htmlFor="qp-note" label="Note" className="sm:col-span-2"><Input id="qp-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. October share" maxLength={300} /></Field>
      <div className="flex justify-end gap-2 pt-2 sm:col-span-2">
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={!valid} loading={save.isPending} data-testid="quick-add-save">Pay</Button>
      </div>
    </form>
  );
}
