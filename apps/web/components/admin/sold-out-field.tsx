"use client";

import { useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { NO_SIZE_VALUE, type CreateProductInput } from "@clothing-brand/shared";
import { Checkbox } from "@/components/ui/checkbox";
import { SegmentedControl } from "@/components/ui/tabs";

type Mode = "selling" | "all" | "some";

/** "6ml" / "Black" / "6ml · Black" — only the options that differ between the variants — else the SKU, else its position. */
function variantName(v: { size?: string; color?: string | null; sku?: string }, index: number, differs: { size: boolean; color: boolean }) {
  const parts = [differs.size && v.size && v.size !== NO_SIZE_VALUE ? v.size : null, differs.color ? v.color || null : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : v.sku || `Variant ${index + 1}`;
}

/** "Show as sold out" — take the whole product, or only some variants (the 6ml while the 12ml sells), off sale while
 * the stock stays as it is. Shoppers see it sold out and checkout refuses it; turning it back on sells the same stock. */
export function SoldOutField({ form }: { form: UseFormReturn<CreateProductInput> }) {
  const productMarked = form.watch("markedSoldOut") === true;
  const variants = form.watch("variants") ?? [];
  const trackInventory = form.watch("trackInventory") !== false;
  const [mode, setMode] = useState<Mode>(() => (productMarked ? "all" : variants.some((v) => v.markedSoldOut) ? "some" : "selling"));
  const showSome = variants.length > 1 || mode === "some";
  const differs = { size: new Set(variants.map((v) => v.size)).size > 1, color: new Set(variants.map((v) => v.color)).size > 1 };

  function apply(next: Mode) {
    const opts = { shouldDirty: true } as const;
    // "Whole product" lives on the product; "Only some" on the variants — the other one is cleared so the two never mix.
    form.setValue("markedSoldOut", next === "all", opts);
    variants.forEach((v, i) => {
      if (next !== "some" && v.markedSoldOut) form.setValue(`variants.${i}.markedSoldOut`, false, opts);
    });
    setMode(next);
  }

  const options = [
    { value: "selling" as const, label: "On sale", testId: "sold-out-selling" },
    { value: "all" as const, label: variants.length > 1 ? "Whole product sold out" : "Sold out", testId: "sold-out-all" },
    ...(showSome ? [{ value: "some" as const, label: "Only some", testId: "sold-out-some" }] : []),
  ];

  return (
    <div className="space-y-3">
      <SegmentedControl aria-label="Show as sold out" size="md" value={mode} onChange={apply} options={options} />

      {mode === "some" && (
        <fieldset className="space-y-2 rounded-xl border border-line-subtle p-3" data-testid="sold-out-variants">
          <legend className="px-1 text-xs text-fg-muted">Tick the variants to show as sold out</legend>
          {variants.map((v, i) => (
            <label key={v.id ?? i} className="flex min-h-9 items-center gap-2.5 text-sm text-ink-700">
              <Checkbox checked={v.markedSoldOut === true} onChange={(e) => form.setValue(`variants.${i}.markedSoldOut`, e.target.checked, { shouldDirty: true })} />
              <span className="flex-1">{variantName(v, i, differs)}</span>
              {trackInventory && <span className="text-xs tabular-nums text-fg-muted">{v.stock ?? 0} in stock</span>}
            </label>
          ))}
        </fieldset>
      )}

      <p className="text-xs text-fg-muted">
        Customers see it as sold out and can&rsquo;t order it, even with stock left. The stock count doesn&rsquo;t change — switch back to
        &ldquo;On sale&rdquo; and the same stock sells again. Customers who asked to be told when it&rsquo;s back are emailed then.
      </p>
    </div>
  );
}
