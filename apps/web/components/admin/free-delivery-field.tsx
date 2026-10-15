"use client";

import { useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { NO_SIZE_VALUE, variantShipsFree, type CreateProductInput } from "@clothing-brand/shared";
import { Checkbox } from "@/components/ui/checkbox";
import { SegmentedControl } from "@/components/ui/tabs";

type Mode = "none" | "all" | "some";

/** "6ml · Black" — only the options that differ between the variants ("6ml" when all are black), falling back to the SKU,
 * then to its position. */
function variantName(v: { size?: string; color?: string | null; sku?: string }, index: number, differs: { size: boolean; color: boolean }) {
  const parts = [differs.size && v.size && v.size !== NO_SIZE_VALUE ? v.size : null, differs.color ? v.color || null : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : v.sku || `Variant ${index + 1}`;
}

/** Free delivery for the whole product, or only for some of its variants (the 12ml ships free, the 6ml doesn't).
 * "All" and "None" live on the product (variants follow it); "Only some" sets each variant's own override. */
export function FreeDeliveryField({ form }: { form: UseFormReturn<CreateProductInput> }) {
  const productFree = form.watch("freeDelivery") === true;
  const variants = form.watch("variants") ?? [];
  const [mode, setMode] = useState<Mode>(() =>
    variants.some((v) => v.freeDelivery != null) ? "some" : productFree ? "all" : "none",
  );
  const showSome = variants.length > 1 || mode === "some";
  const differs = { size: new Set(variants.map((v) => v.size)).size > 1, color: new Set(variants.map((v) => v.color)).size > 1 };

  function apply(next: Mode) {
    const opts = { shouldDirty: true } as const;
    variants.forEach((v, i) => {
      // "Only some" starts from what each variant does today; the other modes hand every variant back to the product.
      const value = next === "some" ? variantShipsFree(productFree, v.freeDelivery) : null;
      form.setValue(`variants.${i}.freeDelivery`, value, opts);
    });
    form.setValue("freeDelivery", next === "all", opts);
    setMode(next);
  }

  const options = [
    { value: "none" as const, label: "No", testId: "free-delivery-none" },
    { value: "all" as const, label: variants.length > 1 ? "All variants" : "Yes", testId: "free-delivery-all" },
    ...(showSome ? [{ value: "some" as const, label: "Only some", testId: "free-delivery-some" }] : []),
  ];

  return (
    <div className="space-y-3">
      <SegmentedControl aria-label="Free delivery" size="md" value={mode} onChange={apply} options={options} />

      {mode === "some" && (
        <fieldset className="space-y-2 rounded-xl border border-line-subtle p-3" data-testid="free-delivery-variants">
          <legend className="px-1 text-xs text-fg-muted">Tick the variants that ship free</legend>
          {variants.map((v, i) => (
            <label key={v.id ?? i} className="flex min-h-9 items-center gap-2.5 text-sm text-ink-700">
              <Checkbox
                checked={variantShipsFree(productFree, v.freeDelivery)}
                onChange={(e) => form.setValue(`variants.${i}.freeDelivery`, e.target.checked, { shouldDirty: true })}
              />
              {variantName(v, i, differs)}
            </label>
          ))}
        </fieldset>
      )}

      <p className="text-xs text-fg-muted">
        Delivery is free when every item in the cart has free delivery. If the cart also has other items, the normal delivery fee applies.
        Orders already placed keep the delivery fee they were charged.
      </p>
    </div>
  );
}
