"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, ChevronLeft, HandCoins, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/toast";
import { getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import type { PaymentMethod } from "@/lib/api/finance";
import * as booksApi from "@/lib/api/finance-books";
import type { OwnerHome } from "@/lib/api/finance-books";
import { formatPrice } from "@/lib/format";
import { idempotencyKeyFor, partnerPaymentScope, settleIdempotencyKey } from "@/lib/idempotency";
import { AccountChips, AmountInput, ChoiceChips } from "./glass";

export type QuickAddKind = "EXPENSE" | "OWNER_OUT" | "OWNER_IN" | "PAY_PARTNER";

const today = () => new Date().toLocaleDateString("en-CA");
const OWNER_POCKET = "owner";
const PAYING = ["CASH", "BANK", "MOBILE_WALLET"];
const METHOD: Array<{ value: PaymentMethod; label: string }> = [
  { value: "BKASH", label: "bKash" }, { value: "CASH", label: "Cash" }, { value: "NAGAD", label: "Nagad" }, { value: "BANK", label: "Bank" }, { value: "OTHER", label: "Other" },
];

/**
 * One place for everyday money entries (docs/FINANCE_OWNER_HOME.md): a cost paid, the owner taking money out or
 * putting it in, paying a partner. Each is the same entry its own page makes — this is just the short way there, in the
 * Money "Liquid Glass" look: the amount first and large, then every choice a tap (no drop-downs), date and note last.
 */
export function QuickAdd({ home, initial, partnerId, onClose }: { home: OwnerHome; initial?: QuickAddKind; partnerId?: string; onClose: () => void }) {
  const [kind, setKind] = useState<QuickAddKind | undefined>(initial);
  const owner = home.people?.owner?.name ?? "The owner";
  const partners = home.people?.partners ?? [];
  const choices: Array<{ kind: QuickAddKind; title: string; detail: string; icon: typeof Receipt }> = [
    { kind: "EXPENSE", title: "An expense", detail: "Packaging, delivery, ads, hosting — anything you paid for", icon: Receipt },
    { kind: "OWNER_IN", title: `${owner} put money in`, detail: "Their own money added to the business", icon: ArrowDownLeft },
    { kind: "OWNER_OUT", title: `${owner} took money out`, detail: "Money taken out of the business for personal use", icon: ArrowUpRight },
    ...(partners.length ? [{ kind: "PAY_PARTNER" as const, title: "Pay a partner", detail: partners.map((p) => p.name).join(", "), icon: HandCoins }] : []),
  ];
  const title = kind ? choices.find((c) => c.kind === kind)!.title : "New";

  return (
    <Modal open onClose={onClose} title={title} description={kind ? undefined : "What would you like to record?"} widthClassName="max-w-lg">
      <div data-area="finance">
        {!kind ? (
          <ul className="grid gap-3 sm:grid-cols-2" data-testid="quick-add-choices">
            {choices.map((c) => (
              <li key={c.kind}>
                <button type="button" onClick={() => setKind(c.kind)} className="liquid group flex h-full w-full flex-col items-start gap-3 p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50" data-testid={`quick-add-${c.kind.toLowerCase()}`}>
                  <span className="liquid-key h-11 w-11"><c.icon className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" /></span>
                  <span className="min-w-0"><span className="block text-[15px] font-semibold text-fg">{c.title}</span><span className="mt-0.5 block text-sm text-fg-muted">{c.detail}</span></span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="space-y-5">
            {!initial && <button type="button" onClick={() => setKind(undefined)} className="-mt-1 inline-flex min-h-11 items-center gap-1 text-sm text-fg-muted hover:text-fg"><ChevronLeft className="h-4 w-4" aria-hidden="true" /> Back</button>}
            {kind === "EXPENSE" && <ExpenseForm owner={owner} hasOwner={Boolean(home.people?.owner)} onDone={onClose} />}
            {(kind === "OWNER_OUT" || kind === "OWNER_IN") && <OwnerMoneyForm into={kind === "OWNER_IN"} onDone={onClose} />}
            {kind === "PAY_PARTNER" && <PayPartnerForm partners={partners} initialId={partnerId} onDone={onClose} />}
          </div>
        )}
      </div>
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

/** Date and note: the rarely-changed details, after the choices. */
function DateAndNote({ idPrefix, date, onDate, note, onNote, noteLabel, notePlaceholder, noteRequired }: { idPrefix: string; date: string; onDate: (v: string) => void; note: string; onNote: (v: string) => void; noteLabel: string; notePlaceholder: string; noteRequired?: boolean }) {
  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
      <Field htmlFor={`${idPrefix}-note`} label={noteLabel} required={noteRequired}><Input id={`${idPrefix}-note`} value={note} onChange={(e) => onNote(e.target.value)} placeholder={notePlaceholder} maxLength={300} /></Field>
      <Field htmlFor={`${idPrefix}-date`} label="Date"><Input id={`${idPrefix}-date`} type="date" value={date} max={today()} onChange={(e) => onDate(e.target.value)} /></Field>
    </div>
  );
}

function Actions({ onCancel, disabled, loading, label }: { onCancel: () => void; disabled: boolean; loading: boolean; label: string }) {
  return (
    <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
      <Button type="button" variant="outline" className="rounded-full" onClick={onCancel}>Cancel</Button>
      <Button type="submit" size="lg" className="rounded-full sm:min-w-40" disabled={disabled} loading={loading} data-testid="quick-add-save">{label}</Button>
    </div>
  );
}

function ExpenseForm({ owner, hasOwner, onDone }: { owner: string; hasOwner: boolean; onDone: () => void }) {
  const money = useMoneyAccounts(PAYING);
  const ledger = useQuery({ queryKey: financeApi.financeKeys.ledgerAccounts(), queryFn: financeApi.listLedgerAccounts });
  const expenseAccounts = useMemo(() => (ledger.data?.accounts ?? []).filter((a) => a.isPostable && a.isActive && EVERYDAY_COSTS.includes(a.code)).sort((a, b) => EVERYDAY_COSTS.indexOf(a.code) - EVERYDAY_COSTS.indexOf(b.code)), [ledger.data]);
  const cashBox = money.accounts.find((a) => a.kind === "CASH");
  // Only accounts with money in them can pay; the owner's own money passes through the cash box.
  const payFrom = money.accounts.filter((a) => a.currentBalance > 0);
  const ownerOption = hasOwner && Boolean(cashBox);
  const [amount, setAmount] = useState("");
  const [account, setAccount] = useState("");
  const [picked, setFrom] = useState("");
  const from = picked || (ownerOption ? OWNER_POCKET : "");
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");
  const done = useDone(onDone, "Expense recorded");
  const valid = amountOk(amount) && account && from && note.trim();
  const save = useMutation({
    mutationFn: async () => {
      const base = { expenseAccountId: account, amount: Number(amount), expenseDate: date, description: note.trim() };
      if (from === OWNER_POCKET) return booksApi.ownerPaidExpense({ ...base, cashFinancialAccountId: cashBox!.id, funding: "CAPITAL" }, idempotencyKeyFor("quick-add:owner-expense", base));
      return financeApi.recordExpense({ ...base, fromFinancialAccountId: from }, idempotencyKeyFor("quick-add:expense", { ...base, from }));
    },
    onSuccess: done,
    onError: (e) => toast.error(getErrorMessage(e, "The expense couldn't be recorded")),
  });
  return (
    <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); if (valid) save.mutate(); }}>
      <AmountInput id="qa-amount" value={amount} onChange={setAmount} autoFocus />
      <ChoiceChips
        label="What kind of expense?"
        hint="It decides where it shows in profit."
        value={account}
        onChange={setAccount}
        testId="qa-kind"
        options={expenseAccounts.map((a) => ({ value: a.id, label: a.name }))}
      />
      <AccountChips
        label="Paid from"
        accounts={payFrom}
        value={from}
        onChange={setFrom}
        extra={ownerOption ? [{ value: OWNER_POCKET, label: `${owner}'s own money`, hint: "counted as money put in" }] : []}
        empty="No account has money in it right now."
        testId="qa-from"
      />
      <DateAndNote idPrefix="qa" date={date} onDate={setDate} note={note} onNote={setNote} noteLabel="What was it?" notePlaceholder="e.g. 200 bubble poly bags" noteRequired />
      <Actions onCancel={onDone} disabled={!valid} loading={save.isPending} label="Record expense" />
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
    <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); if (valid) save.mutate(); }}>
      <AmountInput id="qo-amount" value={amount} onChange={setAmount} autoFocus />
      <AccountChips
        label={into ? "Put into" : "Taken from"}
        accounts={choices}
        value={account}
        onChange={setAccount}
        showBalance={!into}
        empty={into ? "Add a cash box, bank or bKash in Money accounts first." : "No account has money in it right now."}
        testId="qo-account"
      />
      <DateAndNote idPrefix="qo" date={date} onDate={setDate} note={note} onNote={setNote} noteLabel="Note" notePlaceholder={into ? "e.g. for the new cap batch" : "e.g. personal use"} />
      <Actions onCancel={onDone} disabled={!valid} loading={save.isPending} label="Record" />
    </form>
  );
}

function PayPartnerForm({ partners, initialId, onDone }: { partners: NonNullable<OwnerHome["people"]>["partners"]; initialId?: string; onDone: () => void }) {
  const money = useMoneyAccounts(PAYING);
  // What can be paid now (owed less payments waiting for approval); an advance beyond it is made from Owner & partners.
  const [id, setId] = useState(initialId ?? partners.find((p) => p.available > 0)?.id ?? partners[0]?.id ?? "");
  const partner = partners.find((p) => p.id === id);
  const [amount, setAmount] = useState(partner && partner.available > 0 ? String(partner.available) : "");
  const [account, setAccount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("BKASH");
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");
  const done = useDone(onDone, `Paid ${partner?.name ?? "partner"}`);
  const tooMuch = partner ? Number(amount) > partner.available : false;
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
    <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); if (valid) save.mutate(); }}>
      {partners.length > 1 && (
        <ChoiceChips
          label="Partner"
          value={id}
          onChange={(v) => { setId(v); const p = partners.find((x) => x.id === v); setAmount(p && p.available > 0 ? String(p.available) : ""); }}
          options={partners.map((p) => ({ value: p.id, label: p.name, hint: p.available > 0 ? `can be paid ${formatPrice(p.available)}` : "nothing to pay now" }))}
        />
      )}
      <AmountInput
        id="qp-amount"
        label={partner ? `Pay ${partner.name}` : "Amount"}
        value={amount}
        onChange={setAmount}
        error={tooMuch ? "More than can be paid now — pay an advance from Owner & partners" : undefined}
      />
      {partner && (
        <p className="-mt-3 text-center text-sm text-fg-muted">
          {partner.available > 0 ? `Can be paid now: ${formatPrice(partner.available)}${partner.pending > 0 ? ` (${formatPrice(partner.pending)} waiting for approval)` : ""}` : "Nothing can be paid right now — shares are added when each month ends"}
        </p>
      )}
      <AccountChips label="Paid from" accounts={money.accounts.filter((a) => a.currentBalance > 0)} value={account} onChange={setAccount} empty="No account has money in it right now." testId="qp-account" />
      <ChoiceChips label="How" value={method} onChange={setMethod} options={METHOD.map((m) => ({ value: m.value, label: m.label }))} />
      <DateAndNote idPrefix="qp" date={date} onDate={setDate} note={note} onNote={setNote} noteLabel="Note" notePlaceholder="e.g. October share" />
      <Actions onCancel={onDone} disabled={!valid} loading={save.isPending} label="Pay" />
    </form>
  );
}
