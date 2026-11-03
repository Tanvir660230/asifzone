"use client";

import type { ProductVariant } from "@clothing-brand/shared";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { cn, isPaleColor } from "@/lib/utils";

interface Props {
  variants: ProductVariant[];
  /** Chosen variant ids; empty = every active variant (and any added to the product later). */
  value: string[];
  onChange: (ids: string[]) => void;
  defaultColor?: string;
  defaultSize?: string;
  onDefaults: (d: { defaultColor?: string; defaultSize?: string }) => void;
}

/**
 * Which of the product's variants this page sells, by colour: tick a colour for all its sizes, or tap single sizes. Stock
 * is shown so a sold-out choice is visible — the page still reads live stock, nothing here reserves or copies any.
 */
export function VariantChooser({ variants, value, onChange, defaultColor, defaultSize, onDefaults }: Props) {
  const active = variants.filter((v) => v.isActive !== false);
  const all = value.length === 0;
  const chosen = new Set(all ? active.map((v) => v.id) : value);
  const colors = [...new Set(active.map((v) => v.color))];
  const offered = active.filter((v) => chosen.has(v.id));

  // Back to "all" when everything is ticked, so variants added to the product later appear on the page too.
  const set = (ids: Set<string>) => {
    const list = active.filter((v) => ids.has(v.id)).map((v) => v.id);
    onChange(list.length === active.length ? [] : list);
    const left = active.filter((v) => ids.has(v.id));
    onDefaults({
      defaultColor: defaultColor && left.some((v) => v.color === defaultColor) ? defaultColor : undefined,
      defaultSize: defaultSize && left.some((v) => v.size === defaultSize) ? defaultSize : undefined,
    });
  };
  const toggle = (ids: string[], on: boolean) => {
    const next = new Set(chosen);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    if (next.size > 0) set(next);
  };

  if (!active.length) return <p className="text-sm text-fg-muted">This product has no active variants.</p>;

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-line-subtle rounded-xl border border-line bg-surface">
        {colors.map((color) => {
          const ofColor = active.filter((v) => v.color === color);
          const on = ofColor.filter((v) => chosen.has(v.id));
          const hex = ofColor[0]?.colorHex;
          const stock = ofColor.reduce((n, v) => n + Math.max(0, v.stock), 0);
          return (
            <li key={color || "none"} className="px-3.5 py-3">
              <div className="flex items-center gap-3">
                <Checkbox
                  id={`lp-color-${color}`}
                  checked={on.length === ofColor.length}
                  ref={(el) => {
                    if (el) el.indeterminate = on.length > 0 && on.length < ofColor.length;
                  }}
                  onChange={(e) => toggle(ofColor.map((v) => v.id), e.target.checked)}
                  aria-label={`Sell ${color || "this product"}`}
                />
                {hex && <span className={cn("h-4 w-4 shrink-0 rounded-full", isPaleColor(hex) && "ring-1 ring-line-strong")} style={{ backgroundColor: hex }} aria-hidden="true" />}
                <label htmlFor={`lp-color-${color}`} className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
                  {color || "No colour"}
                </label>
                <span className="shrink-0 text-xs tabular-nums text-fg-muted">{stock} in stock</span>
              </div>
              {ofColor.length > 1 && (
                <div className="mt-2.5 flex flex-wrap gap-1.5 pl-8">
                  {ofColor.map((v) => {
                    const sel = chosen.has(v.id);
                    return (
                      <button
                        key={v.id}
                        type="button"
                        aria-pressed={sel}
                        onClick={() => toggle([v.id], !sel)}
                        title={`${v.sku} · ${v.stock} in stock`}
                        className={cn(
                          "h-8 min-w-[2.5rem] rounded-full border px-3 text-xs font-medium tabular-nums transition-colors duration-base",
                          sel ? "border-ink-900 bg-ink-900 text-cream-50" : "border-line bg-surface text-fg-muted line-through",
                          v.stock <= 0 && sel && "border-dashed",
                        )}
                      >
                        {v.size}
                      </button>
                    );
                  })}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-fg-muted">{all ? "Selling every variant, including any added later." : `Selling ${offered.length} of ${active.length} variants.`}</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="lp-default-color" className="text-xs">
            Start on colour
          </Label>
          <Select id="lp-default-color" value={defaultColor ?? ""} onChange={(e) => onDefaults({ defaultColor: e.target.value || undefined, defaultSize })} className="h-9 text-sm">
            <option value="">Shopper chooses</option>
            {[...new Set(offered.map((v) => v.color))].filter(Boolean).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="lp-default-size" className="text-xs">
            Start on size
          </Label>
          <Select id="lp-default-size" value={defaultSize ?? ""} onChange={(e) => onDefaults({ defaultColor, defaultSize: e.target.value || undefined })} className="h-9 text-sm">
            <option value="">Shopper chooses</option>
            {[...new Set(offered.map((v) => v.size))].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>
      </div>
    </div>
  );
}
