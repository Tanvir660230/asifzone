"use client";

import { useState } from "react";
import { useFieldArray, type Control, type UseFormRegister, type UseFormWatch } from "react-hook-form";
import { ChevronDown, Sparkles, Trash2 } from "lucide-react";
import type { Attribute, AttributeValue, CreateProductInput, ProductImage } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface VariantEditorProps {
  control: Control<CreateProductInput>;
  register: UseFormRegister<CreateProductInput>;
  watch: UseFormWatch<CreateProductInput>;
  attributes: Attribute[];
  productImages: ProductImage[];
  skuPrefix?: string;
}

function slugPart(s: string) {
  return s
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function cartesianProduct(groups: AttributeValue[][]): AttributeValue[][] {
  return groups.reduce<AttributeValue[][]>(
    (acc, group) => acc.flatMap((combo) => group.map((value) => [...combo, value])),
    [[]],
  );
}

export function VariantEditor({ control, register, watch, attributes, productImages, skuPrefix = "SKU" }: VariantEditorProps) {
  const { fields, append, remove } = useFieldArray({ control, name: "variants" });
  const [selected, setSelected] = useState<Record<string, Set<string>>>({});
  // Attributes load asynchronously (separate query), so this can't be a one-shot useState initializer —
  // it needs to open as soon as attributes actually arrive, not just at first mount.
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [autoOpened, setAutoOpened] = useState(false);
  if (!autoOpened && attributes.length > 0 && fields.length <= 1) {
    setAutoOpened(true);
    setGeneratorOpen(true);
  }

  function toggleValue(attributeId: string, valueId: string) {
    setSelected((prev) => {
      const next = { ...prev };
      const set = new Set(next[attributeId] ?? []);
      if (set.has(valueId)) set.delete(valueId);
      else set.add(valueId);
      next[attributeId] = set;
      return next;
    });
  }

  function handleGenerate() {
    const groups = attributes
      .map((attr) => ({ attr, values: attr.values.filter((v) => selected[attr.id]?.has(v.id)) }))
      .filter((g) => g.values.length > 0);
    if (groups.length === 0) return;

    const combos = cartesianProduct(groups.map((g) => g.values));

    for (const combo of combos) {
      const sizeValue = combo.find((v) => groups.find((g) => g.attr.id === v.attributeId)?.attr.name.toLowerCase() === "size");
      const colorValue = combo.find((v) => groups.find((g) => g.attr.id === v.attributeId)?.attr.name.toLowerCase() === "color");
      const suggestedSku = [slugPart(skuPrefix), ...combo.map((v) => slugPart(v.value))].filter(Boolean).join("-");

      append({
        sku: suggestedSku,
        barcode: null,
        size: sizeValue?.value ?? "",
        color: colorValue?.value ?? "",
        colorHex: colorValue?.colorHex ?? null,
        price: undefined,
        costPrice: undefined,
        stock: 0,
        weight: undefined,
        imageId: null,
        attributeValueIds: combo.map((v) => v.id),
      });
    }
  }

  return (
    <div>
      {attributes.length > 0 && (
        <div className="mb-4 rounded-lg border border-dashed border-brass-300 bg-brass-50/40 p-3">
          <button
            type="button"
            onClick={() => setGeneratorOpen((o) => !o)}
            className="flex w-full items-center justify-between text-left text-sm font-medium text-ink-900"
          >
            <span className="flex items-center gap-2">
              <Sparkles size={15} className="text-brass-500" /> Generate variants from attributes
            </span>
            <ChevronDown size={16} className={cn("transition-transform", generatorOpen && "rotate-180")} />
          </button>

          {generatorOpen && (
            <div className="mt-3 space-y-3">
              {attributes.map((attr) => (
                <div key={attr.id}>
                  <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-500">{attr.name}</p>
                  <div className="flex flex-wrap gap-2">
                    {attr.values.map((v) => {
                      const checked = selected[attr.id]?.has(v.id) ?? false;
                      return (
                        <button
                          type="button"
                          key={v.id}
                          onClick={() => toggleValue(attr.id, v.id)}
                          className={cn(
                            "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors",
                            checked
                              ? "border-ink-900 bg-ink-900 text-cream-50"
                              : "border-ink-200 bg-cream-50 text-ink-600 hover:border-ink-400",
                          )}
                        >
                          {v.colorHex && <span className="h-2.5 w-2.5 rounded-full border border-cream-50/60" style={{ backgroundColor: v.colorHex }} />}
                          {v.value}
                        </button>
                      );
                    })}
                    {attr.values.length === 0 && <span className="text-xs text-ink-400">No values yet — add some on the Attributes page.</span>}
                  </div>
                </div>
              ))}
              <Button type="button" variant="brass" size="sm" onClick={handleGenerate}>
                <Sparkles size={14} /> Generate combinations
              </Button>
              <p className="text-xs text-ink-400">
                Include "Size" and "Color" attributes so storefront filtering keeps working — other attributes (Fabric,
                Pattern…) are stored per-variant but don't affect filters yet.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="space-y-3">
        {fields.map((field, index) => {
          const attributeValueIds = watch(`variants.${index}.attributeValueIds`) ?? [];
          const chips = attributeValueIds
            .map((id) => {
              for (const attr of attributes) {
                const val = attr.values.find((v) => v.id === id);
                if (val) return `${attr.name}: ${val.value}`;
              }
              return null;
            })
            .filter(Boolean) as string[];

          return (
            <div key={field.id} className="rounded-lg border border-ink-100 bg-cream-50 p-3">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="flex flex-wrap gap-1">
                  {chips.map((chip) => (
                    <span key={chip} className="rounded-full bg-ink-100 px-2 py-0.5 text-[11px] text-ink-600">
                      {chip}
                    </span>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => remove(index)}
                  className="shrink-0 text-ink-400 hover:text-danger-600"
                  aria-label="Remove variant"
                  disabled={fields.length === 1}
                >
                  <Trash2 size={16} />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                <div>
                  <Label className="text-[11px]">SKU</Label>
                  <Input placeholder="SKU-001" {...register(`variants.${index}.sku`)} />
                </div>
                <div>
                  <Label className="text-[11px]">Barcode</Label>
                  <Input placeholder="Optional" {...register(`variants.${index}.barcode`)} />
                </div>
                <div>
                  <Label className="text-[11px]">Size</Label>
                  <Input placeholder="M / L / XL" {...register(`variants.${index}.size`)} />
                </div>
                <div>
                  <Label className="text-[11px]">Color</Label>
                  <Input placeholder="Black" {...register(`variants.${index}.color`)} />
                </div>
                <div>
                  <Label className="text-[11px]">Price override</Label>
                  <Input type="number" step="0.01" placeholder="—" {...register(`variants.${index}.price`, { valueAsNumber: true })} />
                </div>
                <div>
                  <Label className="text-[11px]">Cost price</Label>
                  <Input type="number" step="0.01" placeholder="—" {...register(`variants.${index}.costPrice`, { valueAsNumber: true })} />
                </div>
                <div>
                  <Label className="text-[11px]">Stock</Label>
                  <Input type="number" {...register(`variants.${index}.stock`, { valueAsNumber: true })} />
                </div>
                <div>
                  <Label className="text-[11px]">Weight (kg)</Label>
                  <Input type="number" step="0.01" placeholder="Optional" {...register(`variants.${index}.weight`, { valueAsNumber: true })} />
                </div>
                <div className="col-span-2">
                  <Label className="text-[11px]">Variant image</Label>
                  <Select {...register(`variants.${index}.imageId`)} disabled={productImages.length === 0}>
                    <option value="">{productImages.length === 0 ? "Upload product images first…" : "Use default product image"}</option>
                    {productImages.map((img) => (
                      <option key={img.id} value={img.id}>
                        {img.altText || img.url.split("/").pop()}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-3"
        onClick={() => append({ sku: "", size: "", color: "", stock: 0, attributeValueIds: [] })}
      >
        Add variant manually
      </Button>
    </div>
  );
}
