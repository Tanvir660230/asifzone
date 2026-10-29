"use client";

import { useRef, useState } from "react";
import { Rows3 } from "lucide-react";
import type { ListDensity } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover } from "@/components/ui/popover";
import { SegmentedControl } from "@/components/ui/tabs";
import { ORDER_OPTIONAL_COLUMNS, type OrdersListState } from "./use-orders-list-state";

const DENSITY_OPTIONS: { value: ListDensity; label: string }[] = [
  { value: "compact", label: "Compact" },
  { value: "standard", label: "Standard" },
  { value: "comfortable", label: "Comfortable" },
];

/** How the Orders list is ordered (URL), and the table's row height and optional columns (plan M10, remembered per admin
 * on the server). Row height and columns apply to the table, which appears from xl up. */
export function OrdersDisplayMenu({ state }: { state: OrdersListState }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button ref={ref} variant="outline" size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="dialog" data-testid="orders-display">
        <Rows3 size={14} /> Display
      </Button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} align="end" aria-label="Table display" className="w-80 p-4">
        <p className="mb-2 text-xs font-medium text-fg-muted" aria-hidden="true">
          Order by
        </p>
        <SegmentedControl
          aria-label="Order by"
          value={state.orderBy}
          onChange={(v) => v !== "column" && state.setOrderBy(v)}
          options={[
            { value: "activity" as const, label: "Latest activity" },
            { value: "placed" as const, label: "Date placed" },
          ]}
        />
        <p className="mt-1.5 text-xs text-fg-subtle">Latest activity brings an order back to the top when it is confirmed, booked or shipped.</p>
        <p className="mb-2 mt-4 border-t border-line-subtle pt-3 text-xs font-medium text-fg-muted" aria-hidden="true">
          Row height
        </p>
        <SegmentedControl aria-label="Row height" value={state.density} onChange={state.setDensity} options={DENSITY_OPTIONS} />
        <fieldset className="mt-4 border-t border-line-subtle pt-3">
          <legend className="mb-1 text-xs font-medium text-fg-muted">Columns</legend>
          {ORDER_OPTIONAL_COLUMNS.map((c) => (
            <label key={c.id} className="flex min-h-[36px] cursor-pointer items-center gap-2.5 text-sm text-fg">
              <Checkbox checked={!state.hiddenColumns.has(c.id)} onChange={() => state.toggleColumn(c.id)} />
              {c.label}
            </label>
          ))}
          <p className="mt-1 text-xs text-fg-subtle">Order, customer and status always show.</p>
        </fieldset>
      </Popover>
    </>
  );
}
