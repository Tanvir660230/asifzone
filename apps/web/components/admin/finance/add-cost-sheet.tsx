"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Box, CalendarClock, Megaphone, MoreHorizontal, Package, Printer, Receipt, RotateCcw, Truck, type LucideIcon } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { AmountInput, ChoiceChips } from "@/components/admin/finance/glass";
import { getErrorMessage } from "@/lib/api-client";
import * as booksApi from "@/lib/api/finance-books";
import type { CostKind, CostOptions } from "@/lib/api/finance-books";
import { formatBookDate, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Add cost (docs/FINANCE_ADD_COST.md): one sheet for anything the business pays for. First what it was (8 tiles), then
 * how much, whose money and when — the books' records are picked behind it. Goods for stock open the purchase form.
 */

type Tile = { kind: CostKind | "GOODS"; label: string; example: string; icon: LucideIcon };
const TILES: Tile[] = [
  { kind: "GOODS", label: "Goods or materials", example: "Caps, attar, bottles, courier poly", icon: Package },
  { kind: "BRINGING", label: "Bringing goods", example: "Van, rickshaw, porter", icon: Truck },
  { kind: "ADS", label: "Ads", example: "Meta charged the card", icon: Megaphone },
  { kind: "PACKAGING", label: "Packaging", example: "Tape, stickers, boxes", icon: Box },
  { kind: "BILL", label: "Bills", example: "SMS, internet, rent", icon: Receipt },
  { kind: "YEARLY", label: "Paid for months", example: "Domain, server, software", icon: CalendarClock },
  { kind: "EQUIPMENT", label: "Equipment", example: "Printer, phone, scanner", icon: Printer },
  { kind: "OTHER", label: "Something else", example: "Repairs, snacks, small things", icon: MoreHorizontal },
];
const TITLE: Record<CostKind, string> = { PACKAGING: "Packaging", BILL: "A bill", OTHER: "Something else", YEARLY: "Paid for several months", BRINGING: "Bringing goods", EQUIPMENT: "Equipment", ADS: "Money paid for ads" };
const NOTE: Record<CostKind, { label: string; placeholder: string; required: boolean }> = {
  PACKAGING: { label: "What was it?", placeholder: "10 rolls of packing tape", required: false },
  BILL: { label: "What for?", placeholder: "SMS recharge", required: false },
  OTHER: { label: "What was it?", placeholder: "Fan repair", required: true },
  YEARLY: { label: "What is it?", placeholder: "Website domain, one year", required: true },
  BRINGING: { label: "What was it?", placeholder: "Van from Chawkbazar", required: false },
  EQUIPMENT: { label: "What is it?", placeholder: "Label printer", required: true },
  ADS: { label: "Note", placeholder: "Meta, 1–20 November", required: false },
};
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random()}`);
const dayBefore = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

export function AddCostSheet({ onClose, onDone }: { onClose: () => void; onDone?: () => void }) {
  const options = useQuery({ queryKey: booksApi.costOptionsKey, queryFn: booksApi.getCostOptions });
  const [kind, setKind] = useState<CostKind | null>(null);
  const [preset, setPreset] = useState<CostOptions["again"][number] | null>(null);
  const pick = (k: CostKind | null, again: CostOptions["again"][number] | null = null) => { setKind(k); setPreset(again); };
  return (
    <Modal open onClose={onClose} title={kind ? TITLE[kind] : "Add a cost"} description={kind ? undefined : "What did you pay for? The books are kept right behind it."} widthClassName="max-w-lg">
      <div data-area="finance">
        {options.isError ? (
          <Alert variant="danger" title="This couldn't load" action={<Button size="sm" variant="outline" onClick={() => options.refetch()}>Retry</Button>}>{getErrorMessage(options.error, "Check your connection and try again.")}</Alert>
        ) : !options.data ? (
          <div className="grid grid-cols-2 gap-2" aria-busy="true" aria-label="Loading">{TILES.map((t) => <Skeleton key={t.kind} className="h-24 rounded-2xl" />)}</div>
        ) : kind ? (
          <CostForm key={`${kind}-${preset?.note ?? ""}`} kind={kind} preset={preset} options={options.data} onBack={() => pick(null)} onClose={onClose} onDone={onDone} />
        ) : (
          <Picker options={options.data} onPick={pick} />
        )}
      </div>
    </Modal>
  );
}

function Picker({ options, onPick }: { options: CostOptions; onPick: (k: CostKind, again?: CostOptions["again"][number]) => void }) {
  return (
    <div className="space-y-5">
      {options.again.length > 0 && (
        <section aria-labelledby="ac-again">
          <h3 id="ac-again" className="mb-2 text-sm font-medium text-fg-muted">Again</h3>
          <div className="flex flex-wrap gap-2">
            {options.again.map((a) => (
              <button key={`${a.expenseAccountId}-${a.note}`} type="button" onClick={() => onPick(a.kind, a)} className="liquid-chip" data-testid="ac-again">
                <RotateCcw size={14} aria-hidden="true" className="text-fg-muted" />
                <span className="max-w-[14rem] truncate">{a.note}</span>
                <span className="text-fg-muted tabular-nums">{formatPrice(a.amount)}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      <ul className="grid grid-cols-2 gap-2" aria-label="What did you pay for?">
        {TILES.map((t) => {
          const Icon = t.icon;
          const inner = (
            <>
              <Icon size={20} aria-hidden="true" className="text-fg-muted" />
              <span className="mt-2 block text-base font-medium text-fg">{t.label}</span>
              <span className="mt-0.5 block text-xs leading-snug text-fg-muted">{t.example}</span>
            </>
          );
          const cls = "liquid flex h-full w-full flex-col items-start justify-start rounded-2xl p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";
          return (
            <li key={t.kind}>
              {t.kind === "GOODS" ? (
                <Link href="/admin/stock/purchases/new" className={cls} data-testid="ac-tile-GOODS">{inner}</Link>
              ) : (
                <button type="button" className={cls} onClick={() => onPick(t.kind as CostKind)} data-testid={`ac-tile-${t.kind}`}>{inner}</button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CostForm({ kind, preset, options, onBack, onClose, onDone }: { kind: CostKind; preset: CostOptions["again"][number] | null; options: CostOptions; onBack: () => void; onClose: () => void; onDone?: () => void }) {
  const qc = useQueryClient();
  const [key] = useState(newKey);
  const [amount, setAmount] = useState(preset ? String(preset.amount) : "");
  const canOwner = options.owner.canUse;
  const [payer, setPayer] = useState<string>(canOwner ? "OWNER" : options.accounts[0]?.id ?? "");
  const [repay, setRepay] = useState(false);
  const yesterday = dayBefore(options.today);
  const [when, setWhen] = useState<"TODAY" | "YESTERDAY" | "OTHER">("TODAY");
  const [otherDate, setOtherDate] = useState(yesterday);
  const date = when === "TODAY" ? options.today : when === "YESTERDAY" ? yesterday : otherDate;
  const [note, setNote] = useState(preset?.note ?? "");
  const [payee, setPayee] = useState(preset?.payee ?? "");
  const [accountId, setAccountId] = useState(preset?.expenseAccountId ?? (kind === "OTHER" ? options.defaults.otherAccountId ?? "" : ""));
  const [months, setMonths] = useState("12");
  const [life, setLife] = useState("36");
  const [assetId, setAssetId] = useState(options.assetAccounts[0]?.id ?? "");
  const [receiptId, setReceiptId] = useState(options.purchases[0]?.id ?? "");
  const value = Number(amount);
  const n = NOTE[kind];

  const billAccounts = useMemo(() => options.expenseAccounts.filter((a) => kind !== "BILL" || a.id !== options.defaults.otherAccountId), [options, kind]);
  const problems = [
    !(value > 0) && "the amount",
    !payer && "whose money",
    (kind === "BILL" || kind === "OTHER") && !accountId && "what it was for",
    n.required && !note.trim() && "what it is",
    when === "OTHER" && (!otherDate || otherDate > options.today) && "a date up to today",
    when === "OTHER" && options.booksStartedOn && otherDate < options.booksStartedOn && `a date from ${formatBookDate(options.booksStartedOn)}`,
    kind === "ADS" && !options.adAccounts.length && "an ad account",
  ].filter(Boolean) as string[];

  const save = useMutation({
    mutationFn: () => booksApi.addCost({
      kind, amount: value, date, note: note.trim() || null, payee: payee.trim() || null,
      paidFrom: payer === "OWNER" ? { kind: "OWNER", funding: repay ? "REIMBURSE" : "CAPITAL" } : { kind: "ACCOUNT", financialAccountId: payer },
      ...(kind === "BILL" || kind === "OTHER" ? { expenseAccountId: accountId } : {}),
      ...(kind === "YEARLY" ? { months: Number(months) } : {}),
      ...(kind === "EQUIPMENT" ? { usefulLifeMonths: Number(life), assetAccountId: assetId || null } : {}),
      ...(kind === "BRINGING" && receiptId ? { goodsReceiptIds: [receiptId] } : {}),
    }, key),
    onSuccess: (r) => {
      toast.success(`${formatPrice(r.cost.amount)} added — ${r.cost.title}`);
      void qc.invalidateQueries({ queryKey: ["finance"] });
      onDone?.();
      onClose();
    },
    onError: (err) => toast.error(getErrorMessage(err, "The cost couldn't be added")),
  });

  const payers = [
    ...(canOwner ? [{ value: "OWNER", label: options.owner.name.replace(/ — own money$/, "") + "’s own money" }] : []),
    ...options.accounts.map((a) => ({ value: a.id, label: a.name })),
  ];

  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); if (!problems.length) save.mutate(); }}>
      <Button type="button" size="sm" variant="ghost" className="-ml-2 -mt-1" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" /> Back</Button>
      <AmountInput id="ac-amount" value={amount} onChange={setAmount} autoFocus />

      {(kind === "BILL" || kind === "OTHER") && (
        <ChoiceChips label="What is it for?" value={accountId} onChange={setAccountId} options={billAccounts.map((a) => ({ value: a.id, label: a.name }))} testId="ac-account" />
      )}
      {kind === "YEARLY" && (
        <ChoiceChips label="For how long?" value={months} onChange={setMonths} options={["1", "3", "6", "12", "24"].map((m) => ({ value: m, label: m === "1" ? "1 month" : `${m} months` }))} testId="ac-months" />
      )}
      {kind === "EQUIPMENT" && (
        <>
          {options.assetAccounts.length > 1 && <ChoiceChips label="What kind?" value={assetId} onChange={setAssetId} options={options.assetAccounts.map((a) => ({ value: a.id, label: a.name }))} testId="ac-asset" />}
          <ChoiceChips label="How long will it last?" value={life} onChange={setLife} options={[["12", "1 year"], ["24", "2 years"], ["36", "3 years"], ["60", "5 years"]].map(([v, l]) => ({ value: v!, label: l! }))} testId="ac-life" />
        </>
      )}
      {kind === "BRINGING" && options.costingLive && options.purchases.length > 0 && (
        <ChoiceChips label="For which purchase?" hint="Its cost is added to those goods." value={receiptId} onChange={setReceiptId}
          options={options.purchases.slice(0, 4).map((p) => ({ value: p.id, label: `${formatBookDate(p.date)} · ${p.supplier}`, hint: formatPrice(p.amount) }))} testId="ac-receipt" />
      )}
      {kind === "ADS" && (
        <p className="text-sm text-fg-muted">This is what Meta charged. The spend for each day comes from Ads Manager in <Link href="/admin/finance/ads" className="font-medium text-fg underline underline-offset-2">Money › Ads</Link>.</p>
      )}

      <div>
        <ChoiceChips label="Whose money?" value={payer} onChange={setPayer} options={payers} testId="ac-payer" />
        {payer === "OWNER" && (
          <label className="mt-2 flex min-h-10 items-center gap-2 text-sm text-fg-muted">
            <input type="checkbox" checked={repay} onChange={(e) => setRepay(e.target.checked)} className="size-4 rounded border-line" />
            The shop pays it back later
          </label>
        )}
      </div>

      <div>
        <ChoiceChips label="When?" value={when} onChange={setWhen} options={[{ value: "TODAY", label: "Today" }, { value: "YESTERDAY", label: "Yesterday" }, { value: "OTHER", label: "Another day" }]} testId="ac-when" />
        {when === "OTHER" && <Input aria-label="Date" type="date" className="mt-2 w-44" value={otherDate} max={options.today} min={options.booksStartedOn ?? undefined} onChange={(e) => setOtherDate(e.target.value)} />}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field htmlFor="ac-note" label={n.label} required={n.required} className="sm:col-span-2"><Input id="ac-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={n.placeholder} /></Field>
        {kind !== "ADS" && <Field htmlFor="ac-payee" label="Paid to" hint="Optional" className="sm:col-span-2"><Input id="ac-payee" value={payee} onChange={(e) => setPayee(e.target.value)} maxLength={200} placeholder="Local market" /></Field>}
      </div>

      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit" loading={save.isPending} disabled={problems.length > 0} data-testid="ac-save" className={cn("sm:min-w-40")}>
          {value > 0 ? `Add ${formatPrice(value)}` : "Add cost"}
        </Button>
      </div>
      {problems.length > 0 && value > 0 && <p className="text-right text-xs text-fg-muted">Still needed: {problems.join(", ")}.</p>}
    </form>
  );
}
