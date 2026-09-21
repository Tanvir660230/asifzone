/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { getDefaultSizeGuide, type ProductTypeConfig } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { FormSection } from "@/components/admin/form-section";

interface SizeGuideEditorProps {
  config: ProductTypeConfig;
  control: any;
  register: any;
  watch: any;
  setValue: any;
}

export function SizeGuideEditor({ config, watch, setValue }: SizeGuideEditorProps) {
  // With nothing saved yet the storefront shows the type's default chart (when the type enables it by
  // default), so the editor starts from that same table; the first edit saves it onto the product.
  const sg = watch("attributes.sizeGuide") ?? {
    ...getDefaultSizeGuide(config.type),
    enabled: config.sizeGuide?.defaultEnabled ?? false,
  };

  if (!config.sizeGuide?.supported) {
    return (
      <FormSection title="Size Guide">
        <p className="text-sm text-ink-500">Size guide is not applicable for this product type.</p>
      </FormSection>
    );
  }

  const enabled = Boolean(sg.enabled);

  function update(updated: any) {
    setValue("attributes.sizeGuide", updated, { shouldDirty: true });
  }

  return (
    <FormSection title="Size Guide" description="Configure size and measurement chart displayed to customers.">
      <div className="space-y-4">
        <label className="flex items-center gap-2 text-sm font-medium text-ink-800">
          <Checkbox checked={enabled} onChange={(e) => update({ ...sg, enabled: e.target.checked })} />
          Show Size Guide on Storefront
        </label>

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
                  <Button type="button" variant="outline" size="sm" onClick={() => {
                    const cols = [...(sg.columns || []), `Col ${(sg.columns?.length || 0) + 1}`];
                    const rows = (sg.rows || []).map((r: string[]) => [...r, ""]);
                    update({ ...sg, columns: cols, rows });
                  }}>+ Add Column</Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => {
                    const rows = [...(sg.rows || []), new Array(sg.columns?.length || 1).fill("")];
                    update({ ...sg, rows });
                  }}>+ Add Row</Button>
                </div>
              </div>

              <div className="overflow-x-auto rounded-lg border border-ink-200 bg-white p-2">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr>
                      {(sg.columns || []).map((col: string, ci: number) => (
                        <th key={ci} className="p-2 border-b border-ink-100">
                          <div className="flex items-center gap-1">
                            <Input value={col} onChange={(e) => {
                              const cols = [...sg.columns]; cols[ci] = e.target.value; update({ ...sg, columns: cols });
                            }} className="h-8 text-xs font-semibold" />
                            {sg.columns.length > 1 && (
                              <button type="button" onClick={() => {
                                const cols = sg.columns.filter((_: any, i: number) => i !== ci);
                                const rows = sg.rows.map((r: string[]) => r.filter((_: any, i: number) => i !== ci));
                                update({ ...sg, columns: cols, rows });
                              }} className="text-danger-500 px-1 text-xs">×</button>
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
                          <td key={ci} className="p-2 border-b border-ink-50">
                            <Input value={cell} onChange={(e) => {
                              const rows = sg.rows.map((r: string[], idx: number) => idx === ri ? r.map((val, cIdx) => cIdx === ci ? e.target.value : val) : r);
                              update({ ...sg, rows });
                            }} className="h-8 text-xs" />
                          </td>
                        ))}
                        <td className="p-2 border-b border-ink-50 text-center">
                          {sg.rows.length > 1 && (
                            <button type="button" onClick={() => {
                              const rows = sg.rows.filter((_: any, idx: number) => idx !== ri);
                              update({ ...sg, rows });
                            }} className="text-danger-500 font-bold text-xs">×</button>
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
