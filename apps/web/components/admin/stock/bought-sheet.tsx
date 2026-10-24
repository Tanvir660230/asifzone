"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useDiscardGuard } from "@/components/ui/discard-guard";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { Table } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import * as stockApi from "@/lib/api/stock";
import type { StockItem, StockOverview, StockProblem, StockPurchase } from "@/lib/api/stock";
import { formatPrice, storeCurrencySymbol } from "@/lib/format";
import { idempotencyKeyFor, settleIdempotencyKey } from "@/lib/idempotency";
import { cn } from "@/lib/utils";
import { byProduct, colorOf, num, sizeOf, spreadWords, todayLocal, variantWords } from "./stock-shared";
import { ProblemAlert } from "./stock-problem";

const OWNER = "owner";
const PAYING = new Set(["CASH", "BANK", "MOBILE_WALLET"]);
const NO_OVERDRAFT = new Set(["CASH", "MOBILE_WALLET"]);
const DEFAULT_SUPPLIER = "Local market";

/** Something that can be bought: one variant, or a product whose colours × sizes are entered as a grid. */
interface Choice { id: string; label: string; detail: string; variants: StockItem[]; grid: boolean }
interface Line { key: string; choice: Choice; qty: Record<string, string>; amount: string }
interface Extra { key: string; description: string; amount: string }

const toMinor = (v: string) => Math.round(Number(v) * 100);
const amountOk = (v: string) => v.trim() !== "" && Number.isFinite(Number(v)) && Number(v) > 0 && /^\d+(\.\d{1,2})?$/.test(v.trim());
const qtyOf = (v: string | undefined) => (v && /^\d+$/.test(v.trim()) ? Number(v) : 0);
let seq = 0;
const nextKey = () => `l${++seq}`;

/** The choices: materials one by one, ready goods by product (a grid when it has several colours or sizes). */
function choicesOf(overview: StockOverview): Choice[] {
  const of = (key: stockApi.StockGroupKey) => overview.groups.find((g) => g.key === key)?.items ?? [];
  const materials = of("MATERIAL").map((i) => ({ id: i.variantId, label: i.productName, detail: [variantWords(i) !== i.sku && !i.productName.toLowerCase().includes(variantWords(i).toLowerCase()) ? variantWords(i) : null, `${num(i.stock)} ${i.unit} in stock`].filter(Boolean).join(" · "), variants: [i], grid: false }));
  const finished = byProduct(of("FINISHED")).map((p) => ({ id: p.productId, label: p.name, detail: p.items.length > 1 ? `${spreadWords(p.items)} · ${num(p.stock)} in stock` : `${num(p.stock)} in stock`, variants: p.items, grid: p.items.length > 1 }));
  return [...materials, ...finished];
}

/** Most bought first (from the recent purchases), then the rest in name order. */
function byUse(choices: Choice[], purchases: StockPurchase[]): Choice[] {
  const count = new Map<string, number>();
  for (const p of purchases) for (const l of p.lines) count.set(l.variantId, (count.get(l.variantId) ?? 0) + 1);
  const score = (c: Choice) => c.variants.reduce((s, v) => s + (count.get(v.variantId) ?? 0), 0);
  return [...choices].sort((a, b) => score(b) - score(a) || a.label.localeCompare(b.label));
}

/** Splits a total over lines by quantity, in whole paisa; the last paisa go to the largest lines. */
function spread(totalMinor: number, qty: number[]): number[] {
  const all = qty.reduce((s, q) => s + q, 0);
  if (!all) return qty.map(() => 0);
  const out = qty.map((q) => Math.floor((totalMinor * q) / all));
  let left = totalMinor - out.reduce((s, x) => s + x, 0);
  const order = qty.map((q, i) => [q, i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k]![1]]! += 1;
  return out;
}

/** Lines to start with (the reorder list): each item at its suggested quantity, and the unit price paid last time. */
export interface BoughtStart {
  supplierName: string | null;
  lines: Array<{ variantId: string; qty: number; lastUnitCost: number | null }>;
}

/** The start lines as form lines: an item's own choice, the sizes of one product together on its grid. */
function startLines(choices: Choice[], start: BoughtStart | undefined): Line[] {
  if (!start) return [];
  const out: Line[] = [];
  for (const s of start.lines) {
    const choice = choices.find((c) => c.variants.some((v) => v.variantId === s.variantId));
    if (!choice) continue;
    const line = out.find((l) => l.choice.id === choice.id);
    if (line) line.qty[s.variantId] = String(s.qty);
    else out.push({ key: nextKey(), choice, qty: { [s.variantId]: String(s.qty) }, amount: "" });
  }
  return out;
}

export function BoughtSheet({ overview, purchases, canOwnerMoney, start, onClose }: { overview: StockOverview; purchases: StockPurchase[]; canOwnerMoney: boolean; start?: BoughtStart; onClose: () => void }) {
  const qc = useQueryClient();
  const formId = useRef(`stock-bought:${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`).current;
  const choices = useMemo(() => byUse(choicesOf(overview), purchases), [overview, purchases]);
  const lastCost = useMemo(() => new Map((start?.lines ?? []).filter((l) => l.lastUnitCost !== null).map((l) => [l.variantId, l.lastUnitCost!])), [start]);
  /** The line's last price per unit, weighted by what is entered now; null unless every entered size has one. */
  const lastEachOf = (l: Line): number | null => {
    const vs = l.choice.variants.filter((v) => qtyOf(l.qty[v.variantId]) > 0);
    if (!vs.length || vs.some((v) => !lastCost.has(v.variantId))) return null;
    const qty = vs.reduce((s, v) => s + qtyOf(l.qty[v.variantId]), 0);
    return vs.reduce((s, v) => s + qtyOf(l.qty[v.variantId]) * lastCost.get(v.variantId)!, 0) / qty;
  };
  const accountsQ = useQuery({ queryKey: financeApi.financeKeys.accounts(), queryFn: financeApi.listFinancialAccounts, retry: (n, e) => !(e instanceof ApiError && e.status === 403) && n < 2 });
  const accounts = (accountsQ.data?.financialAccounts ?? []).filter((a) => a.isActive && PAYING.has(a.kind) && !a.name.endsWith("— own money"));
  const accountsForbidden = accountsQ.error instanceof ApiError && accountsQ.error.status === 403;

  const [lines, setLines] = useState<Line[]>(() => startLines(choices, start));
  const [extras, setExtras] = useState<Extra[]>([]);
  const [query, setQuery] = useState("");
  const [supplier, setSupplier] = useState(start?.supplierName ?? "");
  const [date, setDate] = useState(todayLocal());
  const [paidFrom, setPaidFrom] = useState("");
  const [documentTotal, setDocumentTotal] = useState("");
  const [problem, setProblem] = useState<StockProblem | null>(null);
  const [tried, setTried] = useState(false);
  // Last look before anything is written: every colour / size and the total, against the bill (inventory recovery F-c).
  const [reviewing, setReviewing] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);

  const added = new Set(lines.map((l) => l.choice.id));
  const q = query.trim().toLowerCase();
  const results = (q ? choices.filter((c) => `${c.label} ${c.detail} ${c.variants.map((v) => `${v.sku} ${v.size ?? ""} ${v.color ?? ""}`).join(" ")}`.toLowerCase().includes(q)) : choices).filter((c) => !added.has(c.id)).slice(0, q ? 8 : 6);

  const add = (c: Choice) => {
    setLines((ls) => [...ls, { key: nextKey(), choice: c, qty: {}, amount: "" }]);
    setQuery("");
    setProblem(null);
  };
  const update = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  // Each line's quantity, goods total and share of the extras (by value), for the per-unit preview.
  const totals = lines.map((l) => ({ qty: l.choice.variants.reduce((s, v) => s + qtyOf(l.qty[v.variantId]), 0), minor: amountOk(l.amount) ? toMinor(l.amount) : 0 }));
  const goodsMinor = totals.reduce((s, t) => s + t.minor, 0);
  const extrasMinor = extras.reduce((s, e) => s + (amountOk(e.amount) ? toMinor(e.amount) : 0), 0);
  const totalMinor = goodsMinor + extrasMinor;

  const lineErrors = lines.map((l, i) => {
    if (!totals[i]!.qty) return l.choice.grid ? "Enter how many of at least one colour and size" : "Enter how many";
    if (!amountOk(l.amount)) return "Enter what you paid for these, in all";
    if (totals[i]!.minor < totals[i]!.qty) return "The total is too small for that many";
    return null;
  });
  const extraErrors = extras.map((e) => (!e.description.trim() ? "Say what it was" : !amountOk(e.amount) ? "Enter the amount" : null));
  const supplierError = supplier.trim().length === 1 ? "At least 2 letters" : null;
  const account = accounts.find((a) => a.id === paidFrom);
  const shortOf = account && NO_OVERDRAFT.has(account.kind) && account.currentBalance * 100 < totalMinor ? account : null;
  const unitsEntered = totals.reduce((s, t) => s + t.qty, 0);
  const documentUnits = qtyOf(documentTotal);
  const documentError = !documentUnits
    ? "Enter the total units printed on the bill or receipt"
    : lines.length && documentUnits !== unitsEntered ? `The items add up to ${num(unitsEntered)}, the bill says ${num(documentUnits)} — check each line` : null;
  const valid = lines.length > 0 && lineErrors.every((e) => !e) && extraErrors.every((e) => !e) && !supplierError && !documentError && Boolean(paidFrom) && date <= todayLocal();
  // what will be received, one row per colour / size — shown before saving
  const arriving = lines.flatMap((l) => l.choice.variants.filter((v) => qtyOf(l.qty[v.variantId]) > 0).map((v) => ({
    id: v.variantId,
    label: l.choice.grid ? `${l.choice.label} · ${[colorOf(v), sizeOf(v)].filter(Boolean).join(" ") || v.sku}` : l.choice.label,
    qty: qtyOf(l.qty[v.variantId]),
    unit: l.choice.grid ? "pcs" : v.unit,
  })));

  const body = (): stockApi.PurchaseBody => ({
    date,
    documentTotal: documentUnits,
    supplierName: supplier.trim() || null,
    lines: lines.flatMap((l, i) => {
      const vs = l.choice.variants.filter((v) => qtyOf(l.qty[v.variantId]) > 0);
      const amounts = spread(totals[i]!.minor, vs.map((v) => qtyOf(l.qty[v.variantId])));
      return vs.map((v, k) => ({ variantId: v.variantId, quantity: qtyOf(l.qty[v.variantId]), amount: amounts[k]! / 100 }));
    }),
    extras: extras.map((e) => ({ description: e.description.trim(), amount: Number(e.amount) })),
    paidFrom: paidFrom === OWNER ? { ownerPocket: true } : { financialAccountId: paidFrom },
  });

  const save = useMutation({
    mutationFn: () => {
      const b = body();
      // One key per open form: a retry of the same purchase replays it; a changed purchase is a new one.
      return stockApi.recordStockPurchase(b, idempotencyKeyFor(formId, b));
    },
    onSuccess: (r) => {
      settleIdempotencyKey(formId);
      toast.success(r.replayed ? "Already recorded — nothing was added twice" : `Purchase recorded${r.purchase.receipt?.number ? ` (${r.purchase.receipt.number})` : ""}`);
      void qc.invalidateQueries({ queryKey: stockApi.stockKeys.all });
      void qc.invalidateQueries({ queryKey: ["finance"] });
      onClose();
    },
    onError: (e) => {
      const p = stockApi.describeStockError(e, "The purchase couldn't be recorded");
      const partial = !p.code || !stockApi.CHECKED_BEFORE_WRITING.has(p.code);
      setProblem(partial && !(e instanceof ApiError && e.status === 400) ? { ...p, detail: `${p.detail} If part of it was saved, it shows at the top of Stock with a Finish button.` } : p);
      setReviewing(false);
      void qc.invalidateQueries({ queryKey: stockApi.stockKeys.all });
      requestAnimationFrame(() => errorRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
    },
  });

  // Typed work isn't lost to a stray Escape, the close button or Cancel: those ask first.
  const dirty = lines.length > 0 || extras.some((e) => e.description.trim() || e.amount.trim()) || supplier.trim() !== "" || documentTotal.trim() !== "";
  const guard = useDiscardGuard(dirty, onClose, "Discard this purchase?");

  const submit = () => {
    setTried(true);
    if (valid && reviewing) return save.mutate();
    if (valid) {
      setProblem(null);
      return setReviewing(true);
    }
    // take the owner to the first thing to fix (in page order: a line, the search when nothing is added, an extra, who paid)
    requestAnimationFrame(() => {
      const form = document.getElementById("stock-bought-form");
      const sel = lines.length ? "[data-testid=bought-line]:has([role=alert]) input, [aria-invalid=true]" : "[data-testid=bought-search]";
      form?.querySelector<HTMLElement>(sel)?.focus();
    });
  };

  return (
    <Modal
      open
      onClose={guard.requestClose}
      title="Received goods"
      description="What arrived, what you paid and who paid it."
      widthClassName="max-w-3xl"
      footer={guard.prompt ?? (
        <>
          <p className="mr-auto self-center text-sm text-fg-muted max-sm:order-last" aria-live="polite">Total <span className="font-semibold tabular-nums text-fg">{formatPrice(totalMinor / 100)}</span></p>
          {reviewing
            ? <Button type="button" variant="outline" onClick={() => setReviewing(false)} disabled={save.isPending} data-testid="bought-edit">Edit</Button>
            : <Button type="button" variant="outline" onClick={guard.requestClose}>Cancel</Button>}
          <Button type="submit" form="stock-bought-form" loading={save.isPending} data-testid="bought-save">{reviewing ? "Confirm and record" : "Review purchase"}</Button>
        </>
      )}
    >
      <form id="stock-bought-form" className="space-y-6" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        {problem && <div ref={errorRef}><ProblemAlert problem={problem} /></div>}

        {reviewing && (
          <section aria-labelledby="bought-review" className="space-y-3" data-testid="bought-review">
            <div>
              <h3 id="bought-review" className="text-sm font-medium text-fg">Check against the bill</h3>
              <p className="text-sm text-fg-muted">This is what goes into stock. Edit if any size is wrong.</p>
            </div>
            <Table data-no-stack="" className="w-full text-sm">
              <caption className="sr-only">Units arriving per item</caption>
              <thead>
                <tr><th scope="col" className="text-left font-medium text-fg-muted">Item</th><th scope="col" className="text-right font-medium text-fg-muted">Units</th></tr>
              </thead>
              <tbody>
                {arriving.map((a) => (
                  <tr key={a.id} data-testid="bought-review-row">
                    <td className="py-1.5 pr-3 text-fg">{a.label}</td>
                    <td className="py-1.5 text-right tabular-nums text-fg">{num(a.qty)} {a.unit}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line-subtle">
                  <th scope="row" className="pt-2 text-left font-medium text-fg">Total · matches the bill</th>
                  <td className="pt-2 text-right font-semibold tabular-nums text-fg" data-testid="bought-review-total">{num(unitsEntered)}</td>
                </tr>
              </tfoot>
            </Table>
          </section>
        )}

        <div className={cn("space-y-6", reviewing && "hidden")}>
        <section aria-labelledby="bought-items" className="space-y-3">
          <h3 id="bought-items" className="text-sm font-medium text-fg">Items</h3>
          {lines.map((l, i) => (
            <BoughtLine
              key={l.key}
              line={l}
              qty={totals[i]!.qty}
              minor={totals[i]!.minor}
              extrasShare={goodsMinor ? (extrasMinor * totals[i]!.minor) / goodsMinor : 0}
              lastEach={lastEachOf(l)}
              error={tried ? lineErrors[i] : null}
              onChange={(patch) => update(l.key, patch)}
              onRemove={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
            />
          ))}
          <div className="space-y-2">
            <SearchInput value={query} onChange={setQuery} placeholder={lines.length ? "Add another item…" : "Find an item: oil, bottle, box, cap…"} aria-label="Find an item to add" data-testid="bought-search" />
            {tried && !lines.length && <p className="ui-field-error">Add at least one item</p>}
            {!q && results.length > 0 && <p className="text-xs text-fg-muted">{purchases.length ? "Bought most often" : "Items"}</p>}
            <ul className={cn("flex flex-wrap gap-2", q && "flex-col gap-0 divide-y divide-line-subtle rounded-xl border border-line-subtle")} data-testid="bought-choices">
              {results.map((c) => (
                <li key={c.id} className={q ? undefined : "max-w-full"}>
                  <button
                    type="button"
                    onClick={() => add(c)}
                    className={cn(
                      "flex min-h-11 w-full items-center gap-2 text-left text-sm transition-colors duration-fast",
                      q ? "justify-between px-3 py-2 hover:bg-ink-900/[0.03]" : "max-w-full rounded-full border border-line px-3.5 py-1.5 hover:border-ink-400 hover:bg-surface",
                    )}
                  >
                    <span className="min-w-0 truncate"><span className="text-fg">{c.label}</span>{q && <span className="block truncate text-xs text-fg-muted">{c.detail}</span>}</span>
                    <Plus aria-hidden="true" className="h-4 w-4 shrink-0 text-fg-subtle" />
                  </button>
                </li>
              ))}
              {q && results.length === 0 && <li className="px-3 py-3 text-sm text-fg-muted">Nothing matches &ldquo;{query}&rdquo;. New items are added under Materials or Products first.</li>}
            </ul>
          </div>
        </section>

        <section aria-labelledby="bought-extras" className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 id="bought-extras" className="text-sm font-medium text-fg">Extra costs <span className="font-normal text-fg-muted">(transport, customs…)</span></h3>
            <Button type="button" variant="ghost" size="sm" onClick={() => setExtras((x) => [...x, { key: nextKey(), description: "", amount: "" }])} data-testid="bought-add-extra"><Plus className="h-4 w-4" aria-hidden="true" /> Add</Button>
          </div>
          {extras.length === 0 ? (
            <p className="text-sm text-fg-muted">None. An extra cost is spread over the items by value, so their cost per unit includes it.</p>
          ) : (
            extras.map((x, i) => (
              <div key={x.key} className="grid grid-cols-[minmax(0,1fr)_7.5rem_2rem] items-start gap-2">
                <Field htmlFor={`bx-d-${x.key}`} label={<span className="sr-only">What it was</span>} error={tried && extraErrors[i] === "Say what it was" ? extraErrors[i] : undefined}>
                  <Input id={`bx-d-${x.key}`} value={x.description} placeholder="e.g. Transport…" autoComplete="off" maxLength={120} onChange={(e) => setExtras((xs) => xs.map((y) => (y.key === x.key ? { ...y, description: e.target.value } : y)))} />
                </Field>
                <Field htmlFor={`bx-a-${x.key}`} label={<span className="sr-only">Amount ({storeCurrencySymbol()})</span>} error={tried && extraErrors[i] === "Enter the amount" ? "Amount" : undefined}>
                  <Input id={`bx-a-${x.key}`} inputMode="decimal" className="text-right tabular-nums" value={x.amount} placeholder={storeCurrencySymbol()} onChange={(e) => setExtras((xs) => xs.map((y) => (y.key === x.key ? { ...y, amount: e.target.value } : y)))} />
                </Field>
                <IconButton aria-label="Remove this extra cost" size="sm" className="mt-1" onClick={() => setExtras((xs) => xs.filter((y) => y.key !== x.key))}><X size={16} /></IconButton>
              </div>
            ))
          )}
        </section>

        <section aria-labelledby="bought-who" className="grid gap-3 sm:grid-cols-2">
          <h3 id="bought-who" className="sr-only">Supplier, date and payment</h3>
          <Field htmlFor="bought-supplier" label="Bought from" hint={supplier.trim() ? undefined : `Leave empty for “${DEFAULT_SUPPLIER}”`} error={tried ? supplierError : undefined}>
            <Input id="bought-supplier" value={supplier} placeholder={DEFAULT_SUPPLIER} autoComplete="off" maxLength={120} onChange={(e) => setSupplier(e.target.value)} />
          </Field>
          <Field htmlFor="bought-date" label="Date">
            <Input id="bought-date" type="date" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field
            htmlFor="bought-document-total"
            label="Units on the bill"
            required
            className="sm:col-span-2"
            hint={documentError && tried ? undefined : `Typed from the supplier's bill or receipt. The items above add up to ${num(unitsEntered)}.`}
            error={tried ? documentError : undefined}
          >
            <Input id="bought-document-total" inputMode="numeric" className="tabular-nums sm:max-w-40" value={documentTotal} onChange={(e) => setDocumentTotal(e.target.value)} data-testid="bought-document-total" />
          </Field>
          <Field
            htmlFor="bought-paid-from"
            label="Paid from"
            required
            className="sm:col-span-2"
            error={tried && !paidFrom ? "Choose who paid" : undefined}
            hint={
              shortOf ? <span className="text-warning-700">{shortOf.name} holds {formatPrice(shortOf.currentBalance)}; this needs {formatPrice(totalMinor / 100)}.</span>
                : paidFrom === OWNER ? "Booked as money the owner put in, then paid to the supplier."
                : accountsForbidden ? (canOwnerMoney ? "Your role can't see the money accounts — only the owner's own money is listed." : "Your role can't see the money accounts. Ask the owner to record this purchase.")
                : accountsQ.isError ? "The money accounts couldn't be loaded." : undefined
            }
          >
            <Select id="bought-paid-from" value={paidFrom} onChange={(e) => setPaidFrom(e.target.value)} disabled={accountsQ.isLoading} data-testid="bought-paid-from">
              <option value="">{accountsQ.isLoading ? "Loading…" : "Choose…"}</option>
              {canOwnerMoney && <option value={OWNER}>Owner&apos;s own money</option>}
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({formatPrice(a.currentBalance)})</option>)}
            </Select>
          </Field>
        </section>
        </div>
      </form>
    </Modal>
  );
}

/** A unit price this much above the last one is worth a second look (a typo, or a real rise) — never a block. */
const PRICE_JUMP = 0.2;

function BoughtLine({ line, qty, minor, extrasShare, lastEach, error, onChange, onRemove }: { line: Line; qty: number; minor: number; extrasShare: number; lastEach: number | null; error: string | null | undefined; onChange: (p: Partial<Line>) => void; onRemove: () => void }) {
  const { choice } = line;
  const v0 = choice.variants[0]!;
  const unit = choice.grid ? "pcs" : v0.unit;
  const each = qty && minor ? minor / 100 / qty : null;
  const jump = each !== null && lastEach ? each / lastEach - 1 : null;
  const withExtras = qty && minor && extrasShare ? (minor + extrasShare) / 100 / qty : null;
  const per = unit === "pcs" ? "each" : `per ${unit}`;
  const id = `bl-${line.key}`;
  return (
    <div className="rounded-xl border border-line-subtle p-3 sm:p-4" data-testid="bought-line">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-[15px] font-medium text-fg">{choice.label}{!choice.grid && variantWords(v0) !== v0.sku && !choice.label.toLowerCase().includes(variantWords(v0).toLowerCase()) && <span className="font-normal text-fg-muted"> · {variantWords(v0)}</span>}</p>
        <IconButton aria-label={`Remove ${choice.label}`} size="sm" className="-mr-1 -mt-1" onClick={onRemove}><X size={16} /></IconButton>
      </div>
      {choice.grid && <QtyGrid line={line} onChange={onChange} />}
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-[8rem_10rem_minmax(0,1fr)] sm:items-end">
        {choice.grid ? (
          <div className="min-w-0">
            <p className="ui-label">How many</p>
            <p className="flex h-10 items-center tabular-nums text-fg">{num(qty)} pcs</p>
          </div>
        ) : (
          <Field htmlFor={`${id}-q`} label={`How many (${unit})`}>
            <Input id={`${id}-q`} inputMode="numeric" className="tabular-nums" value={line.qty[v0.variantId] ?? ""} onChange={(e) => onChange({ qty: { [v0.variantId]: e.target.value } })} data-testid="bought-qty" />
          </Field>
        )}
        <Field htmlFor={`${id}-a`} label={`Paid in all (${storeCurrencySymbol()})`}>
          <Input id={`${id}-a`} inputMode="decimal" className="tabular-nums" value={line.amount} onChange={(e) => onChange({ amount: e.target.value })} data-testid="bought-amount" />
        </Field>
        <p className="col-span-2 text-sm text-fg-muted sm:col-span-1 sm:pb-2.5" aria-live="polite" data-testid="bought-per-unit">
          {each === null ? <span className="text-fg-subtle">Cost {per} shows here</span> : (
            <>
              <span className="font-medium tabular-nums text-fg">{formatPrice(each)}</span> {per}
              {withExtras !== null && <> · <span className="tabular-nums text-fg">{formatPrice(withExtras)}</span> with extras</>}
            </>
          )}
          {lastEach !== null && <span className="block text-xs text-fg-muted" data-testid="bought-last-price">Last time {formatPrice(lastEach)} {per}</span>}
        </p>
      </div>
      {jump !== null && jump > PRICE_JUMP && (
        <p className="mt-2 text-sm text-warning-700" role="status" data-testid="bought-price-check">
          {Math.round(jump * 100)}% more than last time. Check the amount is the total paid for all of them.
        </p>
      )}
      {error && <p className="ui-field-error mt-2" role="alert">{error}</p>}
    </div>
  );
}

/** Colours down, sizes across: how many of each arrived. */
function QtyGrid({ line, onChange }: { line: Line; onChange: (p: Partial<Line>) => void }) {
  const items = line.choice.variants;
  const sizes = [...new Set(items.map((i) => sizeOf(i) ?? ""))];
  const colors = [...new Set(items.map((i) => colorOf(i) ?? ""))];
  const at = new Map(items.map((i) => [`${colorOf(i) ?? ""}|${sizeOf(i) ?? ""}`, i]));
  return (
    <div className="mt-2 overflow-x-auto pb-1">
      <Table data-no-stack="" className="w-auto border-separate border-spacing-1 text-sm" data-testid="bought-grid">
        <caption className="sr-only">How many of each colour and size</caption>
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-10 bg-surface"><span className="sr-only">Colour</span></th>
            {sizes.map((s) => <th key={s} scope="col" className="px-1 text-center text-xs font-medium text-fg-muted">{s || "—"}</th>)}
          </tr>
        </thead>
        <tbody>
          {colors.map((c) => (
            <tr key={c}>
              {/* Pinned while the sizes scroll sideways on a phone, on a solid surface so inputs pass under it, never cut. */}
              <th scope="row" className="sticky left-0 z-10 whitespace-nowrap bg-surface pr-2 text-left text-xs font-medium text-fg">{c || "—"}</th>
              {sizes.map((s) => {
                const v = at.get(`${c}|${s}`);
                if (!v) return <td key={s} />;
                return (
                  <td key={s}>
                    <Input
                      aria-label={`${[c, s].filter(Boolean).join(" ")} — how many`}
                      inputMode="numeric"
                      className="h-10 w-14 px-1 text-center tabular-nums"
                      value={line.qty[v.variantId] ?? ""}
                      onChange={(e) => onChange({ qty: { ...line.qty, [v.variantId]: e.target.value } })}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

