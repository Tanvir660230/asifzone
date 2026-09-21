/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState } from "react";
import { Controller, useFieldArray } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import type { ResolvedTypeConfig } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormSection } from "@/components/admin/form-section";
import * as catalogApi from "@/lib/api/catalog";

interface CareMaterialSectionProps {
  control: any;
  register: any;
  watch: any;
  setValue: any;
  errors: any;
  config: ResolvedTypeConfig | undefined;
}

const toLines = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean);

/** Care instructions (preset → product override) and the material composition. Everything here is a
 * product-level choice layered over what the product type's template already provides. */
export function CareMaterialSection({ control, register, watch, setValue, errors, config }: CareMaterialSectionProps) {
  const { data: careData } = useQuery({ queryKey: ["catalog-care-guides"], queryFn: catalogApi.listCareGuides });
  const { data: materialsData } = useQuery({ queryKey: ["catalog-materials"], queryFn: catalogApi.listMaterials });
  const careGuides = careData?.careGuides ?? [];
  const materialOptions = materialsData?.materials ?? [];

  const carePresetId: string = watch("carePresetId") ?? "";
  const careOverride: string[] = watch("careOverride") ?? [];
  const [customMode, setCustomMode] = useState(careOverride.length > 0);
  const [customText, setCustomText] = useState(careOverride.join("\n"));

  const { fields, append, remove } = useFieldArray({ control, name: "materials" });
  const rows: { materialId?: string | null; customName?: string | null; percentage?: number | null }[] = watch("materials") ?? [];
  const total = rows.reduce((sum, r) => sum + (Number(r.percentage) || 0), 0);
  const nameOf = (r: (typeof rows)[number]) => materialOptions.find((m) => m.id === r.materialId)?.name ?? r.customName ?? "";
  const composition = rows
    .filter((r) => nameOf(r))
    .map((r) => `${r.percentage ? `${r.percentage}% ` : ""}${nameOf(r)}`)
    .join(", ");

  const selectedGuide = careGuides.find((g) => g.id === carePresetId);
  const templateCare = config?.care;
  const effectiveSteps = customMode && careOverride.length ? careOverride : (selectedGuide?.steps ?? templateCare?.steps ?? []);
  const effectiveSource = customMode && careOverride.length ? "this product" : selectedGuide ? `the “${selectedGuide.name}” care guide` : templateCare?.name ? `the type’s default (“${templateCare.name}”)` : null;

  return (
    <>
      <FormSection title="Care instructions" description="Which care guide customers see. Pick a shared one, or write steps just for this product.">
        <div className="space-y-4">
          <div>
            <Label htmlFor="carePresetId">Care guide</Label>
            <Controller
              control={control}
              name="carePresetId"
              render={({ field }) => (
                <Select id="carePresetId" ref={field.ref} value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value)} onBlur={field.onBlur}>
                  <option value="">{templateCare?.name ? `Type default — ${templateCare.name}` : "None (type has no default)"}</option>
                  {careGuides
                    .filter((g) => !g.isArchived || g.id === carePresetId)
                    .map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                        {g.isArchived ? " (archived)" : ""}
                      </option>
                    ))}
                </Select>
              )}
            />
            {errors?.carePresetId && <p className="mt-1 text-xs text-danger-600">{errors.carePresetId.message}</p>}
          </div>

          <label className="flex items-center gap-2 text-sm text-ink-700">
            <Checkbox
              checked={customMode}
              onChange={(e) => {
                setCustomMode(e.target.checked);
                // Turning it off clears the override, so the product falls back to the guide again.
                setValue("careOverride", e.target.checked ? toLines(customText) : [], { shouldDirty: true });
              }}
            />
            Write custom care steps for this product
          </label>
          {customMode && (
            <div>
              <Label htmlFor="careOverride">Care steps (one per line)</Label>
              <Textarea
                id="careOverride"
                rows={5}
                value={customText}
                onChange={(e) => {
                  setCustomText(e.target.value);
                  setValue("careOverride", toLines(e.target.value), { shouldDirty: true });
                }}
                placeholder={"Dry clean only\nStore flat"}
              />
            </div>
          )}

          <div className="rounded-lg border border-ink-100 bg-white p-3" data-testid="care-preview">
            <p className="mb-1 text-xs uppercase tracking-wide text-ink-400">What customers will see{effectiveSource ? ` — from ${effectiveSource}` : ""}</p>
            {effectiveSteps.length > 0 ? (
              <ol className="list-decimal space-y-0.5 pl-5 text-sm text-ink-700">
                {effectiveSteps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-ink-400">No care instructions.</p>
            )}
          </div>
        </div>
      </FormSection>

      <FormSection title="Material" description="What the product is made of. Add several with percentages, or a custom material for this product only.">
        <div className="space-y-2">
          {fields.length === 0 && <p className="text-sm text-ink-400">No materials added.</p>}
          {fields.map((f, i) => {
            const isCustom = !rows[i]?.materialId;
            const rowErrors = errors?.materials?.[i];
            return (
              <div key={f.id} className="grid grid-cols-1 items-start gap-2 rounded-lg border border-ink-100 p-3 sm:grid-cols-[1fr_1fr_7rem_auto]">
                <Controller
                  control={control}
                  name={`materials.${i}.materialId`}
                  render={({ field }) => (
                    <Select ref={field.ref} value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value || null)} aria-label={`Material ${i + 1}`}>
                      <option value="">Custom material…</option>
                      {materialOptions
                        .filter((m) => !m.isArchived || m.id === field.value)
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                            {m.isArchived ? " (archived)" : ""}
                          </option>
                        ))}
                    </Select>
                  )}
                />
                {isCustom ? (
                  <Input placeholder="Custom material name" aria-label={`Custom material ${i + 1} name`} {...register(`materials.${i}.customName`)} />
                ) : (
                  <span className="hidden sm:block" />
                )}
                <div className="flex items-center gap-1">
                  <Input type="number" step="0.01" min="0" max="100" placeholder="%" aria-label={`Material ${i + 1} percentage`} {...register(`materials.${i}.percentage`, { valueAsNumber: true })} />
                  <span className="text-sm text-ink-400">%</span>
                </div>
                <button type="button" onClick={() => remove(i)} className="p-2 text-ink-400 hover:text-danger-600" aria-label={`Remove material ${i + 1}`}>
                  <Trash2 size={16} />
                </button>
                {rowErrors?.materialId?.message && <p className="text-xs text-danger-600 sm:col-span-4">{rowErrors.materialId.message}</p>}
              </div>
            );
          })}
        </div>
        {errors?.materials?.message && <p className="text-xs text-danger-600">{errors.materials.message}</p>}
        {errors?.materials?.root?.message && <p className="text-xs text-danger-600">{errors.materials.root.message}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => append({ materialId: null, customName: "", percentage: null })}>
            <Plus size={14} /> Add material
          </Button>
          {rows.length > 0 && (
            <p className={total > 100 ? "text-xs text-danger-600" : "text-xs text-ink-500"} data-testid="material-total">
              {composition ? `${composition} · ` : ""}Total {Math.round(total * 100) / 100}%{total > 100 ? " — over 100%" : ""}
            </p>
          )}
        </div>
      </FormSection>
    </>
  );
}
