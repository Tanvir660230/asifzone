"use client";

import { useState } from "react";
import Link from "next/link";
import { useFieldArray, type Control, type UseFormRegister, type UseFormSetValue, type UseFormWatch } from "react-hook-form";
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
import { ChevronDown, GripVertical, History, Sparkles, Star, Trash2 } from "lucide-react";
import type { Attribute, AttributeValue, CreateProductInput, ProductImage } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
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
}: VariantEditorProps) {
  const { fields, append, remove, move } = useFieldArray({ control, name: "variants" });
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
                Include &ldquo;Size&rdquo; and &ldquo;Color&rdquo; attributes so storefront filtering keeps working — other attributes (Fabric,
                Pattern…) are stored per-variant but don&rsquo;t affect filters yet.
              </p>
            </div>
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
                      <Label className="text-[11px]">SKU</Label>
                      <Input placeholder="SKU-001" {...register(`variants.${index}.sku`)} />
                    </div>
                    <div>
                      <Label className="text-[11px]">Barcode</Label>
                      <Input placeholder="Optional" {...register(`variants.${index}.barcode`)} />
                    </div>
                    <div>
                      <Label className="text-[11px]">Size</Label>
                      <Input placeholder="M / L / XL / 21" {...register(`variants.${index}.size`)} />
                    </div>
                    <div>
                      <Label className="text-[11px]">Equivalent size</Label>
                      <Input placeholder="e.g. L (optional)" {...register(`variants.${index}.sizeLabel`)} />
                    </div>
                    <div>
                      <Label className="text-[11px]">Color</Label>
                      <Input placeholder="Black" {...register(`variants.${index}.color`)} />
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
                    <div className="col-span-2">
                      <Label className="text-[11px]">Variant image</Label>
                      {productImages.length > 0 ? (
                        <Select {...register(`variants.${index}.imageId`)}>
                          <option value="">Use default product image</option>
                          {productImages.map((img) => (
                            <option key={img.id} value={img.id}>
                              {img.altText || img.url.split("/").pop()}
                            </option>
                          ))}
                        </Select>
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
