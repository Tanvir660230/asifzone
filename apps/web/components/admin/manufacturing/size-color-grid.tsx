"use client";

import { Input } from "@/components/ui/input";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import { Table, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import type { ProducibleProduct } from "@/lib/api/manufacturing";

/**
 * Planned quantities as a size × colour grid (rows = colours, columns = sizes), one cell per existing variant, with row and
 * column totals. The order total is always the sum of the cells — never typed separately.
 */
export function SizeColorGrid({ product, quantities, onChange, readOnly = false }: { product: ProducibleProduct; quantities: Record<string, number>; onChange?: (variantId: string, qty: number) => void; readOnly?: boolean }) {
  const sizes = [...new Set(product.variants.map((v) => v.size))];
  const colors = [...new Set(product.variants.map((v) => v.color))];
  const cell = (size: string, color: string) => product.variants.find((v) => v.size === size && v.color === color);
  const rowTotal = (color: string) => sizes.reduce((n, s) => n + (quantities[cell(s, color)?.id ?? ""] ?? 0), 0);
  const colTotal = (size: string) => colors.reduce((n, c) => n + (quantities[cell(size, c)?.id ?? ""] ?? 0), 0);
  const total = Object.values(quantities).reduce((n, q) => n + q, 0);
  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <HScrollShadow>
        <Table>
          <TableHead>
            <tr>
              <TableHeaderCell>Colour</TableHeaderCell>
              {sizes.map((s) => <TableHeaderCell key={s} align="right">{s}</TableHeaderCell>)}
              <TableHeaderCell align="right">Total</TableHeaderCell>
            </tr>
          </TableHead>
          <tbody>
            {colors.map((c) => (
              <TableRow key={c}>
                <TableCell className="font-medium text-ink-900">{c || "—"}</TableCell>
                {sizes.map((s) => {
                  const v = cell(s, c);
                  if (!v) return <TableCell key={s} align="right" className="text-ink-400">—</TableCell>;
                  const q = quantities[v.id] ?? 0;
                  return (
                    <TableCell key={s} align="right">
                      {readOnly ? (
                        <span className="tabular-nums">{q || "—"}</span>
                      ) : (
                        <Input aria-label={`${s} / ${c || "default"} quantity`} inputMode="numeric" className="ml-auto w-20 text-right tabular-nums" value={q ? String(q) : ""} placeholder="0" onChange={(e) => { const n = Number(e.target.value.replace(/\D/g, "")); onChange?.(v.id, Number.isSafeInteger(n) ? n : 0); }} data-testid={`qty-${v.sku}`} />
                      )}
                    </TableCell>
                  );
                })}
                <TableCell align="right" className="font-medium tabular-nums">{rowTotal(c)}</TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell className="font-medium text-ink-900">Total</TableCell>
              {sizes.map((s) => <TableCell key={s} align="right" className="font-medium tabular-nums">{colTotal(s)}</TableCell>)}
              <TableCell align="right" className="font-semibold tabular-nums" data-testid="grid-total">{total}</TableCell>
            </TableRow>
          </tbody>
        </Table>
      </HScrollShadow>
    </div>
  );
}
