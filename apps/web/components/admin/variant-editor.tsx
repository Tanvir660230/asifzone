"use client";

import { useState } from "react";
import Link from "next/link";
import { Controller, useFieldArray, type Control, type UseFormRegister, type UseFormSetValue, type UseFormWatch } from "react-hook-form";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, GripVertical, History, Sparkles, Star, Trash2, Wand2 } from "lucide-react";
import { findDuplicateSkus, type Attribute, type AttributeValue, type CreateProductInput, type ProductImage, type VariantDimension } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/components/ui/toast";
import * as catalogApi from "@/lib/api/catalog";
import { VariantGalleryPicker } from "./variant-gallery-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { StagedImage } from "./image-uploader";

interface VariantEditorProps {
  control: Control<CreateProductInput>;
  register: UseFormRegister<CreateProductInput>;
  watch: UseFormWatch<CreateProductInput>;
  setValue: UseFormSetValue<CreateProductInput>;
  attributes: Attribute[];
  productImages: ProductImage[];
  /** Only passed while creating a new product — images picked in the gallery uploader above
   * aren't saved yet, so variant image assignment has to work off these in-memory files instead
   * of `productImages` (which is always empty until the product exists). */
  stagedImages?: StagedImage[];
  variantImageKeys?: Record<number, string>;
  onVariantImageKeyChange?: (index: number, key: string) => void;
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

export function VariantEditor({
  control,
  register,
  watch,
  setValue,
  attributes,
  productImages,
  stagedImages,
  variantImageKeys,
  onVariantImageKeyChange,
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

  /** Asks the server for the next SKU from the configured pattern, telling it which SKUs this form already holds
   * so two unsaved rows can't be handed the same one. */
  async function handleGenerateSku(index: number) {
    if (!typeId) return;
    setGeneratingSku(index);
    try {
      const all = (watch("variants") ?? []) as { sku?: string; color?: string | null; size?: string | null }[];
      const row = all[index];
      const { sku } = await catalogApi.generateSku({
        typeId,
        color: row?.color,
        size: row?.size,
        taken: all.map((v) => v.sku ?? "").filter(Boolean),
      });
      setValue(`variants.${index}.sku`, sku, { shouldDirty: true, shouldValidate: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't generate a SKU");
    } finally {
      setGeneratingSku(null);
    }
  }
  const [selected, setSelected] = useState<Record<string, Set<string>>>({});
  // Attributes load asynchronously (separate query), so this can't be a one-shot useState initializer —
  // it needs to open as soon as attributes actually arrive, not just at first mount.
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [autoOpened, setAutoOpened] = useState(false);
  if (!autoOpened && attributes.length > 0 && fields.length <= 1) {
    setAutoOpened(true);
    setGeneratorOpen(true);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

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
        isActive: true,
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
                {variantDimensions.length
                  ? `Variants for ${typeName} are defined by ${variantDimensions.map((d) => d.label).join(" & ")}.`
                  : `${typeName} has no size or colour dimension — each variant is a single option.`}
              </p>
            </div>
          )}
        </div>
      )}

      {duplicateSkuRows.size > 0 && (
        <p className="mb-2 rounded-md bg-danger-50 px-3 py-2 text-xs text-danger-700" role="alert" data-testid="duplicate-sku-warning">
          {duplicateSkuRows.size} variants share a SKU — each variant needs its own before this can be saved.
        </p>
      )}

      {fields.length > 1 && (
        <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-ink-100 bg-white p-3" data-testid="variant-bulk-bar">
          <div>
            <Label className="text-[11px]" htmlFor="bulk-field">Set</Label>
            <Select id="bulk-field" value={bulkField} onChange={(e) => setBulkField(e.target.value as BulkField)} className="h-9 text-xs">
              {BULK_FIELDS.map((f) => (
                <option key={f.key} value={f.key}>{f.label}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label className="text-[11px]" htmlFor="bulk-value">to</Label>
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
            <button type="button" onClick={() => setSelectedRows(new Set())} className="pb-2 text-xs text-ink-500 underline hover:text-ink-900">
              Clear selection
            </button>
          )}
        </div>
      )}

      {fields.length > 1 && (
        <p className="mb-2 text-xs text-ink-400">
          Drag <GripVertical size={11} className="inline -mt-0.5" /> to reorder — the top variant&rsquo;s color and size are what
          customers see selected by default on the product page.
        </p>
      )}

      {/* Explicit id: dnd-kit auto-generates aria-describedby ids from a render-order counter when
          none is given, which drifts between the server render and the client hydration pass in
          Next.js and throws a "Prop did not match" warning — a fixed id makes it deterministic. */}
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

              return (
                <SortableVariantRow key={field.id} id={field.id} isDefault={index === 0}>
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1">
                      {fields.length > 1 && (
                        <Checkbox className="mr-1" checked={selectedRows.has(field.id)} onChange={() => toggleRow(field.id)} aria-label={`Select variant ${index + 1}`} />
                      )}
                      {chips.map((chip) => (
                        <span key={chip} className="rounded-full bg-ink-100 px-2 py-0.5 text-[11px] text-ink-600">
                          {chip}
                        </span>
                      ))}
                      {index !== 0 && (
                        <button
                          type="button"
                          onClick={() => move(index, 0)}
                          className="rounded-full px-2 py-0.5 text-[11px] text-ink-400 hover:bg-brass-50 hover:text-brass-700"
                        >
                          Set as default
                        </button>
                      )}
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
                      {/* The button sits beside the label, not inside it: a control nested in a <label> becomes that label's
                          labelled element and disappears from the accessibility tree as a button of its own. */}
                      <div className="flex items-center justify-between">
                        <Label className="text-[11px]">SKU</Label>
                        <button
                          type="button"
                          disabled={!typeId || generatingSku === index}
                          onClick={() => handleGenerateSku(index)}
                          className="flex items-center gap-0.5 text-[11px] text-brass-600 hover:text-brass-700 disabled:opacity-40"
                          title="Generate from the SKU pattern (Catalog setup → SKUs)"
                        >
                          <Wand2 size={11} /> {generatingSku === index ? "…" : "Generate"}
                        </button>
                      </div>
                      <Input placeholder="SKU-001" aria-invalid={duplicateSkuRows.has(index) || undefined} {...register(`variants.${index}.sku`)} />
                      {duplicateSkuRows.has(index) && <p className="mt-0.5 text-[11px] text-danger-600">Same SKU as another variant</p>}
                    </div>
                    <div>
                      <Label className="text-[11px]">Barcode</Label>
                      <Input placeholder="Optional" {...register(`variants.${index}.barcode`)} />
                    </div>
                    {(() => {
                      // Strictly by target field: a type with only a color dimension (Accessory) has no
                      // size input at all — the schema stores "Standard" — instead of the color dimension
                      // being rendered a second time in the size slot.
                      const sizeDim = variantDimensions.find((d) => d.targetField === "size");
                      const colorDim = variantDimensions.find((d) => d.targetField === "color");
                      return (
                        <>
                          {sizeDim && (
                            <div>
                              <Label className="text-[11px]">{sizeDim.label}</Label>
                              <Input
                                placeholder={sizeDim.options?.length ? `e.g. ${sizeDim.options.join(", ")}` : "Standard"}
                                {...register(`variants.${index}.size`)}
                              />
                            </div>
                          )}
                          {sizeDim?.label.trim().toLowerCase() === "size" && (
                            <div>
                              <Label className="text-[11px]">Equivalent size</Label>
                              <Input placeholder="e.g. L (optional)" {...register(`variants.${index}.sizeLabel`)} />
                            </div>
                          )}
                          {colorDim && (
                            <>
                              <div>
                                <Label className="text-[11px]">{colorDim.label}</Label>
                                <Input placeholder={colorDim.options?.[0] ?? "Black"} {...register(`variants.${index}.color`)} />
                              </div>
                              <div>
                                <Label className="text-[11px]">Color code</Label>
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="color"
                                    value={/^#[0-9a-fA-F]{6}$/.test(watch(`variants.${index}.colorHex`) ?? "") ? (watch(`variants.${index}.colorHex`) as string) : "#000000"}
                                    onChange={(e) => setValue(`variants.${index}.colorHex`, e.target.value, { shouldDirty: true })}
                                    className="h-9 w-9 shrink-0 cursor-pointer rounded border border-ink-200 bg-transparent p-0.5"
                                    aria-label="Pick color"
                                  />
                                  <Input placeholder="#000000" {...register(`variants.${index}.colorHex`)} />
                                </div>
                              </div>
                            </>
                          )}
                        </>
                      );
                    })()}
                    <div>
                      <Label className="text-[11px]">Price override</Label>
                      <Input type="number" step="0.01" placeholder="—" {...register(`variants.${index}.price`, { valueAsNumber: true })} />
                    </div>
                    <div>
                      <Label className="text-[11px]">Cost price</Label>
                      <Input type="number" step="0.01" placeholder="—" {...register(`variants.${index}.costPrice`, { valueAsNumber: true })} />
                    </div>
                    <div>
                      <Label className="flex items-center justify-between text-[11px]">
                        Stock
                        {watch(`variants.${index}.id`) && (
                          <Link
                            href={`/admin/inventory?variantId=${watch(`variants.${index}.id`)}`}
                            target="_blank"
                            className="flex items-center gap-0.5 font-normal normal-case text-ink-400 hover:text-brass-600"
                            title="View stock history"
                          >
                            <History size={11} /> History
                          </Link>
                        )}
                      </Label>
                      <Input type="number" {...register(`variants.${index}.stock`, { valueAsNumber: true })} />
                    </div>
                    <div>
                      <Label className="text-[11px]">Weight (kg)</Label>
                      <Input type="number" step="0.01" placeholder="Optional" {...register(`variants.${index}.weight`, { valueAsNumber: true })} />
                    </div>
                    <div>
                      <Label className="text-[11px]">Compare-at price</Label>
                      <Input type="number" step="0.01" placeholder="Optional" {...register(`variants.${index}.compareAtPrice`, { valueAsNumber: true })} />
                    </div>
                    <div className="flex items-end pb-2">
                      <label className="flex items-center gap-2 text-sm text-ink-700" title="Inactive variants are hidden from the storefront and can't be bought">
                        <Checkbox {...register(`variants.${index}.isActive`)} />
                        On sale
                      </label>
                    </div>
                    <div className={productImages.length > 0 ? "col-span-2 sm:col-span-3 lg:col-span-6" : "col-span-2"}>
                      <Label className="text-[11px]">{productImages.length > 0 ? "Variant images" : "Variant image"}</Label>
                      {productImages.length > 0 ? (
                        <Controller
                          control={control}
                          name={`variants.${index}.imageIds`}
                          render={({ field }) => (
                            <VariantGalleryPicker
                              images={productImages}
                              value={(field.value as string[] | undefined) ?? []}
                              onChange={field.onChange}
                              label={`Variant ${index + 1}`}
                            />
                          )}
                        />
                      ) : stagedImages && stagedImages.length > 0 ? (
                        <Select
                          value={variantImageKeys?.[index] ?? ""}
                          onChange={(e) => onVariantImageKeyChange?.(index, e.target.value)}
                        >
                          <option value="">Use default product image</option>
                          {stagedImages.map((img) => (
                            <option key={img.key} value={img.key}>
                              {img.file.name}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <Select disabled>
                          <option value="">Upload product images first…</option>
                        </Select>
                      )}
                    </div>
                  </div>
                </SortableVariantRow>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => append({ sku: "", size: "", color: "", stock: 0, isActive: true, attributeValueIds: [] })}
        >
          Add variant manually
        </Button>
        {/* After the rows, not in the bulk bar above them: each row's own "Generate" keeps its place in the page order. */}
        {typeId && fields.length > 1 && liveVariants.some((v) => !v?.sku?.trim()) && (
          <Button type="button" variant="outline" size="sm" onClick={generateMissingSkus} disabled={generatingAll}>
            <Wand2 size={14} /> {generatingAll ? "Generating…" : "Generate missing SKUs"}
          </Button>
        )}
      </div>
    </div>
  );
}

interface SortableVariantRowProps {
  id: string;
  isDefault: boolean;
  children: React.ReactNode;
}

function SortableVariantRow({ id, isDefault, children }: SortableVariantRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "rounded-lg border border-ink-100 bg-cream-50 p-3 pl-9 relative",
        isDragging && "z-10 shadow-float ring-2 ring-brass-300",
      )}
    >
      <button
        type="button"
        className="absolute left-2 top-3 touch-none rounded p-1 text-ink-300 hover:text-ink-600 active:cursor-grabbing"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={15} />
      </button>
      {isDefault && (
        <span className="absolute left-8 top-2 flex items-center gap-1 rounded-full bg-brass-100 px-2 py-0.5 text-[10px] font-medium text-brass-700">
          <Star size={10} className="fill-brass-500 text-brass-500" /> Default
        </span>
      )}
      {children}
    </div>
  );
}
