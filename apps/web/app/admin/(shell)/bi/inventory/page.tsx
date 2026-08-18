"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info } from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RankedBarList, type RankedBarListItem } from "@/components/admin/ranked-bar-list";
import { SlowMovingTable } from "@/components/admin/slow-moving-table";
import * as analyticsApi from "@/lib/api/admin-analytics";
import * as inventoryApi from "@/lib/api/inventory";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

type RangeOption = 7 | 30 | 90 | "all";
const RANGE_OPTIONS: RangeOption[] = [7, 30, 90, "all"];

function toBarItems<T>(rows: T[] | undefined, opts: { key: (r: T) => string; label: (r: T) => string; value: (r: T) => number; valueLabel: (r: T) => string }): RankedBarListItem[] {
  return (rows ?? []).map((r) => ({ key: opts.key(r), label: opts.label(r), value: opts.value(r), valueLabel: opts.valueLabel(r) }));
}

export default function InventoryIntelligencePage() {
  const [range, setRange] = useState<RangeOption>(30);
  const apiDays = range === "all" ? undefined : range;
  const legacyDays = range === "all" ? 365 : range;

  const { data: turnover } = useQuery({ queryKey: ["bi-inventory-turnover", apiDays], queryFn: () => analyticsApi.getInventoryTurnover(apiDays, 10) });
  const { data: lowStock } = useQuery({ queryKey: ["bi-inventory-low-stock"], queryFn: analyticsApi.getLowStock });
  const { data: slowMoving } = useQuery({ queryKey: ["bi-inventory-slow-moving", legacyDays], queryFn: () => analyticsApi.getSlowMovingProducts(legacyDays, 10) });
  const { data: deadStock } = useQuery({ queryKey: ["bi-inventory-dead-stock"], queryFn: () => analyticsApi.getDeadStock(90, 10) });
  const { data: movements } = useQuery({ queryKey: ["bi-inventory-movements", apiDays], queryFn: () => analyticsApi.getStockMovementSummary(apiDays) });
  const { data: discrepancies } = useQuery({ queryKey: ["bi-inventory-discrepancies"], queryFn: inventoryApi.getStockReconciliation });

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl tracking-tight text-ink-900 sm:text-3xl">Inventory Intelligence</h1>
          <p className="mt-1 text-sm text-ink-500">What&apos;s moving, what&apos;s stuck, what&apos;s low, and where the ledger drifts from reality.</p>
        </div>
        <div className="inline-flex shrink-0 items-center gap-0.5 self-start rounded-full border border-ink-100 bg-ink-50/60 p-1">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt}
              onClick={() => setRange(opt)}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-200 ease-smooth",
                range === opt ? "bg-ink-900 text-cream-50 shadow-sm" : "text-ink-500 hover:text-ink-900",
              )}
            >
              {opt === "all" ? "All" : `${opt}D`}
            </button>
          ))}
        </div>
      </div>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Inventory turnover</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBarList
              items={toBarItems(turnover?.products, { key: (p) => p.id, label: (p) => p.name, value: (p) => p.turnoverRatio, valueLabel: (p) => `${p.turnoverRatio.toFixed(2)}x` })}
              emptyLabel="No turnover data yet."
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Low stock ({lowStock?.variants.length ?? "—"})</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {!lowStock || lowStock.variants.length === 0 ? (
              <p className="py-8 text-center text-sm text-ink-400">Nothing low on stock right now.</p>
            ) : (
              <table className="w-full min-w-[320px] text-sm">
                <thead>
                  <tr className="border-b border-ink-100 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                    <th className="pb-2 pr-4">Product</th>
                    <th className="pb-2 pr-4">Size / Color</th>
                    <th className="pb-2">Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {lowStock.variants.slice(0, 10).map((v) => (
                    <tr key={v.id} className="border-b border-ink-50 last:border-0">
                      <td className="py-2 pr-4">
                        <Link href={`/admin/products/${v.product.id}/edit`} className="text-ink-800 hover:text-brass-600">
                          {v.product.name}
                        </Link>
                      </td>
                      <td className="py-2 pr-4 text-ink-600">
                        {v.size} / {v.color}
                      </td>
                      <td className={cn("py-2 font-medium", v.stock === 0 ? "text-danger-600" : "text-warning-600")}>{v.stock}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{`Slow moving (${range === "all" ? "365d" : `${range}D`})`}</CardTitle>
          </CardHeader>
          <CardContent>{slowMoving && <SlowMovingTable products={slowMoving.products} />}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Dead stock (zero sales, 90d)</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {!deadStock || deadStock.variants.length === 0 ? (
              <p className="py-8 text-center text-sm text-ink-400">No dead stock — everything sold at least once in the last 90 days.</p>
            ) : (
              <table className="w-full min-w-[380px] text-sm">
                <thead>
                  <tr className="border-b border-ink-100 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                    <th className="pb-2 pr-4">Product</th>
                    <th className="pb-2 pr-4">SKU</th>
                    <th className="pb-2 pr-4">Stock</th>
                    <th className="pb-2">Tied-up value</th>
                  </tr>
                </thead>
                <tbody>
                  {deadStock.variants.map((v) => (
                    <tr key={v.variantId} className="border-b border-ink-50 last:border-0">
                      <td className="py-2 pr-4">
                        <Link href={`/admin/products/${v.productId}/edit`} className="text-ink-800 hover:text-brass-600">
                          {v.name}
                        </Link>
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs text-ink-500">{v.sku}</td>
                      <td className="py-2 pr-4 text-ink-600">{v.stock}</td>
                      <td className="py-2 text-ink-800">{formatPrice(v.tiedUpValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Stock movement by reason</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBarList
              items={toBarItems(movements?.reasons, { key: (r) => r.reason, label: (r) => r.reason, value: (r) => r.units, valueLabel: (r) => `${r.units} units · ${r.movements} moves` })}
              emptyLabel="No stock movements recorded yet for this range."
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Ledger vs. actual (discrepancies)</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {!discrepancies || discrepancies.discrepancies.length === 0 ? (
              <p className="py-8 text-center text-sm text-ink-400">No discrepancies — the stock ledger matches actual stock everywhere.</p>
            ) : (
              <table className="w-full min-w-[380px] text-sm">
                <thead>
                  <tr className="border-b border-ink-100 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                    <th className="pb-2 pr-4">SKU</th>
                    <th className="pb-2 pr-4">Product</th>
                    <th className="pb-2 pr-4">Current stock</th>
                    <th className="pb-2">Ledger sum</th>
                  </tr>
                </thead>
                <tbody>
                  {discrepancies.discrepancies.map((d) => (
                    <tr key={d.variantId} className="border-b border-ink-50 last:border-0">
                      <td className="py-2 pr-4 font-mono text-xs text-ink-500">{d.sku}</td>
                      <td className="py-2 pr-4 text-ink-800">{d.productName}</td>
                      <td className="py-2 pr-4 text-ink-600">{d.currentStock}</td>
                      <td className="py-2 font-medium text-warning-600">{d.ledgerSum}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </section>

      <Card className="flex items-start gap-3 border-info-100 bg-info-50/60 p-4">
        <Info size={18} className="mt-0.5 shrink-0 text-info-600" />
        <p className="text-sm text-info-700">
          Reorder points and supplier tracking aren&apos;t shown — there&apos;s no supplier model and no per-variant reorder threshold in
          the schema today (only a per-product low-stock threshold, already used for the Low Stock list above).
        </p>
      </Card>
    </div>
  );
}
