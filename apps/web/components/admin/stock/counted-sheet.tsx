"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useDiscardGuard } from "@/components/ui/discard-guard";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import * as stockApi from "@/lib/api/stock";
import type { CountReason, CountResult, StockGroupKey, StockItem, StockOverview, StockProblem } from "@/lib/api/stock";
import { idempotencyKeyFor, settleIdempotencyKey } from "@/lib/idempotency";
import { formatBookDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { byProduct, num, spacedUnit, todayLocal, variantWords } from "./stock-shared";
import { ProblemAlert } from "./stock-problem";

const SHORT_REASONS: Array<{ value: CountReason; label: string }> = [
  { value: "DAMAGED", label: "Damaged" }, { value: "LOST", label: "Lost" }, { value: "SAMPLE", label: "Sample given" }, { value: "COUNT_FIX", label: "Count fix" },
];
const GAIN_REASONS: Array<{ value: CountReason; label: string }> = [{ value: "FOUND", label: "Found" }, { value: "COUNT_FIX", label: "Count fix" }];
const GROUP_TITLE: Record<StockGroupKey, string> = { MATERIAL: "Materials", FILL_TO_ORDER: "Filled attar bottles", FINISHED: "Sells as is" };
const ORDER: StockGroupKey[] = ["MATERIAL", "FILL_TO_ORDER", "FINISHED"];

/** Counted: what is on the shelf. Expected = stock + units on orders not yet booked with the courier (still on the shelf). */
export function CountedSheet({ overview, onClose }: { overview: StockOverview; onClose: () => void }) {
  const qc = useQueryClient();
  const formId = useRef(`stock-counted:${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`).current;
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<Record<string, CountReason | "">>({});
  const [query, setQuery] = useState("");
  const [date, setDate] = useState(todayLocal());
  const [tried, setTried] = useState(false);
  const [problem, setProblem] = useState<StockProblem | null>(null);
  const [result, setResult] = useState<CountResult | null>(null);

  const all = useMemo(() => ORDER.flatMap((k) => overview.groups.find((g) => g.key === k)?.items.map((i) => ({ ...i, group: k })) ?? []), [overview]);
  const byId = useMemo(() => new Map(all.map((i) => [i.variantId, i])), [all]);
  const q = query.trim().toLowerCase();
  const sections = ORDER.map((k) => ({
    key: k,
    products: byProduct(all.filter((i) => i.group === k && (!q || `${i.name} ${i.sku}`.toLowerCase().includes(q)))),
  })).filter((s) => s.products.length);

  const entered = all.filter((i) => /^\d+$/.test(counted[i.variantId]?.trim() ?? ""));
  const diffOf = (i: StockItem) => Number(counted[i.variantId]) - i.expectedOnShelf;
  const problemOf = (i: StockItem & { group: StockGroupKey }): string | null => {
    const raw = counted[i.variantId]?.trim() ?? "";
    if (!raw) return null;
    if (!/^\d+$/.test(raw)) return "A whole number";
    const d = diffOf(i);
    if (i.group !== "FILL_TO_ORDER" && Number(raw) < i.reserved) return `${num(i.reserved)} are on orders waiting to be packed — check those first`;
    if (d < 0 && !reason[i.variantId]) return "Say why it's short";
    return null;
  };
  const problems = all.map((i) => [i.variantId, problemOf(i)] as const).filter(([, p]) => p);
  const badInput = all.some((i) => (counted[i.variantId]?.trim() ?? "") !== "" && !/^\d+$/.test(counted[i.variantId]!.trim()));
  const differ = entered.filter((i) => diffOf(i) !== 0).length;
  // Caps and clothes are counted as a whole grid (inventory recovery F-c): once one size is entered, every size is — a size
  // left empty is not silently kept at its old figure. The server checks the same for the products sent as `products`.
  const enteredIds = new Set(entered.map((i) => i.variantId));
  const grids = byProduct(all.filter((i) => i.group === "FINISHED")).filter((p) => p.items.length > 1 && p.items.some((i) => enteredIds.has(i.variantId)));
  const partial = grids.filter((p) => p.items.some((i) => !enteredIds.has(i.variantId)));
  const valid = entered.length > 0 && problems.length === 0 && !badInput && partial.length === 0 && date <= todayLocal();

  const save = useMutation({
    mutationFn: () => {
      const body: stockApi.CountBody = {
        date,
        ...(grids.length ? { products: grids.map((p) => p.productId) } : {}),
        lines: entered.map((i) => {
          const d = diffOf(i);
          const r = reason[i.variantId] || (d > 0 ? "FOUND" : null);
          return { variantId: i.variantId, counted: Number(counted[i.variantId]), reason: d === 0 ? null : r };
        }),
      };
      return stockApi.recordStockCount(body, idempotencyKeyFor(formId, body));
    },
    onSuccess: (r) => {
      settleIdempotencyKey(formId);
      setResult(r);
      setProblem(null);
      toast.success(r.replayed ? "Already recorded — nothing was added twice" : "Count recorded");
      void qc.invalidateQueries({ queryKey: stockApi.stockKeys.all });
      void qc.invalidateQueries({ queryKey: ["finance"] });
    },
    onError: (e) => {
      setProblem(stockApi.describeStockError(e, "The count couldn't be recorded"));
      void qc.invalidateQueries({ queryKey: stockApi.stockKeys.overview() });
    },
  });

  // Typed counts aren't lost to a stray Escape, the close button or Cancel: those ask first.
  const dirty = Object.values(counted).some((v) => v.trim() !== "") || Object.values(reason).some(Boolean);
  const guard = useDiscardGuard(dirty, onClose, "Discard these counts?");

  if (result) {
    return (
      <Modal open onClose={onClose} title="Counted" description={`Recorded for ${formatBookDate(result.date)}.`} widthClassName="max-w-2xl" footer={<Button onClick={onClose} data-testid="counted-close">Done</Button>}>
        <div className="space-y-3" data-testid="counted-result">
          <p className="flex items-center gap-2 text-[15px] text-fg"><CheckCircle2 className="h-5 w-5 text-success-600" aria-hidden="true" /> {num(result.lines.length)} counted, {num(result.lines.filter((l) => l.difference).length)} booked as a difference</p>
          <ul className="divide-y divide-line-subtle rounded-xl border border-line-subtle text-sm">
            {result.lines.map((l) => {
              const i = byId.get(l.variantId);
              return (
                <li key={l.variantId} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 px-3 py-2.5" data-testid="counted-result-line">
                  <span className="min-w-0 text-fg">{i ? i.productName : "Item"}<span className="block text-xs text-fg-muted">{i && variantWords(i) !== i.sku ? `${spacedUnit(variantWords(i))} · ` : ""}expected {num(l.expected)}, counted {num(l.counted)}</span></span>
                  <span className={cn("self-center text-right tabular-nums", l.difference < 0 ? "text-danger-700" : l.difference > 0 ? "text-success-700" : "text-fg-muted")}>
                    {l.difference === 0 ? "Matches" : `${l.difference > 0 ? "+" : "−"}${num(Math.abs(l.difference))} booked`}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={guard.requestClose}
      title="Counted"
      description="Enter what is on the shelf. Leave a line empty if you didn't count it."
      widthClassName="max-w-2xl"
      footer={guard.prompt ?? (
        <>
          <p className="mr-auto self-center text-sm text-fg-muted max-sm:order-last" aria-live="polite">
            {num(entered.length)} counted{differ ? ` · ${num(differ)} differ` : ""}
            {tried && problems.length > 0 && <span className="text-danger-700"> · {num(problems.length)} to fix</span>}
          </p>
          <Button variant="outline" onClick={guard.requestClose}>Cancel</Button>
          <Button type="submit" form="stock-counted-form" loading={save.isPending} data-testid="counted-save">Record count</Button>
        </>
      )}
    >
      <form id="stock-counted-form" className="space-y-4" onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        if (valid) return save.mutate();
        // take the counter to the first line that needs attention
        const first = problems[0]?.[0];
        if (first) requestAnimationFrame(() => document.getElementById(`count-${first}`)?.focus());
      }} noValidate>
        {problem && <ProblemAlert problem={problem} />}
        {tried && !entered.length && <p className="ui-field-error" role="alert">Count at least one item</p>}
        {partial.length > 0 && (
          <p className={tried ? "ui-field-error" : "text-sm text-warning-700"} role={tried ? "alert" : undefined} data-testid="counted-partial-grid">
            Count every size of {partial.map((p) => p.name).join(", ")} — enter 0 for a size you have none of.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem] sm:items-end">
          <SearchInput value={query} onChange={setQuery} placeholder="Find an item…" aria-label="Find an item to count" />
          <Field htmlFor="counted-date" label="Counted on"><Input id="counted-date" type="date" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <p className="text-xs text-fg-muted">Expected = in stock + on orders not yet handed to the courier (they are still on the shelf).</p>
        {sections.length === 0 && <p className="text-sm text-fg-muted">Nothing matches &ldquo;{query}&rdquo;.</p>}
        {sections.map((s) => (
          <section key={s.key} aria-labelledby={`count-${s.key}`} className="space-y-2">
            <h3 id={`count-${s.key}`} className="text-sm font-medium text-fg">{GROUP_TITLE[s.key]}</h3>
            <ul className="divide-y divide-line-subtle rounded-xl border border-line-subtle">
              {s.products.map((p) => p.items.map((raw, k) => {
                const i = raw as StockItem & { group: StockGroupKey };
                const value = counted[i.variantId] ?? "";
                const has = /^\d+$/.test(value.trim());
                const d = has ? diffOf(i) : 0;
                const err = tried || (has && d < 0 && !reason[i.variantId]) ? problemOf(i) : null;
                const showName = p.items.length === 1 || k === 0;
                const inputId = `count-${i.variantId}`;
                const label = p.items.length > 1 ? spacedUnit(variantWords(i)) : i.group === "MATERIAL" ? i.productName : `${p.name}${variantWords(i) !== i.sku ? ` ${spacedUnit(variantWords(i))}` : ""}`;
                return (
                  <li key={i.variantId} className="px-3 py-2.5" data-testid="count-line" data-variant={i.sku}>
                    {p.items.length > 1 && showName && <p className="pb-1.5 text-sm font-medium text-fg">{p.name}</p>}
                    <div className="grid grid-cols-[minmax(0,1fr)_9.5rem] items-center gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,1fr)_5.5rem_4.5rem_9.5rem]">
                      <label htmlFor={inputId} className="min-w-0 text-sm text-fg">
                        <span className={cn(p.items.length > 1 && "text-fg-muted")}>{label}</span>
                        <span className="block text-xs text-fg-muted">expected {num(i.expectedOnShelf)} {i.unit}{i.reserved ? ` (${num(i.reserved)} on orders)` : ""}</span>
                      </label>
                      <Input
                        id={inputId}
                        inputMode="numeric"
                        placeholder="—"
                        className="h-10 text-right tabular-nums max-sm:w-[5.5rem] max-sm:justify-self-end"
                        value={value}
                        aria-invalid={err ? true : undefined}
                        aria-describedby={err ? `${inputId}-err` : undefined}
                        onChange={(e) => { setCounted((c) => ({ ...c, [i.variantId]: e.target.value })); setProblem(null); }}
                      />
                      <span className={cn("text-right text-sm tabular-nums max-sm:col-start-1 max-sm:row-start-2 max-sm:text-left", !has || d === 0 ? "text-fg-subtle" : d < 0 ? "font-medium text-danger-700" : "font-medium text-success-700")} aria-live="polite">
                        {!has ? "" : d === 0 ? "Matches" : `${d > 0 ? "+" : "−"}${num(Math.abs(d))}`}
                      </span>
                      {has && d !== 0 ? (
                        <Select
                          aria-label={`Why ${label} ${d < 0 ? "is short" : "is over"}`}
                          className="h-10 max-sm:col-start-2 max-sm:row-start-2"
                          value={reason[i.variantId] || (d > 0 ? "FOUND" : "")}
                          onChange={(e) => setReason((r) => ({ ...r, [i.variantId]: e.target.value as CountReason }))}
                          data-testid="count-reason"
                        >
                          {d < 0 && <option value="">Why short?</option>}
                          {(d < 0 ? SHORT_REASONS : GAIN_REASONS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </Select>
                      ) : <span className="hidden sm:block" />}
                    </div>
                    {err && <p id={`${inputId}-err`} className="ui-field-error mt-1.5">{err}</p>}
                  </li>
                );
              }))}
            </ul>
          </section>
        ))}
      </form>
    </Modal>
  );
}
