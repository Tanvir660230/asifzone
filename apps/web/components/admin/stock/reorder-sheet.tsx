"use client";

import { useMemo, useState } from "react";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/toast";
import type { StockToday } from "@/lib/api/stock-smart";
import { formatBookDate, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BoughtStart } from "./bought-sheet";
import { num, spacedUnit } from "./stock-shared";

type Item = NonNullable<StockToday["reorder"]>["items"][number];
interface Row extends Item { on: boolean; qty: string }

const unitWord = (u: string) => (u === "pcs" ? "pcs" : spacedUnit(u));

/**
 * Reorder (docs/STOCK_HUB.md §7): what runs out before new stock could arrive, grouped by who it is usually bought from,
 * each at the amount that covers the item's days of stock. Copy a supplier's list to send it; when the goods come,
 * "Record purchase" opens Received goods with those lines filled in and the price paid last time beside each.
 */
export function ReorderSheet({ reorder, today, onRecord, onClose }: { reorder: NonNullable<StockToday["reorder"]>; today: string; onRecord: (start: BoughtStart) => void; onClose: () => void }) {
  const [rows, setRows] = useState<Row[]>(() => reorder.items.map((i) => ({ ...i, on: true, qty: String(i.suggested) })));
  const groups = useMemo(() => {
    const m = new Map<string, { id: string | null; name: string; rows: Row[] }>();
    for (const r of rows) {
      const key = r.supplier?.id ?? "none";
      const g = m.get(key) ?? { id: r.supplier?.id ?? null, name: r.supplier?.name || "No usual supplier yet", rows: [] };
      g.rows.push(r);
      m.set(key, g);
    }
    return [...m.values()].sort((a, b) => (a.id === null ? 1 : b.id === null ? -1 : a.name.localeCompare(b.name)));
  }, [rows]);
  const set = (variantId: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.variantId === variantId ? { ...r, ...patch } : r)));
  const qtyOf = (r: Row) => (/^\d+$/.test(r.qty) ? Number(r.qty) : 0);
  const chosen = (g: { rows: Row[] }) => g.rows.filter((r) => r.on && qtyOf(r) > 0);

  async function copy(g: { name: string; rows: Row[] }) {
    const text = chosen(g).map((r) => `${r.name} — ${num(qtyOf(r))} ${unitWord(r.unit)}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success("List copied");
    } catch {
      toast.error("Couldn't copy — select the list and copy it instead");
    }
  }

  return (
    <Modal open onClose={onClose} title="Reorder" description="Amounts cover each item's days of stock, from how fast it went in the last 30 days." widthClassName="max-w-xl">
      <div className="space-y-6" data-testid="reorder-sheet">
        {groups.map((g) => (
          <section key={g.id ?? "none"} aria-label={g.name} className="space-y-2" data-testid="reorder-group">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-fg">{g.name}</h3>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => copy(g)} disabled={!chosen(g).length}><Copy className="h-4 w-4" aria-hidden="true" /> Copy list</Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!chosen(g).length}
                  onClick={() => onRecord({ supplierName: g.id ? g.name : null, lines: chosen(g).map((r) => ({ variantId: r.variantId, qty: qtyOf(r), lastUnitCost: r.lastUnitCost })) })}
                  data-testid="reorder-record"
                >
                  Record purchase
                </Button>
              </div>
            </div>
            <ul className="divide-y divide-line-subtle rounded-xl border border-line-subtle">
              {g.rows.map((r) => (
                <li key={r.variantId} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5" data-testid="reorder-row">
                  <Checkbox checked={r.on} onChange={(e) => set(r.variantId, { on: e.target.checked })} aria-label={`Include ${r.name}`} />
                  <label htmlFor={`reorder-${r.variantId}`} className={cn("min-w-0 text-sm", r.on ? "text-fg" : "text-fg-subtle")}>
                    <span className="block truncate">{r.name}</span>
                    <span className="block text-xs text-fg-muted">
                      {r.status === "OUT" || r.daysLeft === 0 ? "Out now" : r.daysLeft === null ? "Running low" : `${num(r.daysLeft)} days left`}
                      {" · "}{r.orderBy <= today ? "order today" : `order by ${formatBookDate(r.orderBy)}`}
                      {r.lastUnitCost !== null && <> · last {formatPrice(r.lastUnitCost)}</>}
                    </span>
                  </label>
                  <span className="flex items-center gap-1.5">
                    <Input id={`reorder-${r.variantId}`} inputMode="numeric" className="w-20 text-right tabular-nums" value={r.qty} onChange={(e) => set(r.variantId, { qty: e.target.value.replace(/\D/g, "") })} disabled={!r.on} data-testid="reorder-qty" />
                    <span className="w-8 text-xs text-fg-muted">{unitWord(r.unit)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <p className="text-xs text-fg-muted">Set an item&apos;s usual supplier, days to arrive and days of stock in its row under All stock.</p>
      </div>
    </Modal>
  );
}
