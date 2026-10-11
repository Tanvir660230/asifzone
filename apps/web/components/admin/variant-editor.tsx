"use client";

import { useState } from "react";
import Link from "next/link";
import { Controller, useFieldArray, useFormState, type Control, type UseFormRegister, type UseFormSetValue, type UseFormWatch } from "react-hook-form";
import { DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, GripVertical, History, Plus, Sparkles, Star, Trash2, Wand2 } from "lucide-react";
import { findDuplicateSkus, type Attribute, type AttributeValue, type CreateProductInput, type ProductImage, type VariantDimension } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/icon-button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/components/ui/toast";
import * as catalogApi from "@/lib/api/catalog";
import { VariantGalleryPicker } from "./variant-gallery-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface VariantEditorProps {
  control: Control<CreateProductInput>;
  register: UseFormRegister<CreateProductInput>;
  watch: UseFormWatch<CreateProductInput>;
  setValue: UseFormSetValue<CreateProductInput>;
  attributes: Attribute[];
  productImages: ProductImage[];
  skuPrefix?: string;
  /** The selected type's variant dimensions (which of size/colour it uses, and how they are labelled). */
  variantDimensions?: VariantDimension[];
  typeName?: string;
  /** The product's type — the SKU generator numbers per type. */
  typeId?: string;
}

/** Fields the bulk bar can set on many variants at once. Prices can also be cleared (the variant then sells at the
 * product's base price); stock can't be blank. */
const BULK_FIELDS = [
  { key: "stock", label: "Stock" },
  { key: "price", label: "Price override" },
  { key: "compareAtPrice", label: "Compare-at price" },
  { key: "costPrice", label: "Cost price" },
] as const;
type BulkField = (typeof BULK_FIELDS)[number]["key"];

/** Variant count above which the editor opens with rows folded to their summaries. */
const FOLD_ABOVE = 6;

function slugPart(s: string) {
  return s
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function cartesianProduct(groups: AttributeValue[][]): AttributeValue[][] {
  return groups.reduce<AttributeValue[][]>((acc, group) => acc.flatMap((combo) => group.map((value) => [...combo, value])), [[]]);
}

/** The variant matrix: generate from option values, edit each variant (folded into a summary row once there are
 * many), bulk-set stock/prices, generate SKUs from the catalog's pattern, reorder (the first is the default) and pick
 * each variant's gallery. Used by the Product Builder for both new and existing products. */
export function VariantEditor({
  control,
  register,
  watch,
  setValue,
  attributes,
  productImages,
  skuPrefix = "SKU",
  variantDimensions = [],
  typeName = "this product type",
  typeId,
}: VariantEditorProps) {
  const { fields, append, remove, move } = useFieldArray({ control, name: "variants" });
  const [generatingSku, setGeneratingSku] = useState<number | null>(null);
  // Keyed by the field-array row id, so a selection survives drag-reordering.
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [bulkField, setBulkField] = useState<BulkField>("stock");
  const [bulkValue, setBulkValue] = useState("");
  const [generatingAll, setGeneratingAll] = useState(false);

  const liveVariants = (watch("variants") ?? []) as { sku?: string; color?: string | null; size?: string | null }[];
  // Same rule the API applies on save — shown while typing instead of as a failed save.
  const duplicateSkuRows = findDuplicateSkus(liveVariants.map((v) => v?.sku));
  const targetIndexes = selectedRows.size ? fields.map((f, i) => (selectedRows.has(f.id) ? i : -1)).filter((i) => i >= 0) : fields.map((_, i) => i);

  function toggleRow(rowId: string) {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }

  function applyBulk() {
    const raw = bulkValue.trim();
    let value: number | null;
    if (bulkField === "stock") {
      const n = Number(raw);
      if (raw === "" || !Number.isInteger(n) || n < 0) {
        toast.error("Stock must be a whole number, 0 or more");
        return;
      }
      value = n;
    } else if (raw === "") {
      value = null; // clears the override on those variants
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) {
        toast.error("Prices must be above zero (leave it empty to clear)");
        return;
      }
      value = n;
    }
    for (const i of targetIndexes) setValue(`variants.${i}.${bulkField}`, value as number, { shouldDirty: true });
    const label = BULK_FIELDS.find((f) => f.key === bulkField)!.label.toLowerCase();
    const what = value === null ? `Cleared ${label}` : `Set ${label} to ${value}`;
    toast.success(`${what} on ${targetIndexes.length} variant${targetIndexes.length === 1 ? "" : "s"}`);
  }

  /** One request at a time, each told about every SKU already in the form (including ones just generated), so the
   * server's atomic counter never hands two rows the same number. */
  async function generateMissingSkus() {
    if (!typeId) return;
    setGeneratingAll(true);
    try {
      const taken = liveVariants.map((v) => v?.sku ?? "").filter(Boolean);
      for (const [i, row] of liveVariants.entries()) {
        if (row?.sku?.trim()) continue;
        const { sku } = await catalogApi.generateSku({ typeId, color: row?.color, size: row?.size, taken });
        taken.push(sku);
        setValue(`variants.${i}.sku`, sku, { shouldDirty: true, shouldValidate: true });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't generate SKUs");
    } finally {
      setGeneratingAll(false);
    }
  }

  /** Asks the server for the next SKU from the configured pattern, telling it which SKUs this form already holds so
   * two unsaved rows can't be handed the same one. */
  async function handleGenerateSku(index: number) {
    if (!typeId) return;
    setGeneratingSku(index);
    try {
      const all = (watch("variants") ?? []) as { sku?: string; color?: string | null; size?: string | null }[];
      const row = all[index];
      const { sku } = await catalogApi.generateSku({ typeId, color: row?.color, size: row?.size, taken: all.map((v) => v.sku ?? "").filter(Boolean) });
      setValue(`variants.${index}.sku`, sku, { shouldDirty: true, shouldValidate: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't generate a SKU");
    } finally {
      setGeneratingSku(null);
    }
  }

  const [selected, setSelected] = useState<Record<string, Set<string>>>({});
  // Attributes load asynchronously, so the generator opens as soon as they arrive (not just at first mount).
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [autoOpened, setAutoOpened] = useState(false);
  if (!autoOpened && attributes.length > 0 && fields.length <= 1) {
    setAutoOpened(true);
    setGeneratorOpen(true);
  }

  // Rows start open; a large matrix (more than FOLD_ABOVE variants) starts folded to its summary rows so it stays
  // scannable. Rows added later are open (they aren't in the initial set), and a row with a validation error is always
  // open. Folded details stay mounted (just hidden), so every variant's fields stay registered with the form.
  const [folded, setFolded] = useState<Set<string>>(() => (fields.length > FOLD_ABOVE ? new Set(fields.map((f) => f.id)) : new Set()));
  const { errors: formErrors } = useFormState({ control, name: "variants" });
  const rowErrors = (formErrors.variants ?? []) as unknown as Array<Record<string, { message?: string }> | undefined>;
  function toggleFold(rowId: string) {
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = fields.findIndex((f) => f.id === active.id);
    const newIndex = fields.findIndex((f) => f.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    move(oldIndex, newIndex);
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
    const groups = attributes.map((attr) => ({ attr, values: attr.values.filter((v) => selected[attr.id]?.has(v.id)) })).filter((g) => g.values.length > 0);
    if (groups.length === 0) return;

    for (const combo of cartesianProduct(groups.map((g) => g.values))) {
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
        isActive: true,
        attributeValueIds: combo.map((v) => v.id),
      });
    }
  }

  const sizeDim = variantDimensions.find((d) => d.targetField === "size");
  const colorDim = variantDimensions.find((d) => d.targetField === "color");

  return (
    <div className="space-y-4">
      {attributes.length > 0 && (
        <div className="rounded-xl border border-line-subtle bg-surface-muted/60 p-4">
          <button
            type="button"
            onClick={() => setGeneratorOpen((o) => !o)}
            aria-expanded={generatorOpen}
            className="flex w-full items-center justify-between gap-3 text-left text-sm font-medium text-fg"
          >
            <span className="flex items-center gap-2">
              <Sparkles size={15} className="text-ink-500" aria-hidden="true" /> Generate variants from attributes
            </span>
            <ChevronDown size={16} className={cn("shrink-0 transition-transform duration-base ease-smooth", generatorOpen && "rotate-180")} aria-hidden="true" />
          </button>

          {generatorOpen && (
            <div className="mt-4 space-y-4">
              {attributes.map((attr) => (
                <fieldset key={attr.id}>
                  <legend className="mb-2 text-caption font-semibold uppercase text-fg-muted">{attr.name}</legend>
                  <div className="flex flex-wrap gap-2">
                    {attr.values.map((v) => {
                      const checked = selected[attr.id]?.has(v.id) ?? false;
                      return (
                        <button
                          type="button"
                          key={v.id}
                          onClick={() => toggleValue(attr.id, v.id)}
                          aria-pressed={checked}
                          className={cn(
                            "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors duration-fast ease-smooth",
                            checked ? "border-accent bg-accent text-accent-fg" : "border-line bg-surface text-ink-600 hover:border-line-strong hover:text-fg",
                          )}
                        >
                          {v.colorHex && <span className="h-3 w-3 rounded-full ring-1 ring-ink-900/10" style={{ backgroundColor: v.colorHex }} aria-hidden="true" />}
                          {v.value}
                        </button>
                      );
                    })}
                    {attr.values.length === 0 && <span className="text-xs text-fg-subtle">No values yet — add some under Products → Variant options.</span>}
                  </div>
                </fieldset>
              ))}
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" size="sm" onClick={handleGenerate}>
                  <Sparkles size={14} aria-hidden="true" /> Generate combinations
                </Button>
                <p className="text-xs text-fg-muted">
                  {variantDimensions.length
                    ? `Variants for ${typeName} are defined by ${variantDimensions.map((d) => d.label).join(" & ")}.`
                    : `${typeName} has no size or colour dimension — each variant is a single option.`}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {duplicateSkuRows.size > 0 && (
        <p className="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-xs text-danger-700" role="alert" data-testid="duplicate-sku-warning">
          {duplicateSkuRows.size} variants share a SKU — each variant needs its own before this can be saved.
        </p>
      )}

      {fields.length > 1 && (
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-line-subtle bg-surface p-3" data-testid="variant-bulk-bar">
          <div>
            <Label className="text-xs" htmlFor="bulk-field">
              Set
            </Label>
            <Select id="bulk-field" value={bulkField} onChange={(e) => setBulkField(e.target.value as BulkField)} className="h-9 text-xs">
              {BULK_FIELDS.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label className="text-xs" htmlFor="bulk-value">
              to
            </Label>
            <Input
              id="bulk-value"
              type="number"
              step={bulkField === "stock" ? "1" : "0.01"}
              value={bulkValue}
              onChange={(e) => setBulkValue(e.target.value)}
              placeholder={bulkField === "stock" ? "e.g. 10" : "empty clears"}
              className="h-9 w-32 text-xs"
            />
          </div>
          <Button type="button" variant="outline" size="sm" onClick={applyBulk}>
            Apply to {selectedRows.size ? `${targetIndexes.length} selected` : `all ${fields.length}`}
          </Button>
          {selectedRows.size > 0 && (
            <Button type="button" variant="link" size="sm" onClick={() => setSelectedRows(new Set())}>
              Clear selection
            </Button>
          )}
          <p className="basis-full text-xs text-fg-muted">
            Drag <GripVertical size={11} className="-mt-0.5 inline" aria-hidden="true" /> to reorder — the top variant is what customers see selected by default.
          </p>
        </div>
      )}

      {/* Explicit id: dnd-kit's auto-generated ids drift between server render and hydration. */}
      <DndContext id="variant-editor-dnd" sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
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
              const row = (watch(`variants.${index}`) ?? {}) as { sku?: string; size?: string; color?: string; stock?: number; isActive?: boolean; colorHex?: string | null };
              const hasError = Boolean(rowErrors[index]) || duplicateSkuRows.has(index);
              const open = hasError || !folded.has(field.id);
              const title = [sizeDim && row.size, colorDim && row.color].filter(Boolean).join(" / ") || `Variant ${index + 1}`;
              const id = (key: string) => `variant-${field.id}-${key}`;
              const err = (key: string) => rowErrors[index]?.[key]?.message;

              return (
                <SortableVariantRow key={field.id} id={field.id} hasError={hasError}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    {fields.length > 1 && <Checkbox checked={selectedRows.has(field.id)} onChange={() => toggleRow(field.id)} aria-label={`Select variant ${index + 1}`} />}
                    {row.colorHex && /^#[0-9a-fA-F]{6}$/.test(row.colorHex) && (
                      <span className="h-4 w-4 shrink-0 rounded-full ring-1 ring-ink-900/10" style={{ backgroundColor: row.colorHex }} aria-hidden="true" />
                    )}
                    <span className="min-w-0 truncate text-sm font-medium text-fg">{title}</span>
                    {index === 0 ? (
                      <Badge variant="accent" className="gap-1 px-2 py-0 text-[0.6875rem]">
                        <Star size={10} className="fill-current" aria-hidden="true" /> Default
                      </Badge>
                    ) : (
                      <button type="button" onClick={() => move(index, 0)} className="rounded-full px-2 py-0.5 text-[0.6875rem] text-fg-muted hover:bg-ink-900/[0.05] hover:text-fg">
                        Set as default
                      </button>
                    )}
                    {row.isActive === false && (
                      <Badge variant="neutral" className="px-2 py-0 text-[0.6875rem]">
                        Off sale
                      </Badge>
                    )}
                    {chips.map((chip) => (
                      <span key={chip} className="rounded-full bg-surface-muted px-2 py-0.5 text-[0.6875rem] text-ink-600">
                        {chip}
                      </span>
                    ))}
                    <span className="ml-auto flex items-center gap-1">
                      {!open && (
                        <span className="hidden text-xs tabular-nums text-fg-muted sm:inline">
                          {row.sku || "No SKU"} · {Number.isFinite(row.stock) ? row.stock : 0} in stock
                        </span>
                      )}
                      <IconButton
                        size="sm"
                        onClick={() => toggleFold(field.id)}
                        aria-expanded={open}
                        aria-label={`${open ? "Hide" : "Show"} details for variant ${index + 1}`}
                        disabled={hasError}
                      >
                        <ChevronDown size={16} className={cn("transition-transform duration-base ease-smooth", open && "rotate-180")} />
                      </IconButton>
                      <IconButton size="sm" variant="danger" onClick={() => remove(index)} aria-label="Remove variant" disabled={fields.length === 1}>
                        <Trash2 size={15} />
                      </IconButton>
                    </span>
                  </div>

                  <div className="mt-4 space-y-4" hidden={!open}>
                    {(sizeDim || colorDim) && (
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {/* Strictly by target field: a colour-only type has no size input at all. */}
                        {sizeDim && (
                          <div>
                            <Label htmlFor={id("size")} className="text-xs">
                              {sizeDim.label}
                            </Label>
                            <Input
                              id={id("size")}
                              placeholder={sizeDim.options?.length ? `e.g. ${sizeDim.options.join(", ")}` : "Standard"}
                              aria-invalid={Boolean(err("size")) || undefined}
                              {...register(`variants.${index}.size`)}
                            />
                            {err("size") && <p className="ui-field-error">{err("size")}</p>}
                          </div>
                        )}
                        {sizeDim?.label.trim().toLowerCase() === "size" && (
                          <div>
                            <Label htmlFor={id("sizeLabel")} className="text-xs">
                              Equivalent size
                            </Label>
                            <Input id={id("sizeLabel")} placeholder="e.g. L (optional)" {...register(`variants.${index}.sizeLabel`)} />
                          </div>
                        )}
                        {colorDim && (
                          <>
                            <div>
                              <Label htmlFor={id("color")} className="text-xs">
                                {colorDim.label}
                              </Label>
                              <Input id={id("color")} placeholder={colorDim.options?.[0] ?? "Black"} aria-invalid={Boolean(err("color")) || undefined} {...register(`variants.${index}.color`)} />
                              {err("color") && <p className="ui-field-error">{err("color")}</p>}
                            </div>
                            <div>
                              <Label htmlFor={id("colorHex")} className="text-xs">
                                Color code
                              </Label>
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="color"
                                  value={/^#[0-9a-fA-F]{6}$/.test(row.colorHex ?? "") ? (row.colorHex as string) : "#000000"}
                                  onChange={(e) => setValue(`variants.${index}.colorHex`, e.target.value, { shouldDirty: true })}
                                  className="h-10 w-10 shrink-0 cursor-pointer rounded-lg border border-line bg-transparent p-1"
                                  aria-label="Pick color"
                                />
                                <Input id={id("colorHex")} placeholder="#000000" {...register(`variants.${index}.colorHex`)} />
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <div className="col-span-2">
                        {/* The button sits beside the label, not inside it: a control nested in a <label> stops being a
                            button of its own for assistive tech. */}
                        <div className="mb-1.5 flex items-center justify-between">
                          <Label htmlFor={id("sku")} className="mb-0 text-xs">
                            SKU
                          </Label>
                          <button
                            type="button"
                            disabled={!typeId || generatingSku === index}
                            onClick={() => handleGenerateSku(index)}
                            className="flex items-center gap-1 rounded-full px-1.5 text-xs font-medium text-ink-600 hover:bg-ink-900/[0.05] hover:text-fg disabled:opacity-40"
                            title="Generate from the SKU pattern (Catalog setup → SKUs)"
                          >
                            <Wand2 size={12} aria-hidden="true" /> {generatingSku === index ? "…" : "Generate"}
                          </button>
                        </div>
                        <Input
                          id={id("sku")}
                          placeholder="SKU-001"
                          aria-invalid={duplicateSkuRows.has(index) || Boolean(err("sku")) || undefined}
                          {...register(`variants.${index}.sku`)}
                        />
                        {duplicateSkuRows.has(index) && <p className="ui-field-error">Same SKU as another variant</p>}
                        {err("sku") && <p className="ui-field-error">{err("sku")}</p>}
                      </div>
                      <div className="col-span-2">
                        <Label htmlFor={id("barcode")} className="text-xs">
                          Barcode
                        </Label>
                        <Input id={id("barcode")} placeholder="Optional" {...register(`variants.${index}.barcode`)} />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <div>
                        <Label htmlFor={id("price")} className="text-xs">
                          Price override
                        </Label>
                        <Input id={id("price")} type="number" step="0.01" inputMode="decimal" placeholder="Base price" {...register(`variants.${index}.price`, { valueAsNumber: true })} />
                      </div>
                      <div>
                        <Label htmlFor={id("compareAtPrice")} className="text-xs">
                          Compare-at price
                        </Label>
                        <Input
                          id={id("compareAtPrice")}
                          type="number"
                          step="0.01"
                          inputMode="decimal"
                          placeholder="Optional"
                          {...register(`variants.${index}.compareAtPrice`, { valueAsNumber: true })}
                        />
                      </div>
                      <div>
                        <Label htmlFor={id("costPrice")} className="text-xs">
                          Cost price
                        </Label>
                        <Input id={id("costPrice")} type="number" step="0.01" inputMode="decimal" placeholder="—" {...register(`variants.${index}.costPrice`, { valueAsNumber: true })} />
                      </div>
                      <div>
                        <div className="mb-1.5 flex items-center justify-between">
                          <Label htmlFor={id("stock")} className="mb-0 text-xs">
                            Stock
                          </Label>
                          {watch(`variants.${index}.id`) && (
                            <Link
                              href={`/admin/inventory?variantId=${watch(`variants.${index}.id`)}`}
                              target="_blank"
                              className="flex items-center gap-0.5 text-xs text-fg-muted hover:text-fg"
                              title="View stock history"
                            >
                              <History size={11} aria-hidden="true" /> History
                            </Link>
                          )}
                        </div>
                        <Input id={id("stock")} type="number" inputMode="numeric" aria-invalid={Boolean(err("stock")) || undefined} {...register(`variants.${index}.stock`, { valueAsNumber: true })} />
                        {err("stock") && <p className="ui-field-error">{err("stock")}</p>}
                      </div>
                      <div>
                        <Label htmlFor={id("weight")} className="text-xs">
                          Weight (kg)
                        </Label>
                        <Input id={id("weight")} type="number" step="0.01" inputMode="decimal" placeholder="Optional" {...register(`variants.${index}.weight`, { valueAsNumber: true })} />
                      </div>
                      <label className="flex items-center gap-2 self-end pb-2.5 text-sm text-ink-700" title="Inactive variants are hidden from the storefront and can't be bought">
                        <Checkbox {...register(`variants.${index}.isActive`)} />
                        On sale
                      </label>
                    </div>

                    <div>
                      <p className="ui-label text-xs">Variant images</p>
                      {productImages.length > 0 ? (
                        <Controller
                          control={control}
                          name={`variants.${index}.imageIds`}
                          render={({ field: f }) => (
                            <VariantGalleryPicker images={productImages} value={(f.value as string[] | undefined) ?? []} onChange={f.onChange} label={`Variant ${index + 1}`} />
                          )}
                        />
                      ) : (
                        <p className="text-xs text-fg-muted">Upload product photos first (Media), then choose which belong to this variant.</p>
                      )}
                    </div>
                  </div>
                </SortableVariantRow>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => append({ sku: "", size: "", color: "", stock: 0, isActive: true, attributeValueIds: [] })}>
          <Plus size={14} aria-hidden="true" /> Add variant manually
        </Button>
        {/* After the rows, not in the bulk bar: each row's own "Generate" keeps its place in the page order. */}
        {typeId && fields.length > 1 && liveVariants.some((v) => !v?.sku?.trim()) && (
          <Button type="button" variant="outline" size="sm" onClick={generateMissingSkus} loading={generatingAll}>
            <Wand2 size={14} aria-hidden="true" /> Generate missing SKUs
          </Button>
        )}
      </div>
    </div>
  );
}

interface SortableVariantRowProps {
  id: string;
  hasError: boolean;
  children: React.ReactNode;
}

function SortableVariantRow({ id, hasError, children }: SortableVariantRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "relative rounded-xl border bg-surface p-4 pl-10 transition-shadow duration-base ease-smooth",
        hasError ? "border-danger-200 ring-1 ring-danger-100" : "border-line-subtle",
        isDragging && "z-10 shadow-floatLg ring-2 ring-accent/15",
      )}
    >
      <button
        type="button"
        className="absolute left-1.5 top-3 touch-none rounded-md p-2 text-ink-300 hover:bg-ink-900/[0.05] hover:text-ink-600 active:cursor-grabbing"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={15} />
      </button>
      {children}
    </div>
  );
}
