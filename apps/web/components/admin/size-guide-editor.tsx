/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { DEFAULT_SIZE_GUIDE, type ResolvedTypeConfig } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { FormSection } from "@/components/admin/form-section";

interface SizeGuideEditorProps {
  typeName: string;
  sizeGuide: ResolvedTypeConfig["sizeGuide"];
  watch: any;
  setValue: any;
}

/** A product's size guide: by default it follows its type's preset; editing anything here saves a
 * product-level override, and "Use the type's size guide" drops the override again. */
export function SizeGuideEditor({ typeName, sizeGuide, watch, setValue }: SizeGuideEditorProps) {
  const saved = watch("attributes.sizeGuide");
  const presetChart = sizeGuide.chart ?? DEFAULT_SIZE_GUIDE;
  // With nothing saved the storefront shows the preset (when the type switches it on by default), so the
  // editor starts from that same table; the first edit saves it onto the product as an override.
  const sg = saved ?? { ...presetChart, enabled: sizeGuide.mode === "ON_BY_DEFAULT" };

  if (sizeGuide.mode === "NOT_APPLICABLE") {
    return (
      <FormSection title="Size Guide">
        <p className="text-sm text-ink-500">Size guide is not applicable for {typeName}.</p>
      </FormSection>
    );
  }

  const enabled = Boolean(sg.enabled);
  const isOverride = Boolean(saved);

  function update(updated: any) {
    setValue("attributes.sizeGuide", updated, { shouldDirty: true });
  }

  return (
    <FormSection
      title="Size Guide"
      description={
        isOverride
          ? "This product has its own size guide."
          : `Using the "${presetChart.title ?? "default"}" size guide from ${typeName}. Edit it below to give this product its own.`
      }
    >
      <div className="space-y-4">
        <label className="flex items-center gap-2 text-sm font-medium text-ink-800">
          <Checkbox checked={enabled} onChange={(e) => update({ ...sg, enabled: e.target.checked })} />
          Show Size Guide on Storefront
        </label>

        {isOverride && (
          <Button type="button" variant="outline" size="sm" onClick={() => setValue("attributes.sizeGuide", undefined, { shouldDirty: true })}>
            Use the type&rsquo;s size guide
          </Button>
        )}

        {enabled && (
          <div className="mt-4 space-y-4 rounded-xl border border-ink-100 bg-cream-50/50 p-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label>Guide Title</Label>
                <Input value={sg.title || ""} onChange={(e) => update({ ...sg, title: e.target.value })} placeholder="e.g. Panjabi Size Guide" />
              </div>
              <div>
                <Label>Measurement Unit</Label>
                <Input value={sg.unit || ""} onChange={(e) => update({ ...sg, unit: e.target.value })} placeholder="inch or cm" />
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <Label>Size Chart Table</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const cols = [...(sg.columns || []), `Col ${(sg.columns?.length || 0) + 1}`];
                      const rows = (sg.rows || []).map((r: string[]) => [...r, ""]);
                      update({ ...sg, columns: cols, rows });
                    }}
                  >
                    + Add Column
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const rows = [...(sg.rows || []), new Array(sg.columns?.length || 1).fill("")];
                      update({ ...sg, rows });
                    }}
                  >
                    + Add Row
                  </Button>
                </div>
              </div>

              <div className="overflow-x-auto rounded-lg border border-ink-200 bg-white p-2">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr>
                      {(sg.columns || []).map((col: string, ci: number) => (
                        <th key={ci} className="border-b border-ink-100 p-2">
                          <div className="flex items-center gap-1">
                            <Input
                              value={col}
                              onChange={(e) => {
                                const cols = [...sg.columns];
                                cols[ci] = e.target.value;
                                update({ ...sg, columns: cols });
                              }}
                              className="h-8 text-xs font-semibold"
                            />
                            {sg.columns.length > 1 && (
                              <button
                                type="button"
                                onClick={() => {
                                  const cols = sg.columns.filter((_: any, i: number) => i !== ci);
                                  const rows = sg.rows.map((r: string[]) => r.filter((_: any, i: number) => i !== ci));
                                  update({ ...sg, columns: cols, rows });
                                }}
                                className="px-1 text-xs text-danger-500"
                                aria-label={`Remove column ${col}`}
                              >
                                ×
                              </button>
                            )}
                          </div>
                        </th>
                      ))}
                      <th className="w-10 border-b border-ink-100"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(sg.rows || []).map((row: string[], ri: number) => (
                      <tr key={ri}>
                        {row.map((cell: string, ci: number) => (
                          <td key={ci} className="border-b border-ink-50 p-2">
                            <Input
                              value={cell}
                              onChange={(e) => {
                                const rows = sg.rows.map((r: string[], idx: number) =>
                                  idx === ri ? r.map((val, cIdx) => (cIdx === ci ? e.target.value : val)) : r,
                                );
                                update({ ...sg, rows });
                              }}
                              className="h-8 text-xs"
                            />
                          </td>
                        ))}
                        <td className="border-b border-ink-50 p-2 text-center">
                          {sg.rows.length > 1 && (
                            <button
                              type="button"
                              onClick={() => update({ ...sg, rows: sg.rows.filter((_: any, idx: number) => idx !== ri) })}
                              className="text-xs font-bold text-danger-500"
                              aria-label={`Remove row ${ri + 1}`}
                            >
                              ×
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </FormSection>
  );
}
