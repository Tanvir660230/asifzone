"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { ErrorState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { getErrorMessage } from "@/lib/api-client";
import * as stockApi from "@/lib/api/stock";
import type { StockItem, StockTrace } from "@/lib/api/stock";
import { formatBookDate, formatDate, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { num, spacedUnit, variantWords } from "./stock-shared";

const READINESS: Record<stockApi.FillReadiness, { label: string; variant: "success" | "warning" }> = {
  READY: { label: "Filled", variant: "success" },
  PARTLY_FILLED: { label: "Partly filled", variant: "warning" },
  AWAITING_FILL: { label: "To fill", variant: "warning" },
};
const unitWord = (unit: string) => (unit === "pcs" ? "" : ` ${unit}`);

/**
 * One attar size, start to finish (inventory recovery phase 3): what is filled and what is owed, which waiting orders have
 * their bottles, the recipe and what is in stock of each material, every fill (what went in, what was wasted, what each
 * bottle cost, who filled it), the last 90 days and the valuation. Costs are averages — each material's recent purchases
 * show what that average is made of.
 */
export function TraceSheet({ item, showCost, onClose }: { item: StockItem; showCost: boolean; onClose: () => void }) {
  const q = useQuery({ queryKey: stockApi.stockKeys.trace(item.variantId), queryFn: () => stockApi.getStockTrace(item.variantId) });
  const t = q.data;
  return (
    <Modal open onClose={onClose} title={`${item.productName} ${spacedUnit(variantWords(item))}`} description="Materials, fills, orders and cost" widthClassName="max-w-2xl">
      {q.isLoading ? (
        <div className="space-y-4" aria-busy="true" aria-label="Loading">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      ) : q.isError || !t ? (
        <ErrorState title="This couldn't be loaded" description={getErrorMessage(q.error, "Check your connection and try again.")} onRetry={() => q.refetch()} variant="bordered" />
      ) : (
        <div className="space-y-6" data-testid="stock-trace">
          <Figures t={t} />
          <Recipe t={t} showCost={showCost} />
          <WaitingOrders t={t} />
          <Fills t={t} showCost={showCost} />
          <History t={t} showCost={showCost} />
        </div>
      )}
    </Modal>
  );
}

function Section({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return (
    <section className="space-y-2" data-testid={testId}>
      <h3 className="text-sm font-medium text-fg">{title}</h3>
      {children}
    </section>
  );
}

function Figures({ t }: { t: StockTrace }) {
  const cells: Array<[string, number | null, boolean?]> = [
    ["Filled on the shelf", t.onShelf],
    ["On orders", t.waiting],
    ["To fill", t.owed, t.owed > 0],
    ["Can make", t.makeable],
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="stock-trace-figures">
      {cells.map(([label, value, strong]) => (
        <div key={label} className="rounded-xl border border-line-subtle px-3 py-2.5">
          <dt className="text-xs text-fg-muted">{label}</dt>
          <dd className={cn("text-lg tabular-nums", strong ? "font-semibold text-fg" : "text-fg")}>{value === null ? "—" : num(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function Recipe({ t, showCost }: { t: StockTrace; showCost: boolean }) {
  if (t.recipeMissing || !t.recipe) {
    return (
      <Section title="Recipe" testId="stock-trace-recipe">
        <p className="text-sm text-danger-700" role="note">
          No approved recipe for this size, so it can&apos;t be filled and only filled bottles can be sold. Add the real recipe (how much oil, which bottle, box…
          per bottle) in <Link href="/admin/manufacturing/boms" className="font-medium underline underline-offset-4">Bills of materials</Link>.
        </p>
      </Section>
    );
  }
  return (
    <Section title={`Recipe (version ${t.recipe.version}) — per bottle`} testId="stock-trace-recipe">
      <ul className="divide-y divide-line-subtle rounded-xl border border-line-subtle text-sm">
        {t.recipe.lines.map((l) => {
          const last = l.recentPurchases[0];
          return (
            <li key={l.materialVariantId} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 px-3 py-2.5">
              <span className="min-w-0">
                <span className="text-fg">{l.name}</span>
                <span className="block text-xs text-fg-muted">
                  {l.materialKind === "RAW" ? "Raw material" : "Packaging"} · {num(l.perBottle)}{unitWord(l.unit)} a bottle{l.wastagePct ? ` + ${num(l.wastagePct)}% wastage` : ""}
                  {l.suppliedBy !== "BUSINESS" ? " · supplied by the producer" : ""}
                </span>
                {last && (
                  <span className="block text-xs text-fg-subtle">
                    Last bought {formatDate(last.date)}: {num(last.quantity)}{unitWord(l.unit)}{showCost && last.unitCost !== null ? ` at ${formatPrice(last.unitCost)}` : ""}
                  </span>
                )}
              </span>
              <span className="text-right tabular-nums">
                <span className="text-fg">{num(l.inStock)}<span className="text-xs text-fg-muted">{unitWord(l.unit) || " pcs"}</span></span>
                <span className="block text-xs text-fg-muted">in stock{showCost && l.avgCost !== null ? ` · avg ${formatPrice(l.avgCost)}` : ""}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function WaitingOrders({ t }: { t: StockTrace }) {
  return (
    <Section title="Waiting orders" testId="stock-trace-orders">
      {t.waitingOrders.length === 0 ? (
        <p className="text-sm text-fg-muted">No order is waiting for this size.</p>
      ) : (
        <>
          <p className="text-xs text-fg-muted">Filled bottles go to the oldest orders first.</p>
          <ul className="divide-y divide-line-subtle rounded-xl border border-line-subtle text-sm">
            {t.waitingOrders.map((o, idx) => (
              <li key={`${o.orderId}-${idx}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2.5" data-testid="stock-trace-order">
                <span className="min-w-0">
                  <Link href={`/admin/orders/${o.orderId}`} className="font-medium text-fg underline-offset-4 hover:underline">{o.orderNumber}</Link>
                  <span className="block text-xs text-fg-muted">{formatDate(o.placedAt)} · {num(o.units)} bottle{o.units === 1 ? "" : "s"}</span>
                </span>
                <Badge variant={READINESS[o.status].variant}>
                  {o.status === "PARTLY_FILLED" ? `${num(o.filled)} of ${num(o.units)} filled` : o.status === "READY" ? READINESS.READY.label : `${num(o.toFill)} to fill`}
                </Badge>
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}

function Fills({ t, showCost }: { t: StockTrace; showCost: boolean }) {
  return (
    <Section title="Fills" testId="stock-trace-fills">
      {t.fills.length === 0 ? (
        <p className="text-sm text-fg-muted">Not filled here yet. Each fill you record with Filled shows what it took and what each bottle cost.</p>
      ) : (
        <ul className="divide-y divide-line-subtle rounded-xl border border-line-subtle text-sm">
          {t.fills.map((f) => (
            <li key={f.productionOrderId} className="space-y-1 px-3 py-2.5" data-testid="stock-trace-fill">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="text-fg">
                  {num(f.bottles)} bottle{f.bottles === 1 ? "" : "s"} <span className="text-xs text-fg-muted">· {formatBookDate(f.date)}{f.by ? ` · ${f.by}` : ""} · {f.number}</span>
                </span>
                <span className="flex items-center gap-2">
                  {f.status !== "CLOSED" && <Badge variant="warning">Not finished</Badge>}
                  {showCost && f.perBottle !== null && <span className="tabular-nums text-fg">{formatPrice(f.perBottle)} a bottle</span>}
                </span>
              </div>
              <p className="text-xs text-fg-muted">
                Took {f.materials.map((m) => `${num(m.used)}${unitWord(m.unit)} ${m.name}${m.wasted ? ` (+${num(m.wasted)} wasted)` : ""}`).join(", ")}
              </p>
              {f.wasteReason && <p className="text-xs text-warning-700">Wasted: {f.wasteReason}</p>}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function History({ t, showCost }: { t: StockTrace; showCost: boolean }) {
  const h = t.last90Days;
  const rows: Array<[string, number]> = [
    ["Sold", -h.sold],
    ["Back from cancelled orders", h.cancelled],
    ["Returned", h.returned],
    ["Filled", h.filled],
    ["Count corrections", h.counted],
  ];
  return (
    <Section title="Last 90 days and cost" testId="stock-trace-history">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3">
            <dt className="text-fg-muted">{label}</dt>
            <dd className="tabular-nums text-fg">{num(value)}</dd>
          </div>
        ))}
      </dl>
      {t.valuation && (
        <p className="text-sm text-fg-muted" data-testid="stock-trace-valuation">
          {num(t.valuation.valuedQty)} valued
          {showCost && t.valuation.value !== null ? ` at ${formatPrice(t.valuation.value)}` : ""}
          {showCost && t.valuation.avgCost !== null ? ` (${formatPrice(t.valuation.avgCost)} each)` : ""}
          {t.valuation.deficitQty ? ` · ${num(t.valuation.deficitQty)} sold before filling, costed when filled` : ""}
          {t.valuation.unvaluedQty ? ` · ${num(t.valuation.unvaluedQty)} without a cost` : ""}
        </p>
      )}
      {t.unresolvedCosts.length > 0 && (
        <p className="text-sm text-warning-700" role="note">
          {t.unresolvedCosts.length} stock entr{t.unresolvedCosts.length === 1 ? "y has" : "ies have"} no cost yet.{" "}
          <Link href="/admin/finance/exceptions" className="font-medium underline underline-offset-4">Resolve on Exceptions</Link>
        </p>
      )}
    </Section>
  );
}
