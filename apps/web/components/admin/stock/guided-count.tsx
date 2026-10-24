"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDiscardGuard } from "@/components/ui/discard-guard";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/toast";
import * as stockApi from "@/lib/api/stock";
import type { CountReason, CountResult, StockItem, StockOverview, StockProblem } from "@/lib/api/stock";
import { formatPrice } from "@/lib/format";
import { idempotencyKeyFor, settleIdempotencyKey } from "@/lib/idempotency";
import { cn } from "@/lib/utils";
import { num, spacedUnit, todayLocal, variantWords } from "./stock-shared";
import { ProblemAlert } from "./stock-problem";

const SHORT: Array<{ value: CountReason; label: string }> = [
  { value: "DAMAGED", label: "Damaged" }, { value: "LOST", label: "Lost" }, { value: "SAMPLE", label: "Given as samples" }, { value: "COUNT_FIX", label: "Miscounted before" },
];
const OVER: Array<{ value: CountReason; label: string }> = [{ value: "FOUND", label: "Found" }, { value: "COUNT_FIX", label: "Miscounted before" }];

type Step = StockItem & { group: stockApi.StockGroupKey };

/**
 * This week's count, one item at a time (docs/STOCK_HUB.md §7) — made for a phone in one hand at the shelf. Each screen:
 * what the books say (stock + parcels still on the shelf), one large number to type, the difference at once and, when it
 * differs, the reason in one tap. A cap or garment comes with all its sizes (a grid is counted whole). The last screen sums
 * it up and saves one count; a staff loss over the limit is kept and waits for the owner.
 */
export function GuidedCount({ overview, due, showCost, onClose }: { overview: StockOverview; due: string[]; showCost: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const formId = useRef(`stock-guided:${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`).current;
  const steps = useMemo<Step[]>(() => {
    const all = overview.groups.flatMap((g) => g.items.map((i) => ({ ...i, group: g.key })));
    const out: Step[] = [];
    for (const id of due) {
      const item = all.find((i) => i.variantId === id);
      if (!item) continue;
      // a size of a product with several is counted with all of them
      const family = item.group === "FINISHED" ? all.filter((i) => i.productId === item.productId) : [item];
      for (const f of family) if (!out.some((o) => o.variantId === f.variantId)) out.push(f);
    }
    return out;
  }, [overview, due]);
  const [at, setAt] = useState(0);
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<Record<string, CountReason>>({});
  const [problem, setProblem] = useState<StockProblem | null>(null);
  const [result, setResult] = useState<CountResult | null>(null);

  const done = at >= steps.length;
  const step = steps[at];
  const value = (i: Step) => counted[i.variantId]?.trim() ?? "";
  const diff = (i: Step) => Number(value(i)) - i.expectedOnShelf;
  const entered = steps.filter((i) => /^\d+$/.test(value(i)));
  const needsReason = (i: Step) => /^\d+$/.test(value(i)) && diff(i) < 0 && !reason[i.variantId];
  const belowOrders = (i: Step) => i.group !== "FILL_TO_ORDER" && /^\d+$/.test(value(i)) && Number(value(i)) < i.reserved;
  const grids = [...new Set(entered.filter((i) => i.group === "FINISHED" && steps.filter((s) => s.productId === i.productId).length > 1).map((i) => i.productId))];
  const incompleteGrid = grids.some((pid) => steps.filter((s) => s.productId === pid).some((s) => !/^\d+$/.test(value(s))));

  const guard = useDiscardGuard(entered.length > 0 && !result, onClose, "Discard this count?");
  const save = useMutation({
    mutationFn: () => {
      const body: stockApi.CountBody = {
        date: todayLocal(),
        ...(grids.length ? { products: grids } : {}),
        lines: entered.map((i) => ({ variantId: i.variantId, counted: Number(value(i)), reason: diff(i) === 0 ? null : reason[i.variantId] ?? (diff(i) > 0 ? "FOUND" : null) })),
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
    onError: (e) => setProblem(stockApi.describeStockError(e, "The count couldn't be recorded")),
  });

  const name = (i: Step) => (i.group === "MATERIAL" ? i.productName : `${i.productName}${variantWords(i) !== i.sku ? ` — ${spacedUnit(variantWords(i))}` : ""}`);
  const unit = (i: Step) => (i.unit === "pcs" ? "" : ` ${spacedUnit(i.unit)}`);
  const short = entered.filter((i) => diff(i) < 0);
  const over = entered.filter((i) => diff(i) > 0);
  const lossValue = short.reduce((s, i) => s + (i.avgCost ?? 0) * -diff(i), 0);
  const waiting = result?.lines.filter((l) => l.pendingApprovalId).length ?? 0;

  const footer = guard.prompt ?? (result ? <Button onClick={onClose} data-testid="guided-close">Done</Button> : done ? (
    <>
      <Button variant="outline" onClick={() => setAt(steps.length - 1)} disabled={save.isPending}>Back</Button>
      <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!entered.length || steps.some(needsReason) || steps.some(belowOrders) || incompleteGrid} data-testid="guided-save">Save count</Button>
    </>
  ) : (
    <>
      <Button variant="outline" onClick={() => setAt((a) => Math.max(0, a - 1))} disabled={at === 0}>Back</Button>
      <Button variant="ghost" onClick={() => { setCounted((c) => ({ ...c, [step!.variantId]: "" })); setAt((a) => a + 1); }} data-testid="guided-skip">Skip</Button>
      <Button onClick={() => setAt((a) => a + 1)} disabled={!step || needsReason(step) || belowOrders(step)} data-testid="guided-next">{at === steps.length - 1 ? "Review" : "Next"}</Button>
    </>
  ));

  return (
    <Modal open onClose={guard.requestClose} title="This week's count" description={result ? undefined : done ? "Check, then save." : `${num(Math.min(at + 1, steps.length))} of ${num(steps.length)}`} widthClassName="max-w-md" footer={footer}>
      <div className="space-y-5" data-testid="guided-count">
        {!result && (
          <div className="h-1 overflow-hidden rounded-full bg-ink-900/[0.06]" aria-hidden="true">
            <div className="h-full rounded-full bg-success-600 transition-[width] duration-base ease-smooth" style={{ width: `${(Math.min(at, steps.length) / Math.max(1, steps.length)) * 100}%` }} />
          </div>
        )}
        {problem && <ProblemAlert problem={problem} />}

        {result ? (
          <div className="flex flex-col items-start gap-3" role="status" data-testid="guided-done">
            <CheckCircle2 className="h-8 w-8 text-success-600" aria-hidden="true" />
            <p className="text-[15px] text-fg">{num(result.lines.length)} item{result.lines.length === 1 ? "" : "s"} counted{result.lines.every((l) => l.difference === 0) ? " — all match the books." : "."}</p>
            {waiting > 0 && <p className="text-sm text-warning-700" data-testid="guided-waiting">{num(waiting)} loss{waiting === 1 ? "" : "es"} over the limit {waiting === 1 ? "waits" : "wait"} for the owner&apos;s approval. The stock changes once approved.</p>}
          </div>
        ) : done ? (
          <div className="space-y-3" data-testid="guided-summary">
            <p className="text-sm text-fg">{num(entered.length - short.length - over.length)} match · <span className={short.length ? "text-danger-700" : undefined}>{num(short.length)} short</span> · {num(over.length)} over</p>
            {showCost && short.length > 0 && <p className="text-sm text-fg-muted">Loss at average cost: <span className="font-semibold tabular-nums text-fg">{formatPrice(lossValue)}</span></p>}
            {incompleteGrid && <p className="text-sm text-danger-700" role="alert">Count every size of a product, or skip all of them — go back to fill the empty ones.</p>}
            <ul className="divide-y divide-line-subtle rounded-xl border border-line-subtle text-sm">
              {entered.map((i) => (
                <li key={i.variantId} className="flex justify-between gap-3 px-3 py-2">
                  <span className="min-w-0 truncate text-fg">{name(i)}</span>
                  <span className={cn("tabular-nums", diff(i) < 0 ? "text-danger-700" : diff(i) > 0 ? "text-success-700" : "text-fg-muted")}>{diff(i) === 0 ? "matches" : `${diff(i) > 0 ? "+" : ""}${num(diff(i))}`}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : step ? (
          <div className="space-y-4" data-testid="guided-step">
            <div>
              <p className="text-xl font-semibold leading-snug text-fg">{name(step)}</p>
              <p className="mt-1 text-sm text-fg-muted">The books say {num(step.expectedOnShelf)}{unit(step)}{step.reserved > 0 ? `, ${num(step.reserved)} of them packed for orders` : ""}.</p>
            </div>
            <label htmlFor="guided-qty" className="sr-only">How many are on the shelf</label>
            <Input
              id="guided-qty"
              key={step.variantId}
              autoFocus
              inputMode="numeric"
              enterKeyHint="next"
              className="!h-16 text-center !text-4xl font-semibold tabular-nums"
              value={counted[step.variantId] ?? ""}
              onChange={(e) => setCounted((c) => ({ ...c, [step.variantId]: e.target.value.replace(/\D/g, "") }))}
              onKeyDown={(e) => { if (e.key === "Enter" && !needsReason(step) && !belowOrders(step)) { e.preventDefault(); setAt((a) => a + 1); } }}
              placeholder="0"
              data-testid="guided-qty"
            />
            {belowOrders(step) && <p className="text-sm text-danger-700" role="alert">{num(step.reserved)} are packed for orders — check those parcels first.</p>}
            {/^\d+$/.test(value(step)) && diff(step) !== 0 && !belowOrders(step) && (
              <div className="space-y-2">
                <p className={cn("rounded-xl px-3 py-2 text-sm", diff(step) < 0 ? "bg-warning-100 text-warning-700" : "bg-success-100 text-success-700")} data-testid="guided-diff">
                  {num(Math.abs(diff(step)))} {diff(step) < 0 ? "fewer" : "more"} than the books. Why?
                </p>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Reason">
                  {(diff(step) < 0 ? SHORT : OVER).map((r) => {
                    const on = (reason[step.variantId] ?? (diff(step) > 0 ? "FOUND" : undefined)) === r.value;
                    return (
                      <button key={r.value} type="button" aria-pressed={on} onClick={() => setReason((x) => ({ ...x, [step.variantId]: r.value }))} data-testid={`guided-reason-${r.value}`}
                        className={cn("min-h-10 rounded-full border px-3.5 text-sm transition-colors duration-fast", on ? "border-fg bg-fg text-surface" : "border-line text-fg hover:border-ink-400")}>
                        {r.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {/^\d+$/.test(value(step)) && diff(step) === 0 && <p className="text-sm text-success-700" data-testid="guided-match">Matches the books.</p>}
          </div>
        ) : (
          <p className="text-sm text-fg-muted">Nothing to count this week.</p>
        )}
      </div>
    </Modal>
  );
}
