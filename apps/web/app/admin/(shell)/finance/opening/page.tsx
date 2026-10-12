"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, CheckCircle2, Flag, Plus, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { EmptyState } from "@/components/admin/empty-state";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { OpeningStockEditor, itemValue } from "@/components/admin/finance/opening-stock-editor";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import type { ChartAccount, FinancialAccount, FinancialAccountKind, OpeningBalanceCategory, OpeningInventoryItem, OpeningLine } from "@/lib/api/finance";
import { formatBookDate, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** Which opening category a money account's balance belongs to (the API checks the account's kind against it). */
const MONEY_CATEGORY: Record<FinancialAccountKind, OpeningBalanceCategory> = { CASH: "CASH", BANK: "BANK", MOBILE_WALLET: "MOBILE_WALLET", PAYMENT_GATEWAY: "PAYMENT_ACCOUNT", COURIER: "PAYMENT_ACCOUNT", OTHER: "PAYMENT_ACCOUNT" };
const MONEY_CATEGORIES: OpeningBalanceCategory[] = ["CASH", "BANK", "MOBILE_WALLET", "PAYMENT_ACCOUNT"];
/** The other balances, in plain words, with the ledger type each must be booked to and its normal side. */
const OTHER: Array<{ category: OpeningBalanceCategory; label: string; hint: string; type: "ASSET" | "LIABILITY" | "EQUITY"; side: "DEBIT" | "CREDIT" }> = [
  { category: "RECEIVABLE", label: "Customers owe you", hint: "Unpaid customer invoices or dues", type: "ASSET", side: "DEBIT" },
  { category: "PAYABLE", label: "You owe suppliers", hint: "Unpaid supplier bills", type: "LIABILITY", side: "CREDIT" },
  { category: "LOAN", label: "Loan still to repay", hint: "What's left on a bank or personal loan", type: "LIABILITY", side: "CREDIT" },
  { category: "FIXED_ASSET", label: "Equipment you own", hint: "Machines, furniture, vehicles — at their current value", type: "ASSET", side: "DEBIT" },
  { category: "CAPITAL", label: "Owner's capital", hint: "Money the owners put in", type: "EQUITY", side: "CREDIT" },
  { category: "OTHER_ASSET", label: "Something else you own", hint: "Deposits, advances paid", type: "ASSET", side: "DEBIT" },
  { category: "OTHER_LIABILITY", label: "Something else you owe", hint: "Advances received, taxes due", type: "LIABILITY", side: "CREDIT" },
  { category: "OTHER_EQUITY", label: "Other equity", hint: "Only if your accountant asks", type: "EQUITY", side: "CREDIT" },
];
const otherOf = (c: OpeningBalanceCategory) => OTHER.find((o) => o.category === c)!;

type OtherRow = { key: string; category: OpeningBalanceCategory; accountId: string; amount: string; description: string };
const blankRow = (): OtherRow => ({ key: Math.random().toString(36).slice(2), category: "RECEIVABLE", accountId: "", amount: "", description: "" });
const amountOk = (v: string) => v.trim() === "" || (/^\d+(\.\d{1,2})?$/.test(v.trim()) && Number(v) >= 0);

/**
 * Start the books (docs/FINANCE_PHASE_1.md §8): choose the Financial Opening Date, then state what the business held and
 * owed on it — money in each account, other balances, the stock count — and post it once as the opening journal. The
 * difference becomes opening balance equity, so it always balances. After posting everything here is frozen; later
 * corrections are journals.
 */
export default function StartTheBooksPage() {
  const { can, ready } = useCapabilities();
  const allowed = can("finance.view");
  const business = useQuery({ queryKey: financeApi.businessKeys.settings(), queryFn: financeApi.getBusiness, enabled: allowed });
  const opening = useQuery({ queryKey: financeApi.openingKeys.all, queryFn: financeApi.getOpeningBalances, enabled: allowed });

  if (ready && !allowed) {
    return (
      <div>
        <ModuleTabs />
        <EmptyState icon={Flag} title="Setting up the books isn't available to your role" />
      </div>
    );
  }
  const loading = business.isLoading || opening.isLoading;
  const error = business.error ?? opening.error;
  const posted = opening.data?.batch?.status === "POSTED";
  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader
        title="Start the books"
        description="Pick the day your books begin and write down what the business had and owed on that day. Everything after it is recorded automatically."
      />
      {loading ? (
        <Skeleton className="h-96 w-full" />
      ) : error || !business.data || !opening.data ? (
        <Alert variant="danger" title="The opening balances couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => { void business.refetch(); void opening.refetch(); }}>Retry</Button>}>
          {getErrorMessage(error, "")}
        </Alert>
      ) : posted ? (
        <PostedSummary business={business.data} batch={opening.data.batch!} />
      ) : (
        <>
          <DateStep business={business.data} />
          {business.data.business.openingDate ? (
            <BalancesSteps openingDate={business.data.business.openingDate} batch={opening.data.batch} />
          ) : (
            <Card variant="muted" className="p-5 text-sm text-fg-muted">Choose the start date first — the balances below are what you had on that day.</Card>
          )}
        </>
      )}
    </div>
  );
}

function StepHeading({ n, title, detail, done }: { n: number; title: string; detail?: string; done?: boolean }) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold", done ? "bg-success-100 text-success-700" : "bg-ink-900/[0.06] text-fg")} aria-hidden>
        {done ? <CheckCircle2 className="h-4 w-4" /> : n}
      </span>
      <div className="min-w-0">
        <h2 className="text-[17px] font-semibold tracking-tight text-fg">{title}</h2>
        {detail && <p className="mt-0.5 text-sm text-fg-muted">{detail}</p>}
      </div>
    </div>
  );
}

function DateStep({ business }: { business: financeApi.BusinessSettings }) {
  const { can } = useCapabilities();
  const queryClient = useQueryClient();
  const current = business.business.openingDate;
  const [date, setDate] = useState(current ?? "");
  const [fyMonth, setFyMonth] = useState(business.business.fiscalYearStartMonth);
  const locked = business.openingDateLocked;
  const dirty = (date || null) !== current || fyMonth !== business.business.fiscalYearStartMonth;
  const save = useMutation({
    mutationFn: () => financeApi.updateBusiness({
      ...(date && date !== current ? { openingDate: date } : {}),
      ...(fyMonth !== business.business.fiscalYearStartMonth ? { fiscalYearStartMonth: fyMonth } : {}),
      reason: "Set on the Start the books page",
    }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["finance"] }); toast.success("Saved"); },
    onError: (err) => toast.error(getErrorMessage(err, "Couldn't save the start date")),
  });
  const editable = can("finance.configure") && !locked;
  return (
    <Card className="p-5 sm:p-6" data-testid="opening-date-step">
      <StepHeading n={1} title="When do your books start?" detail="Usually the first day of a month — or of your financial year. Sales and costs before it are summed up in the opening balances, not replayed." done={Boolean(current)} />
      <div className="grid gap-4 sm:grid-cols-2 lg:max-w-2xl">
        <Field htmlFor="opening-date" label="Books start on" hint={locked ? "Fixed — something has already been posted." : undefined}>
          <Input id="opening-date" type="date" value={date} disabled={!editable} onChange={(e) => setDate(e.target.value)} max={new Date().toLocaleDateString("en-CA")} />
        </Field>
        <Field htmlFor="fy-month" label="Financial year starts in" hint="July in Bangladesh (July–June).">
          <Select id="fy-month" value={String(fyMonth)} disabled={!can("finance.configure") || business.postedJournals > 0} onChange={(e) => setFyMonth(Number(e.target.value))}>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </Select>
        </Field>
      </div>
      {editable && (
        <div className="mt-4 flex items-center gap-3">
          <Button size="sm" disabled={!dirty || !date} loading={save.isPending} onClick={() => save.mutate()} data-testid="save-opening-date">{current ? "Save changes" : "Set start date"}</Button>
          {current && <span className="text-sm text-fg-muted">Currently {formatBookDate(current)}</span>}
        </div>
      )}
      {!can("finance.configure") && <p className="mt-3 text-sm text-fg-muted">Only the owner can change the start date.</p>}
    </Card>
  );
}

function BalancesSteps({ openingDate, batch }: { openingDate: string; batch: financeApi.OpeningBatch | null }) {
  const { can } = useCapabilities();
  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirmDialog();
  const accounts = useQuery({ queryKey: financeApi.financeKeys.accounts(), queryFn: financeApi.listFinancialAccounts });
  const chart = useQuery({ queryKey: financeApi.ledgerKeys.chart(), queryFn: financeApi.listChart });
  const money = (accounts.data?.financialAccounts ?? []).filter((a) => a.isActive);

  // ── local drafts, seeded from the saved batch ──
  const seed = useMemo(() => {
    const moneyAmounts: Record<string, string> = {};
    const others: OtherRow[] = [];
    for (const l of batch?.lines ?? []) {
      if (MONEY_CATEGORIES.includes(l.category) && l.financialAccountId) moneyAmounts[l.financialAccountId] = String(l.amount);
      else others.push({ key: l.id ?? Math.random().toString(36).slice(2), category: l.category, accountId: l.accountId ?? "", amount: String(l.amount), description: l.description ?? "" });
    }
    return { moneyAmounts, others, items: batch?.inventoryItems ?? [] };
  }, [batch]);
  const [moneyAmounts, setMoneyAmounts] = useState(seed.moneyAmounts);
  const [others, setOthers] = useState<OtherRow[]>(seed.others);
  const [items, setItems] = useState<OpeningInventoryItem[]>(seed.items);
  useEffect(() => { setMoneyAmounts(seed.moneyAmounts); setOthers(seed.others); setItems(seed.items); }, [seed]);

  const linesDirty = JSON.stringify(moneyAmounts) !== JSON.stringify(seed.moneyAmounts) || JSON.stringify(others.map(({ key: _k, ...r }) => r)) !== JSON.stringify(seed.others.map(({ key: _k, ...r }) => r));
  const itemsDirty = JSON.stringify(items) !== JSON.stringify(seed.items);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["finance"] });

  const linesInvalid = Object.values(moneyAmounts).some((v) => !amountOk(v)) || others.some((r) => !amountOk(r.amount) || (Number(r.amount) > 0 && !r.accountId));
  const saveLines = useMutation({
    mutationFn: () => {
      const lines: Array<Omit<OpeningLine, "id">> = [
        ...money.filter((a) => Number(moneyAmounts[a.id] ?? 0) > 0).map((a) => ({
          category: MONEY_CATEGORY[a.kind], accountId: null, financialAccountId: a.id, side: "DEBIT" as const, amount: Number(moneyAmounts[a.id]),
          brandId: null, partyType: null, partyId: null, description: `Opening balance of ${a.name}`,
        })),
        ...others.filter((r) => Number(r.amount) > 0).map((r) => ({
          category: r.category, accountId: r.accountId, financialAccountId: null, side: otherOf(r.category).side, amount: Number(r.amount),
          brandId: null, partyType: null, partyId: null, description: r.description.trim() || otherOf(r.category).label,
        })),
      ];
      return financeApi.saveOpeningLines({ lines });
    },
    onSuccess: () => { refresh(); toast.success("Balances saved"); },
    onError: (err) => toast.error(getErrorMessage(err, "The balances couldn't be saved")),
  });
  const prefill = useMutation({
    mutationFn: financeApi.prefillOpeningInventory,
    onSuccess: (b) => { refresh(); toast.success(`${b.inventoryItems.length} item(s) filled from current stock`); },
    onError: (err) => toast.error(getErrorMessage(err, "Couldn't fill the stock count")),
  });
  const saveItems = useMutation({
    mutationFn: () => financeApi.saveOpeningInventory(items.map((i) => ({
      variantId: i.variantId, sku: i.sku, name: i.name, quantity: i.quantity, unitCost: i.valuationStatus === "MISSING" ? null : i.unitCost,
      valuationAmount: i.valuationStatus === "MISSING" || i.unitCost != null ? null : i.valuationAmount, valuationStatus: i.valuationStatus, valuationMethod: i.valuationMethod,
      valuationSource: i.valuationSource, valuationDate: i.valuationDate, confidence: i.confidence, notes: i.notes, brandId: i.brandId,
    }))),
    onSuccess: () => { refresh(); toast.success("Stock count saved"); },
    onError: (err) => toast.error(getErrorMessage(err, "The stock count couldn't be saved")),
  });
  const post = useMutation({
    mutationFn: financeApi.postOpeningBalances,
    onSuccess: (r) => { refresh(); toast.success(`The books have started — opening journal #${r.journal.number ?? ""} posted`); },
    onError: (err) => toast.error(getErrorMessage(err, "The opening balances couldn't be posted")),
  });

  const canEdit = can("finance.transact");
  const moneyTotal = money.reduce((t, a) => t + (amountOk(moneyAmounts[a.id] ?? "") ? Number(moneyAmounts[a.id] ?? 0) : 0), 0);
  const stockValue = items.reduce((t, i) => t + itemValue(i), 0);
  const missing = items.filter((i) => i.valuationStatus === "MISSING");
  const s = batch?.summary;

  async function confirmPost() {
    const ok = await confirm(`Post the opening balances dated ${formatBookDate(openingDate)}?`, {
      title: "Start the books",
      confirmLabel: "Post and start",
      tone: "default",
      details: <p className="text-sm text-fg-muted">After this the start date and these balances are fixed. A later correction is a journal entry.</p>,
    });
    if (ok) post.mutate();
  }

  return (
    <>
      {/* 2 — money */}
      <Card className="p-5 sm:p-6" data-testid="opening-money-step">
        <StepHeading n={2} title={`Money on ${formatBookDate(openingDate)}`} detail="How much was in each cash box, bank account and wallet at the start of that day. Leave an account empty if it had nothing." done={moneyTotal > 0} />
        {accounts.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : money.length === 0 ? (
          <Alert variant="info" title="No money accounts yet">
            Add your cash box, bank and bKash / Nagad first in <Link href="/admin/finance/accounts?new=account" className="font-medium text-accent hover:underline">Money accounts</Link>, then come back.
          </Alert>
        ) : (
          <ul className="divide-y divide-line-subtle lg:max-w-2xl">
            {money.map((a: FinancialAccount) => (
              <li key={a.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                <label htmlFor={`money-${a.id}`} className="min-w-0 flex-1 text-sm text-fg">
                  {a.name}
                  {a.openingBalance > 0 && <span className="block text-xs text-warning-700">Already has an opening balance of {formatPrice(a.openingBalance)} — leave this empty so it isn&apos;t counted twice.</span>}
                </label>
                <Input id={`money-${a.id}`} inputMode="decimal" placeholder="0" disabled={!canEdit} className="w-full text-right tabular-nums sm:w-40" value={moneyAmounts[a.id] ?? ""} aria-invalid={!amountOk(moneyAmounts[a.id] ?? "")} onChange={(e) => setMoneyAmounts((m) => ({ ...m, [a.id]: e.target.value }))} />
              </li>
            ))}
            <li className="flex justify-between py-3 text-sm font-medium text-fg"><span>Total money</span><span className="tabular-nums">{formatPrice(moneyTotal)}</span></li>
          </ul>
        )}
      </Card>

      {/* 3 — other balances */}
      <Card className="p-5 sm:p-6" data-testid="opening-other-step">
        <StepHeading n={3} title="What others owed you, and what you owed" detail="Customer dues, supplier dues, loans, equipment and the owners' capital on that day. Skip anything that doesn't apply." done={others.some((r) => Number(r.amount) > 0)} />
        {others.length > 0 && (
          <div className="space-y-3">
            {others.map((r, idx) => {
              const meta = otherOf(r.category);
              const choices = (chart.data?.accounts ?? []).filter((c: ChartAccount) => c.isPostable && c.isActive && c.type === meta.type);
              return (
                <div key={r.key} className="grid gap-2 rounded-lg border border-line-subtle p-3 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1.2fr)_minmax(0,1fr)_8rem_auto] sm:items-end" data-testid="opening-other-row">
                  <Field htmlFor={`oc-${r.key}`} label="What" hint={meta.hint}>
                    <Select id={`oc-${r.key}`} value={r.category} disabled={!canEdit} onChange={(e) => setOthers((rows) => rows.map((x, i) => (i === idx ? { ...x, category: e.target.value as OpeningBalanceCategory, accountId: "" } : x)))}>
                      {OTHER.map((o) => <option key={o.category} value={o.category}>{o.label}</option>)}
                    </Select>
                  </Field>
                  <Field htmlFor={`oa-${r.key}`} label="Account in the books">
                    <Select id={`oa-${r.key}`} value={r.accountId} disabled={!canEdit} onChange={(e) => setOthers((rows) => rows.map((x, i) => (i === idx ? { ...x, accountId: e.target.value } : x)))}>
                      <option value="">Choose…</option>
                      {choices.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
                    </Select>
                  </Field>
                  <Field htmlFor={`od-${r.key}`} label="Note">
                    <Input id={`od-${r.key}`} value={r.description} disabled={!canEdit} maxLength={300} placeholder="e.g. Rahim Fabrics" onChange={(e) => setOthers((rows) => rows.map((x, i) => (i === idx ? { ...x, description: e.target.value } : x)))} />
                  </Field>
                  <Field htmlFor={`ov-${r.key}`} label="Amount" error={amountOk(r.amount) ? undefined : "Check the amount"}>
                    <Input id={`ov-${r.key}`} inputMode="decimal" className="text-right tabular-nums" value={r.amount} disabled={!canEdit} onChange={(e) => setOthers((rows) => rows.map((x, i) => (i === idx ? { ...x, amount: e.target.value } : x)))} />
                  </Field>
                  {canEdit && <IconButton aria-label="Remove this line" variant="ghost" onClick={() => setOthers((rows) => rows.filter((_, i) => i !== idx))}><Trash2 className="h-4 w-4" /></IconButton>}
                </div>
              );
            })}
          </div>
        )}
        {canEdit && <Button size="sm" variant="outline" className={cn(others.length > 0 && "mt-3")} onClick={() => setOthers((rows) => [...rows, blankRow()])} data-testid="add-opening-line"><Plus className="h-4 w-4" /> Add a balance</Button>}
        {canEdit && (
          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line-subtle pt-4">
            <Button size="sm" disabled={!linesDirty || linesInvalid} loading={saveLines.isPending} onClick={() => saveLines.mutate()} data-testid="save-opening-lines">Save money and balances</Button>
            <span className="text-sm text-fg-muted">{linesDirty ? "Steps 2 and 3 have unsaved changes." : "Saved."}</span>
          </div>
        )}
      </Card>

      {/* 4 — stock */}
      <Card className="p-5 sm:p-6" data-testid="opening-stock-step">
        <StepHeading n={4} title="Stock on hand" detail="Count of every item on that day and what each cost you. Start from today's stock and the cost prices in your catalog, then correct anything that's off." done={items.length > 0} />
        <div className="mb-4 flex flex-wrap items-center gap-3">
          {canEdit && (
            <Button size="sm" variant={items.length ? "outline" : "primary"} loading={prefill.isPending} onClick={async () => { if (!items.length || (await confirm("Replace the current count with today's stock and catalog costs?", { confirmLabel: "Replace", tone: "default", title: "Fill from current stock" }))) prefill.mutate(); }} data-testid="prefill-opening-stock">
              {items.length ? "Refill from current stock" : "Fill from current stock"}
            </Button>
          )}
          {items.length > 0 && (
            <p className="text-sm text-fg-muted">
              {items.length} items · valued at <span className="font-medium tabular-nums text-fg">{formatPrice(stockValue)}</span>
              {missing.length > 0 && <> · <span className="text-warning-700">{missing.length} without a cost</span></>}
            </p>
          )}
        </div>
        {items.length > 0 && <OpeningStockEditor items={items} onChange={setItems} readOnly={!canEdit} />}
        {missing.length > 0 && <p className="mt-3 text-xs text-fg-muted">Items without a cost count as zero for now. You can fix their cost later in <Link href="/admin/finance/inventory-cutover" className="text-accent hover:underline">Opening stock value</Link>.</p>}
        {canEdit && items.length > 0 && (
          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line-subtle pt-4">
            <Button size="sm" disabled={!itemsDirty} loading={saveItems.isPending} onClick={() => saveItems.mutate()} data-testid="save-opening-stock">Save stock count</Button>
            <span className="text-sm text-fg-muted">{itemsDirty ? "The stock count has unsaved changes." : "Saved."}</span>
          </div>
        )}
      </Card>

      {/* 5 — review & post */}
      <Card className="p-5 sm:p-6" data-testid="opening-review-step">
        <StepHeading n={5} title="Check and start" detail="The difference between what you had and what you owed becomes the owners' opening equity, so the books always balance." />
        {!s ? (
          <p className="text-sm text-fg-muted">Save the balances or the stock count to see the totals.</p>
        ) : (
          <dl className="divide-y divide-line-subtle text-sm lg:max-w-xl" data-testid="opening-summary">
            <SummaryRow label="Money and things you own" value={s.lineDebits} />
            <SummaryRow label="Stock value" value={s.inventory.valuedTotal} hint={s.inventory.missing.items ? `${s.inventory.missing.items} item(s) not valued` : undefined} />
            <SummaryRow label="What you owe, and capital" value={s.lineCredits} />
            <SummaryRow label={s.openingBalanceEquity.side === "CREDIT" ? "Owners' opening equity (the difference)" : "Opening shortfall (the difference)"} value={s.openingBalanceEquity.amount} strong />
          </dl>
        )}
        {(linesDirty || itemsDirty) && <Alert variant="warning" title="Save your changes first" className="mt-4">The totals and posting use what&apos;s saved.</Alert>}
        {can("finance.post") ? (
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button disabled={!s || linesDirty || itemsDirty} loading={post.isPending} onClick={confirmPost} data-testid="post-opening"><CalendarCheck className="h-4 w-4" /> Post and start the books</Button>
            <span className="text-sm text-fg-muted">This can&apos;t be undone; later corrections are journal entries.</span>
          </div>
        ) : (
          <p className="mt-4 text-sm text-fg-muted">Only the owner can post the opening balances.</p>
        )}
      </Card>
      {dialog}
    </>
  );
}

function SummaryRow({ label, value, hint, strong }: { label: string; value: number; hint?: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2.5">
      <dt className={strong ? "font-medium text-fg" : "text-fg-muted"}>
        {label}
        {hint && <span className="ml-2 text-xs text-warning-700">{hint}</span>}
      </dt>
      <dd className={cn("tabular-nums", strong ? "font-semibold text-fg" : "text-fg")}>{formatPrice(value)}</dd>
    </div>
  );
}

function PostedSummary({ business, batch }: { business: financeApi.BusinessSettings; batch: financeApi.OpeningBatch }) {
  const s = batch.summary;
  return (
    <>
      <Card className="p-5 sm:p-6" data-testid="opening-posted">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success-600" aria-hidden />
          <div className="min-w-0">
            <h2 className="text-[17px] font-semibold tracking-tight text-fg">Your books started on {formatBookDate(batch.openingDate)}</h2>
            <p className="mt-1 text-sm text-fg-muted">
              The opening balances are posted and fixed. Financial year starts in {MONTHS[business.business.fiscalYearStartMonth - 1]}. To correct an opening figure, add a correcting entry in{" "}
              <Link href="/admin/finance/journals" className="text-accent hover:underline">Journals</Link>.
            </p>
          </div>
        </div>
        <dl className="mt-5 divide-y divide-line-subtle text-sm lg:max-w-xl">
          <SummaryRow label="Money and things you owned" value={s.lineDebits} />
          <SummaryRow label="Stock value" value={s.inventory.valuedTotal} hint={s.inventory.missing.items ? `${s.inventory.missing.items} item(s) not valued` : undefined} />
          <SummaryRow label="What you owed, and capital" value={s.lineCredits} />
          <SummaryRow label={s.openingBalanceEquity.side === "CREDIT" ? "Owners' opening equity" : "Opening shortfall"} value={s.openingBalanceEquity.amount} strong />
        </dl>
      </Card>
      <Card className="p-5 sm:p-6">
        <h2 className="mb-3 text-[17px] font-semibold tracking-tight text-fg">What comes next</h2>
        <ul className="space-y-2 text-sm">
          {!business.inventoryCostingActivatedAt && (
            <li><Badge variant="warning" className="mr-2">Next</Badge><Link href="/admin/finance/inventory-cutover" className="text-accent hover:underline">Confirm the value of your stock</Link> so every sale&apos;s profit uses real costs.</li>
          )}
          <li><Link href="/admin/finance/sales" className="text-accent hover:underline">Sales accounting</Link> — orders from the start date are recorded automatically.</li>
          <li><Link href="/admin/finance/checks" className="text-accent hover:underline">Books health check</Link> — confirm the books match the dashboard.</li>
        </ul>
      </Card>
    </>
  );
}
