"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { SegmentedControl } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as api from "@/lib/api/cost-sheets";
import type { CostLineKind, CostLineMode, CostSheetLine } from "@/lib/api/cost-sheets";
import { formatPrice, storeCurrencySymbol } from "@/lib/format";
import { cn } from "@/lib/utils";

type Own = { mode: CostLineMode; amount: string };
const keyOf = (kind: CostLineKind, variantId: string | null) => `${kind}:${variantId ?? ""}`;
const ASSUMPTIONS = [
  { key: "insideDhakaPct", label: "Parcels inside Dhaka" },
  { key: "codPct", label: "Paid cash on delivery" },
  { key: "returnRatePct", label: "Parcels that come back" },
  { key: "targetMarginPct", label: "Target profit" },
] as const;

/** Profit maths for one size, as the API does it: every line is fixed + percent × price. */
function economics(lines: Array<{ kind: CostLineKind; fixed: number | null; percent: number }>, price: number, target: number) {
  const known = lines.filter((l) => l.fixed !== null);
  const amount = (l: { fixed: number | null; percent: number }) => (l.fixed ?? 0) + (l.percent / 100) * price;
  const total = known.reduce((s, l) => s + amount(l), 0);
  const fixed = known.reduce((s, l) => s + (l.fixed ?? 0), 0);
  const percent = known.reduce((s, l) => s + l.percent, 0);
  const ads = lines.find((l) => l.kind === "ADS");
  const denom = 1 - target / 100 - percent / 100;
  return {
    total,
    complete: known.length === lines.length,
    profit: price - total,
    margin: price > 0 ? ((price - total) / price) * 100 : null,
    breakEvenAds: price - (total - (ads && ads.fixed !== null ? amount(ads) : 0)),
    suggested: known.length === lines.length && denom > 0 ? Math.ceil((fixed / denom) * 100) / 100 : null,
  };
}

/** Cost & profit on the product (docs/COST_SHEET.md): each cost of one sale, where it comes from, and what is left. A cost
 * can be set here for every size or one size; left alone it follows the category, the shop, or is worked out. */
export function CostSheetField({ productId }: { productId: string }) {
  const { can } = useCapabilities();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: api.costSheetKeys.product(productId), queryFn: () => api.getProductCostSheet(productId), enabled: can("costing.view") });
  const [sizeId, setSizeId] = useState<string | null>(null);
  const [scope, setScope] = useState<"all" | "size">("all");
  const [own, setOwn] = useState<Map<string, Own> | null>(null);
  const [assume, setAssume] = useState<Record<string, string> | null>(null);
  const [tryPrice, setTryPrice] = useState("");

  const sheet = q.data;
  const size = sheet?.sizes.find((s) => s.variantId === sizeId) ?? sheet?.sizes[0];
  const ownLines = useMemo(() => own ?? new Map((sheet?.own?.lines ?? []).map((l) => [keyOf(l.kind, l.variantId ?? null), { mode: l.mode, amount: String(l.amount ?? "") }])), [own, sheet]);
  const assumed = assume ?? Object.fromEntries(ASSUMPTIONS.map((a) => [a.key, sheet?.own?.[a.key] == null ? "" : String(sheet.own[a.key])]));
  const save = useMutation({
    mutationFn: () => api.saveCostProfile("PRODUCT", productId, {
      insideDhakaPct: numOrNull(assumed.insideDhakaPct), codPct: numOrNull(assumed.codPct), returnRatePct: numOrNull(assumed.returnRatePct), targetMarginPct: numOrNull(assumed.targetMarginPct),
      lines: [...ownLines].filter(([, o]) => o.mode !== "AUTO").map(([k, o]) => { const [kind, v] = k.split(":"); return { kind: kind as CostLineKind, variantId: v || null, mode: o.mode, amount: Number(o.amount) }; }),
    }),
    onSuccess: () => { toast.success("Cost sheet saved"); setOwn(null); setAssume(null); void qc.invalidateQueries({ queryKey: api.costSheetKeys.all }); },
    onError: (e) => toast.error(getErrorMessage(e, "The cost sheet couldn't be saved")),
  });

  if (!can("costing.view")) return <p className="text-sm text-fg-muted">Costs are visible to people with costing access.</p>;
  if (q.isLoading) return <Skeleton className="h-72 w-full" />;
  if (q.isError || !sheet || !size) return <Alert variant="danger" title="Cost & profit couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => q.refetch()}>Retry</Button>}>{getErrorMessage(q.error, "")}</Alert>;

  const canEdit = can("costing.adjust");
  const editKey = (kind: CostLineKind) => keyOf(kind, scope === "size" ? size.variantId : null);
  // what this size costs with the edits not yet saved: its own line, the product-wide one, else what the server worked out
  const preview = size.lines.map((l) => {
    const o = ownLines.get(keyOf(l.kind, size.variantId)) ?? ownLines.get(keyOf(l.kind, null));
    if (o && o.mode !== "AUTO") {
      const n = Number(o.amount);
      if (!(n >= 0) || o.amount.trim() === "") return { ...l, fixed: null, percent: 0, pending: true };
      return o.mode === "FIXED" ? { ...l, fixed: n, percent: 0, pending: false } : { ...l, fixed: 0, percent: n, pending: false };
    }
    // set here before, cleared now: the inherited / worked-out figure shows once saved
    const cleared = (l.from === "PRODUCT" || l.from === "VARIANT") && !o;
    return { ...l, fixed: cleared ? null : l.fixed, percent: cleared ? 0 : l.percent, pending: cleared };
  });
  const price = tryPrice.trim() && Number(tryPrice) > 0 ? Number(tryPrice) : size.price;
  const target = numOrNull(assumed.targetMarginPct) ?? sheet.assumptions.targetMarginPct.value;
  const e = economics(preview, price, target);
  const dirty = own !== null || assume !== null;
  const invalid = [...ownLines.values()].some((o) => o.mode !== "AUTO" && !(Number(o.amount) >= 0 && o.amount.trim() !== "" && (o.mode !== "PERCENT_OF_PRICE" || Number(o.amount) <= 100)))
    || ASSUMPTIONS.some((a) => assumed[a.key]!.trim() !== "" && !(Number(assumed[a.key]) >= 0 && Number(assumed[a.key]) <= (a.key === "targetMarginPct" ? 95 : 100)));
  const setLine = (kind: CostLineKind, patch: Partial<Own>) => {
    const next = new Map(ownLines);
    const k = editKey(kind);
    const cur = next.get(k) ?? { mode: "AUTO" as CostLineMode, amount: "" };
    const upd = { ...cur, ...patch };
    if (upd.mode === "AUTO") next.delete(k);
    else next.set(k, upd);
    setOwn(next);
  };

  return (
    <div className="space-y-4" data-testid="cost-sheet">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {sheet.sizes.length > 1 ? (
          <SegmentedControl aria-label="Size" value={size.variantId} onChange={(v) => setSizeId(v)} options={sheet.sizes.map((s) => ({ value: s.variantId, label: s.label }))} />
        ) : <span className="text-sm text-fg-muted">{size.label}</span>}
        {canEdit && sheet.sizes.length > 1 && (
          <SegmentedControl aria-label="Changes apply to" value={scope} onChange={setScope} options={[{ value: "all", label: "Edit all sizes" }, { value: "size", label: `Edit ${size.label} only` }]} />
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="overflow-hidden rounded-2xl border border-line-subtle">
          <ul>
            {preview.map((l) => {
              const o = ownLines.get(editKey(l.kind));
              return (
                <li key={l.kind} className="grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-x-3 gap-y-2 border-b border-line-subtle px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto_6rem]" data-testid={`cost-line-${l.kind}`}>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2 text-[15px] font-medium text-fg">
                      {l.label}
                      <Badge variant={l.from === "AUTO" ? (l.fixed === null ? "warning" : "success") : l.from === "VARIANT" || l.from === "PRODUCT" ? "info" : "neutral"}>{l.fixed === null && !l.pending ? "Unknown" : api.LEVEL_LABEL[o && o.mode !== "AUTO" ? (scope === "size" ? "VARIANT" : "PRODUCT") : l.from]}{l.estimate ? " · estimate" : ""}</Badge>
                    </span>
                    <span className="block text-xs text-fg-muted">{o && o.mode !== "AUTO" ? (o.mode === "FIXED" ? "Set by you" : "A share of the price") : l.pending ? "Saves to show the worked-out figure" : l.how}</span>
                  </span>
                  {canEdit && (
                    <span className="col-span-2 row-start-2 flex items-center gap-2 sm:col-span-1 sm:col-start-2 sm:row-start-1">
                      <Select aria-label={`${l.label}: how`} value={o?.mode ?? "AUTO"} onChange={(ev) => setLine(l.kind, { mode: ev.target.value as CostLineMode })} className="w-auto">
                        <option value="AUTO">{l.from === "CATEGORY" || l.from === "BUSINESS" ? "Inherit" : "Auto"}</option>
                        <option value="FIXED">{storeCurrencySymbol()} per sale</option>
                        <option value="PERCENT_OF_PRICE">% of price</option>
                      </Select>
                      {o && o.mode !== "AUTO" && <Input aria-label={`${l.label}: amount`} inputMode="decimal" className="w-24 tabular-nums" value={o.amount} onChange={(ev) => setLine(l.kind, { amount: ev.target.value })} />}
                    </span>
                  )}
                  <span className={cn("col-start-2 row-start-1 text-right text-[15px] font-semibold tabular-nums sm:col-start-3", l.fixed === null ? "text-warning-700" : "text-fg")}>{l.fixed === null ? "—" : formatPrice(l.fixed + (l.percent / 100) * price)}</span>
                </li>
              );
            })}
          </ul>
          <div className="flex items-center justify-between border-t border-line bg-surface-muted px-4 py-3">
            <span className="text-[15px] font-semibold text-fg">Cost per sale</span>
            <span className="text-[17px] font-bold tabular-nums text-fg">{formatPrice(e.total)}{!e.complete && " +"}</span>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-3 rounded-2xl border border-line-subtle p-4">
            <div>
              <p className="text-sm text-fg-muted">Profit per sale</p>
              <p className={cn("text-3xl font-bold tabular-nums tracking-tight", e.profit < 0 ? "text-danger-700" : "text-success-700")} data-testid="cost-profit">{formatPrice(e.profit)}</p>
              <p className="text-sm text-fg-muted">{e.margin === null ? "—" : `${e.margin.toFixed(1)}% of ${formatPrice(price)}`} · {e.margin !== null && e.margin >= target ? `above your ${target}% target` : `below your ${target}% target`}</p>
            </div>
            {!e.complete && <Alert variant="warning">Some costs are unknown, so profit is shown before them.</Alert>}
            <Field htmlFor="cost-try-price" label="Try a price" hint={`Now ${formatPrice(size.price)}`}>
              <Input id="cost-try-price" inputMode="decimal" className="tabular-nums" value={tryPrice} placeholder={String(size.price)} onChange={(ev) => setTryPrice(ev.target.value)} data-testid="cost-try-price" />
            </Field>
            <p className="text-sm text-fg-muted">Ads can take up to <span className="font-medium tabular-nums text-fg">{formatPrice(e.breakEvenAds)}</span> per sale before it loses money.</p>
            <p className="text-sm text-fg-muted">For {target}% profit: <span className="font-medium tabular-nums text-fg" data-testid="cost-suggested">{e.suggested === null ? "set the unknown costs first" : formatPrice(e.suggested)}</span></p>
          </div>

          <div className="space-y-3 rounded-2xl border border-line-subtle p-4">
            <p className="text-[15px] font-semibold text-fg">Assumptions</p>
            {ASSUMPTIONS.map((a) => {
              const inherited = sheet.assumptions[a.key];
              return (
                <div key={a.key} className="flex items-center justify-between gap-3">
                  <label htmlFor={`assume-${a.key}`} className="text-sm text-fg">{a.label}</label>
                  <span className="flex items-center gap-1.5">
                    <Input id={`assume-${a.key}`} inputMode="decimal" disabled={!canEdit} className="w-20 text-right tabular-nums" value={assumed[a.key]} placeholder={String(inherited.value)} onChange={(ev) => setAssume({ ...assumed, [a.key]: ev.target.value })} />
                    <span className="text-sm text-fg-muted">%</span>
                  </span>
                </div>
              );
            })}
            <p className="text-xs text-fg-muted">Blank follows {sheet.categoryName ? `the ${sheet.categoryName} category or ` : ""}the shop{sheet.returnRateActual !== null ? ` (returns last 60 days: ${sheet.returnRateActual}%)` : ""}. <Link href="/admin/finance/product-costs" className="font-medium text-accent hover:underline">Shop & category defaults</Link></p>
          </div>

          {canEdit && (
            <div className="flex gap-2">
              <Button className="flex-1" loading={save.isPending} disabled={!dirty || invalid} onClick={() => save.mutate()} data-testid="cost-save">Save cost sheet</Button>
              {dirty && <Button variant="outline" onClick={() => { setOwn(null); setAssume(null); }}>Undo</Button>}
            </div>
          )}
        </div>
      </div>
      <PlannedVsActual size={size} preview={preview} price={size.price} days={sheet.actualDays} />
      <p className="text-xs text-fg-muted">A plan, not the books: the books keep what things really cost. {size.lines.some((l: CostSheetLine) => l.estimate) && "“Estimate” means a material has only its reference cost so far."}</p>
    </div>
  );
}

const numOrNull = (s: string | undefined) => (s === undefined || s.trim() === "" || !Number.isFinite(Number(s)) ? null : Number(s));

/** Planned vs actual (docs/COST_SHEET.md §5): the sheet at today's price beside what the books booked per sale of this
 * size over the last days — grouped as the books keep them (the courier's fee includes COD and return charges). */
function PlannedVsActual({ size, preview, price, days }: { size: api.ProductCostSheet["sizes"][number]; preview: Array<{ kind: CostLineKind; fixed: number | null; percent: number }>; price: number; days: number }) {
  const a = size.actual;
  const sum = (kinds: CostLineKind[]) => {
    const ls = preview.filter((l) => kinds.includes(l.kind));
    return ls.some((l) => l.fixed === null) ? null : ls.reduce((s, l) => s + (l.fixed ?? 0) + (l.percent / 100) * price, 0);
  };
  const planned = { making: sum(["MAKING"]), packing: sum(["PACKAGING"]), deliveryAndFees: sum(["COURIER", "PAYMENT_FEE", "RETURN_RESERVE"]), ads: sum(["ADS"]) };
  const allCosts = sum(["MAKING", "PACKAGING", "COURIER", "PAYMENT_FEE", "RETURN_RESERVE", "ADS", "LABOUR", "OTHER"]);
  const rows: Array<{ label: string; plan: number | null; actual: number | null; costly: boolean }> = [
    { label: "Price", plan: price, actual: a?.price ?? null, costly: false },
    { label: "Making", plan: planned.making, actual: a?.making ?? null, costly: true },
    { label: "Parcel packing", plan: planned.packing, actual: a?.packing ?? null, costly: true },
    { label: "Delivery, COD, returns & fees", plan: planned.deliveryAndFees, actual: a?.deliveryAndFees ?? null, costly: true },
    { label: "Ads", plan: planned.ads, actual: a?.ads ?? null, costly: true },
    { label: "Profit per sale", plan: allCosts === null ? null : price - allCosts, actual: a?.profit ?? null, costly: false },
  ];
  return (
    <div className="rounded-2xl border border-line-subtle" data-testid="planned-vs-actual">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pb-2 pt-4">
        <p className="text-[15px] font-semibold text-fg">Planned vs actual</p>
        <p className="text-sm text-fg-muted">{a ? `${a.units.toLocaleString("en-US")} sold in the last ${days} days` : `Nothing of ${size.label} sold and booked in the last ${days} days`}</p>
      </div>
      {a && (
        <ul>
          <li className="grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_4.5rem] sm:grid-cols-[minmax(0,1fr)_6rem_6rem_6rem] gap-2 border-t border-line-subtle px-4 py-2 text-xs text-fg-muted"><span /><span className="text-right">Plan</span><span className="text-right">Actual</span><span className="text-right">Diff.</span></li>
          {rows.map((r) => {
            const diff = r.plan !== null && r.actual !== null ? r.actual - r.plan : null;
            // a cost above plan, or a price / profit below it, is the bad direction
            const bad = diff !== null && Math.abs(diff) >= 0.5 && (r.costly ? diff > 0 : diff < 0);
            return (
              <li key={r.label} className="grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_4.5rem] sm:grid-cols-[minmax(0,1fr)_6rem_6rem_6rem] items-center gap-2 border-t border-line-subtle px-4 py-2.5 text-sm">
                <span className={cn("text-fg", r.label === "Profit per sale" && "font-semibold")}>{r.label}</span>
                <span className="text-right tabular-nums text-fg-muted">{r.plan === null ? "—" : formatPrice(r.plan)}</span>
                <span className="text-right tabular-nums text-fg">{r.actual === null ? "—" : formatPrice(r.actual)}</span>
                <span className={cn("text-right tabular-nums", bad ? "text-danger-700" : "text-fg-muted")}>{diff === null ? "" : `${diff > 0 ? "+" : diff < 0 ? "−" : ""}${formatPrice(Math.abs(diff))}`}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
