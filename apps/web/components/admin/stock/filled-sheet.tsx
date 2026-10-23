"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { SegmentedControl } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import * as booksApi from "@/lib/api/finance-books";
import * as mfgApi from "@/lib/api/manufacturing";
import * as stockApi from "@/lib/api/stock";
import type { StockOverview, StockProblem } from "@/lib/api/stock";
import { formatPrice } from "@/lib/format";
import { idempotencyKeyFor, settleIdempotencyKey } from "@/lib/idempotency";
import { cn } from "@/lib/utils";
import { byProduct, materialName, num, spacedUnit, variantWords } from "./stock-shared";
import { ProblemAlert } from "./stock-problem";

interface Done { name: string; quantity: number; perBottle: number | null; number: string; replayed: boolean }

/**
 * Filled: bottles filled from bulk oil + an empty bottle + a box + a sticker (the approved recipe). Runs the quick refill —
 * the materials leave stock at their average cost and the bottles come in at that exact cost.
 */
export function FilledSheet({ overview, canFill, onClose }: { overview: StockOverview; canFill: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const formId = useRef(`stock-filled:${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`).current;
  const fill = useMemo(() => overview.groups.find((g) => g.key === "FILL_TO_ORDER")?.items ?? [], [overview]);
  const materials = useMemo(() => new Map((overview.groups.find((g) => g.key === "MATERIAL")?.items ?? []).map((m) => [m.variantId, m])), [overview]);
  const products = useMemo(() => byProduct(fill), [fill]);
  // The attar with most bottles to fill first.
  const firstNeed = [...fill].sort((a, b) => a.stock - b.stock)[0];
  const [productId, setProductId] = useState(firstNeed?.productId ?? products[0]?.productId ?? "");
  const product = products.find((p) => p.productId === productId);
  const [variantId, setVariantId] = useState(firstNeed?.variantId ?? product?.items[0]?.variantId ?? "");
  const variant = product?.items.find((v) => v.variantId === variantId) ?? product?.items[0];
  const [count, setCount] = useState(firstNeed && firstNeed.stock < 0 ? String(-firstNeed.stock) : "");
  const [problem, setProblem] = useState<StockProblem | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  const boms = useQuery({ queryKey: [...mfgApi.manufacturingKeys.all, "boms", "APPROVED"], queryFn: () => mfgApi.listBoms({ status: "APPROVED" }) });
  const recipe = useMemo(() => {
    let best: mfgApi.Bom | null = null;
    for (const b of boms.data?.boms ?? []) if (b.product.id === productId && (!best || b.version > best.version)) best = b;
    return best;
  }, [boms.data, productId]);
  const n = /^\d+$/.test(count.trim()) ? Number(count) : 0;
  const uses = (recipe?.lines ?? [])
    .filter((l) => l.suppliedBy === "BUSINESS" && (!l.finishedVariant || l.finishedVariant.id === variant?.variantId))
    .map((l) => {
      const need = Math.ceil(n * Number(l.qtyPerUnit) * (1 + Number(l.wastagePct) / 100));
      const stock = materials.get(l.material.variantId)?.stock ?? null;
      return { id: l.id, name: materials.get(l.material.variantId)?.productName ?? materialName(l.material.name), unit: l.material.stockUnit || "pcs", each: Number(l.qtyPerUnit), need, stock, left: stock === null ? null : stock - need };
    });
  const short = uses.filter((u) => u.left !== null && u.left < 0);

  const pick = (pid: string) => {
    setProductId(pid);
    const p = products.find((x) => x.productId === pid);
    const v = [...(p?.items ?? [])].sort((a, b) => a.stock - b.stock)[0];
    setVariantId(v?.variantId ?? "");
    setCount(v && v.stock < 0 ? String(-v.stock) : "");
    setProblem(null);
  };

  const run = useMutation({
    mutationFn: () => {
      const body = { variantId: variant!.variantId, quantity: n };
      return booksApi.quickRefill(body, idempotencyKeyFor(formId, body));
    },
    onSuccess: (r) => {
      settleIdempotencyKey(formId);
      setDone({ name: `${product!.name} ${spacedUnit(variantWords(variant!))}`, quantity: n, perBottle: r.order.finalCost?.perAcceptedUnit ?? null, number: r.order.number, replayed: r.replayed });
      setProblem(null);
      void qc.invalidateQueries({ queryKey: stockApi.stockKeys.all });
      void qc.invalidateQueries({ queryKey: booksApi.booksKeys.refills() });
      void qc.invalidateQueries({ queryKey: mfgApi.manufacturingKeys.all });
      toast.success(`${num(n)} bottle${n === 1 ? "" : "s"} filled`);
    },
    onError: (e) => {
      setProblem(stockApi.describeStockError(e, "The fill couldn't be recorded"));
      void qc.invalidateQueries({ queryKey: stockApi.stockKeys.all });
    },
  });

  const valid = Boolean(variant) && n > 0 && Boolean(recipe) && short.length === 0;

  return (
    <Modal
      open
      onClose={onClose}
      title="Filled"
      description="Bottles filled from the oil, bottles, boxes and stickers in stock."
      widthClassName="max-w-xl"
      footer={done ? (
        <>
          <Button variant="outline" onClick={() => { setDone(null); setCount(""); }} data-testid="filled-more">Fill more</Button>
          <Button onClick={onClose}>Done</Button>
        </>
      ) : (
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          {canFill && <Button type="submit" form="stock-filled-form" disabled={!valid} loading={run.isPending} data-testid="filled-save">Record {n > 0 ? `${num(n)} filled` : "fill"}</Button>}
        </>
      )}
    >
      {done ? (
        <div className="flex flex-col items-start gap-3 py-2" data-testid="filled-done" role="status">
          <CheckCircle2 className="h-8 w-8 text-success-600" aria-hidden="true" />
          <p className="text-[15px] text-fg">{num(done.quantity)} × {done.name} {done.replayed ? "were already recorded" : "are in stock"} <span className="text-fg-muted">({done.number})</span></p>
          {done.perBottle !== null && <p className="text-sm text-fg-muted">Cost per bottle <span className="text-lg font-semibold tabular-nums text-fg" data-testid="filled-cost">{formatPrice(done.perBottle)}</span></p>}
        </div>
      ) : products.length === 0 ? (
        <p className="text-sm text-fg-muted">No attar is set to fill to order yet.</p>
      ) : (
        <form id="stock-filled-form" className="space-y-5" onSubmit={(e) => { e.preventDefault(); if (valid && canFill) run.mutate(); }} noValidate>
          {problem && <ProblemAlert problem={problem} />}
          {!canFill && <p className="text-sm text-fg-muted">Recording a fill is for the owner; you can see what it would use.</p>}
          <fieldset>
            <legend className="ui-label">Attar</legend>
            <div className="flex flex-wrap gap-2" data-testid="filled-attar">
              {products.map((p) => (
                <button
                  key={p.productId}
                  type="button"
                  aria-pressed={p.productId === productId}
                  onClick={() => pick(p.productId)}
                  className={cn(
                    "min-h-10 rounded-full border px-3.5 text-sm transition-colors duration-fast",
                    p.productId === productId ? "border-accent bg-accent text-accent-fg" : "border-line text-fg hover:border-ink-400",
                  )}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </fieldset>
          {product && product.items.length > 1 && (
            <div>
              <p className="ui-label" id="filled-size-label">Size</p>
              <SegmentedControl
                aria-label="Bottle size"
                size="md"
                value={variant?.variantId ?? ""}
                onChange={(v) => { setVariantId(v); const it = product.items.find((x) => x.variantId === v); setCount(it && it.stock < 0 ? String(-it.stock) : ""); setProblem(null); }}
                options={product.items.map((i) => ({ value: i.variantId, label: spacedUnit(variantWords(i)), testId: `filled-size-${i.sku}` }))}
              />
            </div>
          )}
          {variant && (
            <p className="text-sm text-fg-muted" data-testid="filled-context">
              {num(variant.expectedOnShelf)} filled on the shelf · {num(variant.reserved)} on orders
              {variant.stock < 0 && <> · <span className="font-medium text-fg">{num(-variant.stock)} to fill</span></>} · can make {num(variant.makeable ?? 0)}
            </p>
          )}
          <Field htmlFor="filled-count" label="Bottles filled" required hint={variant && variant.stock < 0 ? "Filled in with the bottles orders are waiting for — change it to what you really filled." : undefined}>
            <Input id="filled-count" inputMode="numeric" className="max-w-[10rem] tabular-nums" value={count} onChange={(e) => { setCount(e.target.value); setProblem(null); }} data-testid="filled-count" />
          </Field>

          <section aria-labelledby="filled-uses" className="space-y-2">
            <h3 id="filled-uses" className="text-sm font-medium text-fg">Taken from stock</h3>
            {boms.isLoading ? <Skeleton className="h-24 w-full" /> : boms.isError ? (
              <p className="text-sm text-fg-muted">The recipe couldn&apos;t be loaded, so what it uses can&apos;t be shown. The fill still checks the stock.</p>
            ) : !recipe ? (
              <p className="text-sm text-danger-700">{product?.name} has no approved recipe, so it can&apos;t be filled. <Link href="/admin/manufacturing/boms" className="font-medium underline underline-offset-4">Add it in Bills of materials</Link>.</p>
            ) : (
              <ul className="divide-y divide-line-subtle rounded-xl border border-line-subtle text-sm" data-testid="filled-uses-list">
                {uses.map((u) => (
                  <li key={u.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 px-3 py-2.5">
                    <span className="min-w-0 text-fg">{u.name}<span className="block text-xs text-fg-muted">{num(u.each)}{u.unit === "pcs" ? "" : ` ${u.unit}`} a bottle</span></span>
                    <span className="text-right tabular-nums">
                      <span className="text-fg">{n ? `−${num(u.need)}` : "—"} <span className="text-xs text-fg-muted">{u.unit}</span></span>
                      <span className={cn("block text-xs", u.left !== null && u.left < 0 ? "font-medium text-danger-700" : "text-fg-muted")}>
                        {u.stock === null ? "stock not shown" : u.left !== null && u.left < 0 ? `only ${num(u.stock)} in stock` : `${num(u.left ?? u.stock)} left`}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {short.length > 0 && (
              <p className="text-sm text-danger-700" role="alert" data-testid="filled-short">
                Not enough {short.map((s) => `${s.name} (${num(-(s.left ?? 0))} ${s.unit} short)`).join(", ")}. Record what you bought first, or fill fewer.
              </p>
            )}
          </section>
        </form>
      )}
    </Modal>
  );
}
