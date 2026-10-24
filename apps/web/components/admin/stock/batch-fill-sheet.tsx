"use client";

import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import * as booksApi from "@/lib/api/finance-books";
import * as mfgApi from "@/lib/api/manufacturing";
import * as stockApi from "@/lib/api/stock";
import type { StockOverview, StockProblem } from "@/lib/api/stock";
import { getStockToday, type StockToday } from "@/lib/api/stock-smart";
import { idempotencyKeyFor, settleIdempotencyKey } from "@/lib/idempotency";
import { cn } from "@/lib/utils";
import { materialName, num, spacedUnit } from "./stock-shared";
import { ProblemAlert } from "./stock-problem";

type LineState = "idle" | "saving" | "done" | "failed";
interface Line { variantId: string; productId: string; name: string; owed: number; on: boolean; qty: string; state: LineState }

/**
 * Mark filled (docs/STOCK_HUB.md §7): every size orders are waiting for, ticked at the bottles owed, saved in one go. Each
 * size is its own guarded fill (POST /stock/fills), sent one after another; if one is refused the rest wait, the ones saved
 * stay saved, and "Try again" carries on from there (the same request replays, so nothing is recorded twice).
 */
export function BatchFillSheet({ overview, fill, canFill, onSingle, onClose }: {
  overview: StockOverview;
  fill: NonNullable<StockToday["fill"]>;
  canFill: boolean;
  onSingle: () => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const formId = useRef(`stock-batch-fill:${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`).current;
  const items = useMemo(() => new Map(overview.groups.flatMap((g) => g.items).map((i) => [i.variantId, i])), [overview]);
  const [lines, setLines] = useState<Line[]>(() => fill.lines.map((l) => ({ variantId: l.variantId, productId: items.get(l.variantId)?.productId ?? "", name: l.name, owed: l.owed, on: true, qty: String(l.owed), state: "idle" })));
  const [problem, setProblem] = useState<StockProblem | null>(null);
  const [running, setRunning] = useState(false);
  const boms = useQuery({ queryKey: [...mfgApi.manufacturingKeys.all, "boms", "APPROVED"], queryFn: () => mfgApi.listBoms({ status: "APPROVED" }) });

  const qtyOf = (l: Line) => (/^\d+$/.test(l.qty.trim()) ? Number(l.qty) : 0);
  const chosen = lines.filter((l) => l.on && qtyOf(l) > 0);
  const total = chosen.reduce((s, l) => s + qtyOf(l), 0);
  const allDone = lines.some((l) => l.state === "done") && chosen.every((l) => l.state === "done");

  // what the ticked bottles take, by the latest approved recipe of each attar
  const takes = useMemo(() => {
    const latest = new Map<string, mfgApi.Bom>();
    for (const b of boms.data?.boms ?? []) if (!latest.has(b.product.id) || b.version > latest.get(b.product.id)!.version) latest.set(b.product.id, b);
    const sum = new Map<string, { name: string; unit: string; need: number; stock: number | null }>();
    for (const l of chosen) {
      if (l.state === "done") continue;
      for (const r of latest.get(l.productId)?.lines ?? []) {
        if (r.suppliedBy !== "BUSINESS" || (r.finishedVariant && r.finishedVariant.id !== l.variantId)) continue;
        const m = items.get(r.material.variantId);
        const row = sum.get(r.material.variantId) ?? { name: m?.productName ?? materialName(r.material.name), unit: r.material.stockUnit || "pcs", need: 0, stock: m?.stock ?? null };
        row.need += Math.ceil(qtyOf(l) * Number(r.qtyPerUnit) * (1 + Number(r.wastagePct) / 100));
        sum.set(r.material.variantId, row);
      }
    }
    return [...sum.values()];
  }, [boms.data, chosen, items]);
  const short = takes.filter((t) => t.stock !== null && t.need > t.stock);

  const set = (variantId: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.variantId === variantId ? { ...l, ...patch, state: patch.state ?? (l.state === "failed" ? "idle" : l.state) } : l)));

  async function save() {
    setRunning(true);
    setProblem(null);
    // Bottles may have been filled since this opened — a parcel booked meanwhile records its own — so each size is filled
    // only up to what it still owes now, never twice.
    const fresh = await getStockToday().catch(() => null);
    const owedNow = fresh ? new Map((fresh.fill?.lines ?? []).map((x) => [x.variantId, x.owed])) : null;
    let saved = 0;
    let trimmed = 0;
    for (const l of lines) {
      if (!l.on || qtyOf(l) <= 0 || l.state === "done") continue;
      const quantity = owedNow ? Math.min(qtyOf(l), owedNow.get(l.variantId) ?? 0) : qtyOf(l);
      if (quantity < qtyOf(l)) trimmed += qtyOf(l) - quantity;
      if (quantity <= 0) { set(l.variantId, { state: "done", qty: "0" }); continue; }
      set(l.variantId, { state: "saving", qty: String(quantity) });
      const body: stockApi.FillBody = { variantId: l.variantId, quantity };
      const scope = `${formId}:${l.variantId}`;
      try {
        await stockApi.recordFill(body, idempotencyKeyFor(scope, body));
        settleIdempotencyKey(scope);
        saved += quantity;
        set(l.variantId, { state: "done" });
      } catch (e) {
        set(l.variantId, { state: "failed" });
        setProblem(stockApi.describeStockError(e, `${l.name} couldn't be recorded`));
        break;
      }
    }
    setRunning(false);
    void qc.invalidateQueries({ queryKey: stockApi.stockKeys.all });
    void qc.invalidateQueries({ queryKey: booksApi.booksKeys.refills() });
    void qc.invalidateQueries({ queryKey: mfgApi.manufacturingKeys.all });
    if (saved) toast.success(`${num(saved)} bottle${saved === 1 ? "" : "s"} marked filled`);
    if (trimmed) toast.info(`${num(trimmed)} bottle${trimmed === 1 ? " was" : "s were"} already recorded when their parcels were booked`);
  }

  const failed = lines.some((l) => l.state === "failed");
  return (
    <Modal
      open
      onClose={running ? () => undefined : onClose}
      title="Mark bottles filled"
      description="Everything orders are waiting for is listed. Untick or change what you didn't fill."
      widthClassName="max-w-xl"
      footer={allDone ? <Button onClick={onClose} data-testid="batch-fill-done">Done</Button> : (
        <>
          <Button variant="outline" onClick={onClose} disabled={running}>Cancel</Button>
          {canFill && (
            <Button onClick={save} loading={running} disabled={total === 0 || short.length > 0} data-testid="batch-fill-save">
              {failed ? "Try again" : `Mark ${num(total)} filled`}
            </Button>
          )}
        </>
      )}
    >
      <div className="space-y-5" data-testid="batch-fill">
        {problem && <ProblemAlert problem={problem} />}
        {!canFill && <p className="text-sm text-fg-muted">Recording a fill is for the owner; you can see what it would use.</p>}
        <ul className="divide-y divide-line-subtle rounded-xl border border-line-subtle">
          {lines.map((l) => (
            <li key={l.variantId} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5" data-testid="batch-fill-line">
              <span className="grid place-items-center">
                {l.state === "done" ? <CheckCircle2 className="h-5 w-5 text-success-600" aria-label="Recorded" />
                  : l.state === "saving" ? <Loader2 className="h-5 w-5 animate-spin text-fg-muted" aria-label="Saving" />
                    : l.state === "failed" ? <XCircle className="h-5 w-5 text-danger-600" aria-label="Not recorded" />
                      : <Checkbox checked={l.on} onChange={(e) => set(l.variantId, { on: e.target.checked })} disabled={running} aria-label={`Include ${l.name}`} data-testid="batch-fill-tick" />}
              </span>
              <label htmlFor={`batch-${l.variantId}`} className={cn("min-w-0 text-sm", l.on ? "text-fg" : "text-fg-subtle")}>
                <span className="block truncate">{l.name}</span>
                <span className="block text-xs text-fg-muted">{num(l.owed)} waiting</span>
              </label>
              <Input
                id={`batch-${l.variantId}`}
                inputMode="numeric"
                className="w-20 text-right tabular-nums"
                value={l.qty}
                onChange={(e) => set(l.variantId, { qty: e.target.value.replace(/\D/g, "") })}
                disabled={!l.on || running || l.state === "done"}
                data-testid="batch-fill-qty"
              />
            </li>
          ))}
        </ul>

        <section aria-labelledby="batch-takes" className="space-y-2">
          <h3 id="batch-takes" className="text-sm font-medium text-fg">Taken from stock</h3>
          {boms.isLoading ? <Skeleton className="h-16 w-full" /> : boms.isError ? (
            <p className="text-sm text-fg-muted">The recipes couldn&apos;t be loaded, so this can&apos;t be shown. Each fill still checks the stock.</p>
          ) : takes.length === 0 ? (
            <p className="text-sm text-fg-muted">{allDone ? "All recorded." : "Nothing ticked."}</p>
          ) : (
            <ul className="space-y-1 text-sm" data-testid="batch-fill-takes">
              {takes.map((t) => (
                <li key={t.name} className="flex justify-between gap-4">
                  <span className="text-fg">{t.name}</span>
                  <span className={cn("tabular-nums", t.stock !== null && t.need > t.stock ? "font-medium text-danger-700" : "text-fg-muted")}>
                    −{num(t.need)} {t.unit === "pcs" ? "" : spacedUnit(t.unit)}{t.stock !== null && <> · {t.need > t.stock ? `only ${num(t.stock)} in stock` : `${num(t.stock - t.need)} left`}</>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {short.length > 0 && <p className="text-sm text-danger-700" role="alert" data-testid="batch-fill-short">Not enough {short.map((s) => s.name).join(", ")}. Untick some bottles or record what you bought first.</p>}
        </section>

        {!running && !allDone && (
          <button type="button" onClick={onSingle} className="text-sm font-medium text-fg underline underline-offset-4 hover:text-accent" data-testid="batch-fill-single">
            Filled bottles for later, or something spilt?
          </button>
        )}
      </div>
    </Modal>
  );
}
