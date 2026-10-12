"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SearchInput } from "@/components/ui/search-input";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import { Table, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import type { OpeningInventoryItem, ValuationStatus } from "@/lib/api/finance";
import { formatPrice } from "@/lib/format";

const PAGE = 25;
const STATUS_LABEL: Record<ValuationStatus, string> = { KNOWN: "Known (from a bill)", ESTIMATED: "Estimate", MISSING: "No cost yet" };

/** The value an item adds to the opening stock: nothing without a cost, else the given value or quantity × unit cost. */
export function itemValue(i: OpeningInventoryItem): number {
  if (i.valuationStatus === "MISSING") return 0;
  if (i.unitCost != null) return Math.round(i.unitCost * i.quantity * 100) / 100;
  return i.valuationAmount ?? 0;
}

/**
 * The opening stock count, one row per SKU: quantity, unit cost and how sure the cost is. Typing a cost on an item with
 * none makes it an estimate; choosing "No cost yet" clears the cost — a cost is never invented. Edits stay local until
 * the page saves the whole count.
 */
export function OpeningStockEditor({ items, onChange, readOnly }: { items: OpeningInventoryItem[]; onChange: (items: OpeningInventoryItem[]) => void; readOnly?: boolean }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? items.filter((i) => i.sku.toLowerCase().includes(q) || i.name.toLowerCase().includes(q)) : items;
  }, [items, search]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const shown = filtered.slice(page * PAGE, page * PAGE + PAGE);

  function update(sku: string, patch: Partial<OpeningInventoryItem>) {
    onChange(items.map((i) => (i.sku === sku ? { ...i, ...patch } : i)));
  }
  function setCost(item: OpeningInventoryItem, raw: string) {
    const v = raw.trim() === "" ? null : Number(raw);
    if (v !== null && (!Number.isFinite(v) || v < 0)) return;
    if (v === null) return update(item.sku, { unitCost: null, valuationAmount: null, valuationStatus: "MISSING", valuationMethod: "NONE", confidence: null });
    update(item.sku, {
      unitCost: v,
      valuationAmount: null,
      valuationStatus: item.valuationStatus === "MISSING" ? "ESTIMATED" : item.valuationStatus,
      valuationMethod: item.valuationStatus === "MISSING" || item.valuationMethod === "NONE" ? "MANUAL" : item.valuationMethod,
      confidence: item.valuationStatus === "MISSING" ? "MEDIUM" : item.confidence,
      valuationSource: item.valuationStatus === "MISSING" ? "Entered by hand on the Start the books page" : item.valuationSource,
    });
  }
  function setStatus(item: OpeningInventoryItem, status: ValuationStatus) {
    if (status === "MISSING") return update(item.sku, { valuationStatus: "MISSING", unitCost: null, valuationAmount: null, valuationMethod: "NONE", confidence: null });
    update(item.sku, { valuationStatus: status, confidence: status === "KNOWN" ? "HIGH" : (item.confidence ?? "MEDIUM"), valuationMethod: item.valuationMethod === "NONE" ? "MANUAL" : item.valuationMethod });
  }

  return (
    <div className="space-y-3">
      <SearchInput wrapperClassName="max-w-sm" value={search} onChange={(v) => { setSearch(v); setPage(0); }} placeholder="Find a SKU or product…" />
      <div className="overflow-hidden rounded-lg border border-line-subtle">
        <HScrollShadow>
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Item</TableHeaderCell>
                <TableHeaderCell align="right">Quantity</TableHeaderCell>
                <TableHeaderCell align="right">Unit cost</TableHeaderCell>
                <TableHeaderCell>How sure</TableHeaderCell>
                <TableHeaderCell align="right">Value</TableHeaderCell>
              </tr>
            </TableHead>
            <tbody>
              {shown.map((i) => (
                <TableRow key={i.sku} data-testid="opening-stock-row">
                  <TableCell className="min-w-[200px]">
                    <span className="block text-sm text-fg">{i.name}</span>
                    <span className="block font-mono text-xs text-fg-subtle">{i.sku}</span>
                  </TableCell>
                  <TableCell align="right">
                    {readOnly ? (
                      <span className="tabular-nums">{i.quantity}</span>
                    ) : (
                      <Input
                        aria-label={`Quantity of ${i.sku}`}
                        inputMode="numeric"
                        className="ml-auto h-8 w-20 text-right tabular-nums"
                        value={String(i.quantity)}
                        onChange={(e) => { const q = Number(e.target.value); if (Number.isInteger(q) && q >= 0) update(i.sku, { quantity: q }); }}
                      />
                    )}
                  </TableCell>
                  <TableCell align="right">
                    {readOnly ? (
                      <span className="tabular-nums">{i.unitCost == null ? "—" : formatPrice(i.unitCost)}</span>
                    ) : (
                      <Input
                        key={`${i.sku}:${i.unitCost ?? ""}`}
                        aria-label={`Unit cost of ${i.sku}`}
                        inputMode="decimal"
                        placeholder="—"
                        className="ml-auto h-8 w-24 text-right tabular-nums"
                        defaultValue={i.unitCost == null ? "" : String(i.unitCost)}
                        onBlur={(e) => setCost(i, e.target.value)}
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    {readOnly ? (
                      STATUS_LABEL[i.valuationStatus]
                    ) : (
                      <Select aria-label={`How sure the cost of ${i.sku} is`} className="h-8 min-w-[150px] text-sm" value={i.valuationStatus} onChange={(e) => setStatus(i, e.target.value as ValuationStatus)}>
                        {(Object.keys(STATUS_LABEL) as ValuationStatus[]).map((s) => (
                          <option key={s} value={s} disabled={s !== "MISSING" && i.unitCost == null && i.valuationAmount == null}>{STATUS_LABEL[s]}</option>
                        ))}
                      </Select>
                    )}
                  </TableCell>
                  <TableCell align="right" className="whitespace-nowrap tabular-nums">{i.valuationStatus === "MISSING" ? <span className="text-fg-subtle">not valued</span> : formatPrice(itemValue(i))}</TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        </HScrollShadow>
        {shown.length === 0 && <p className="p-6 text-center text-sm text-fg-muted">{items.length === 0 ? "No stock counted yet." : "No item matches that search."}</p>}
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-between gap-3 text-sm text-fg-muted">
          <span>{filtered.length} items · page {page + 1} of {pages}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <Button size="sm" variant="outline" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
