"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { EXAMPLE_FIT_PROFILE, fitProfileSchema, formatHeight, recommendSize, type FitBand, type FitHint, type FitProfile } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table } from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface FitProfileEditorProps {
  value: FitProfile | null;
  onChange: (fit: FitProfile | null) => void;
  /** The chart's first column (its size labels), to start a new table from. */
  chartSizes: string[];
}

const HEIGHTS = Array.from({ length: 31 }, (_, i) => 54 + i); // 4'6" … 7'0"
const num = (s: string) => (s.trim() === "" ? null : Number(s));

/** "Find my size" on a size guide: a height × weight table the storefront uses to pick a shopper's size. */
export function FitProfileEditor({ value, onChange, chartSizes }: FitProfileEditorProps) {
  const [test, setTest] = useState({ heightIn: 68, weightKg: "72" });

  if (!value) {
    const sizes = chartSizes.filter(Boolean);
    return (
      <div className="rounded-xl border border-dashed border-ink-200 bg-white p-4">
        <p className="text-sm font-medium text-ink-900">Find my size</p>
        <p className="mt-1 text-sm text-ink-500">Shoppers enter height and weight; the product page picks their size. Off for this guide.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => onChange({ ...EXAMPLE_FIT_PROFILE })}>
            Start from the jacket example
          </Button>
          {sizes.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onChange({ enabled: true, sizes, bands: [{ maxHeightIn: null, maxKg: sizes.map((_, i) => 55 + i * 10) }], chestMaxIn: undefined, runsSmall: false, hints: [] })}
            >
              Start empty ({sizes.join(", ")})
            </Button>
          )}
        </div>
      </div>
    );
  }

  const fit = value;
  const set = (patch: Partial<FitProfile>) => onChange({ ...fit, ...patch });
  const setBand = (i: number, band: FitBand) => set({ bands: fit.bands.map((b, j) => (j === i ? band : b)) });
  const setHint = (i: number, hint: FitHint) => set({ hints: fit.hints.map((h, j) => (j === i ? hint : h)) });
  const check = fitProfileSchema.safeParse(fit);
  const problem = check.success ? null : check.error.issues[0]?.message;
  const result = recommendSize(fit, { heightIn: test.heightIn, weightKg: Number(test.weightKg) });
  const bandLabel = (i: number) => {
    const b = fit.bands[i]!;
    const prev = fit.bands[i - 1]?.maxHeightIn;
    const from = prev != null ? formatHeight(prev + 1) : null;
    if (b.maxHeightIn === null) return from ? `${from} and taller` : "Any height";
    return from ? `${from} – ${formatHeight(b.maxHeightIn)}` : `Up to ${formatHeight(b.maxHeightIn)}`;
  };

  return (
    <div className="space-y-4 rounded-xl border border-ink-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-ink-900">Find my size</p>
          <p className="text-sm text-ink-500">Heaviest weight (kg) each size fits, per height. Empty = that size is not for this height.</p>
        </div>
        <div className="flex items-center gap-3">
          <Switch checked={fit.enabled} onChange={(enabled) => set({ enabled })} aria-label="Show Find my size on the storefront" />
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
            Remove
          </Button>
        </div>
      </div>

      <div>
        <Label htmlFor="fit-sizes">Sizes, smallest first</Label>
        <Input
          id="fit-sizes"
          value={fit.sizes.join(", ")}
          onChange={(e) => {
            const sizes = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
            const fitTo = <T,>(arr: T[], fill: T) => sizes.map((_, i) => arr[i] ?? fill);
            set({ sizes, bands: fit.bands.map((b) => ({ ...b, maxKg: fitTo(b.maxKg, null) })), chestMaxIn: fit.chestMaxIn ? fitTo(fit.chestMaxIn, null) : undefined });
          }}
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-ink-100">
        <Table data-no-stack="" className="border-collapse">
          <thead>
            <tr className="text-xs text-ink-500">
              <th className="p-2 text-left font-medium">Height up to</th>
              {fit.sizes.map((s) => (
                <th key={s} className="p-2 text-left font-medium">{s}</th>
              ))}
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {fit.bands.map((b, i) => (
              <tr key={i} className="border-t border-ink-50">
                <td className="p-1.5">
                  <select
                    aria-label={`Band ${i + 1} height`}
                    className="h-8 rounded-md border border-ink-200 bg-white px-2 text-xs"
                    value={b.maxHeightIn ?? ""}
                    onChange={(e) => setBand(i, { ...b, maxHeightIn: e.target.value === "" ? null : Number(e.target.value) })}
                  >
                    {HEIGHTS.map((h) => <option key={h} value={h}>{formatHeight(h)}</option>)}
                    <option value="">and taller</option>
                  </select>
                  <p className="mt-0.5 text-caption text-ink-400">{bandLabel(i)}</p>
                </td>
                {b.maxKg.map((kg, j) => (
                  <td key={j} className="p-1.5">
                    <Input
                      className="h-8 w-16 text-xs tabular-nums"
                      inputMode="decimal"
                      aria-label={`${bandLabel(i)}, ${fit.sizes[j]} up to kg`}
                      value={kg ?? ""}
                      placeholder="—"
                      onChange={(e) => setBand(i, { ...b, maxKg: b.maxKg.map((x, k) => (k === j ? num(e.target.value) : x)) })}
                    />
                  </td>
                ))}
                <td className="text-center">
                  {fit.bands.length > 1 && (
                    <button type="button" aria-label={`Remove band ${i + 1}`} className="p-1 text-ink-400 hover:text-danger-600" onClick={() => set({ bands: fit.bands.filter((_, j) => j !== i) })}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            <tr className="border-t border-ink-100 bg-ink-50/50">
              <td className="p-2 text-xs text-ink-500">Body chest up to (in)</td>
              {fit.sizes.map((s, j) => (
                <td key={s} className="p-1.5">
                  <Input
                    className="h-8 w-16 text-xs tabular-nums"
                    inputMode="decimal"
                    aria-label={`${s} body chest up to`}
                    value={fit.chestMaxIn?.[j] ?? ""}
                    placeholder="—"
                    onChange={(e) => {
                      const next = fit.sizes.map((_, k) => (k === j ? num(e.target.value) : (fit.chestMaxIn?.[k] ?? null)));
                      set({ chestMaxIn: next.every((x) => x === null) ? undefined : next });
                    }}
                  />
                </td>
              ))}
              <td />
            </tr>
          </tbody>
        </Table>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          const last = fit.bands[fit.bands.length - 1]!;
          const prevMax = fit.bands[fit.bands.length - 2]?.maxHeightIn ?? 60;
          set({ bands: [...fit.bands.slice(0, -1), { ...last, maxHeightIn: Math.min(84, prevMax + 4) }, { ...last, maxHeightIn: null }] });
        }}
      >
        <Plus size={14} /> Height band
      </Button>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm text-ink-800">
          <Checkbox checked={fit.runsSmall} onChange={(e) => set({ runsSmall: e.target.checked })} />
          Runs one size small (the size worn elsewhere counts one up)
        </label>
        <div>
          <Label htmlFor="fit-note">Line under the result</Label>
          <Input id="fit-note" value={fit.note ?? ""} maxLength={160} onChange={(e) => set({ note: e.target.value || undefined })} placeholder="Our jackets run one size small — already counted." />
        </div>
      </div>

      <div>
        <p className="mb-1 text-sm font-medium text-ink-900">Near a limit</p>
        <p className="mb-2 text-xs text-ink-500">Looser: also name the next size up (and pick it for “over a panjabi”). Snug: also name the smaller size.</p>
        <div className="space-y-2">
          {fit.hints.map((h, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 text-xs">
              <select aria-label="Height band" className="h-8 rounded-md border border-ink-200 bg-white px-2" value={h.maxHeightIn ?? ""} onChange={(e) => setHint(i, { ...h, maxHeightIn: e.target.value === "" ? null : Number(e.target.value) })}>
                {fit.bands.map((b, bi) => <option key={bi} value={b.maxHeightIn ?? ""}>{bandLabel(bi)}</option>)}
              </select>
              <Input aria-label="From kg" className="h-8 w-16" inputMode="decimal" value={h.fromKg} onChange={(e) => setHint(i, { ...h, fromKg: Number(e.target.value) || 0 })} />
              <span className="text-ink-400">–</span>
              <Input aria-label="To kg" className="h-8 w-16" inputMode="decimal" value={h.toKg} onChange={(e) => setHint(i, { ...h, toKg: Number(e.target.value) || 0 })} />
              <span className="text-ink-500">kg</span>
              <select aria-label="Kind" className="h-8 rounded-md border border-ink-200 bg-white px-2" value={h.kind} onChange={(e) => setHint(i, { ...h, kind: e.target.value as FitHint["kind"] })}>
                <option value="looser">Looser: next size too</option>
                <option value="snug">Snug: smaller fits too</option>
              </select>
              <button type="button" aria-label="Remove" className="p-1 text-ink-400 hover:text-danger-600" onClick={() => set({ hints: fit.hints.filter((_, j) => j !== i) })}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <Button type="button" variant="ghost" size="sm" onClick={() => set({ hints: [...fit.hints, { maxHeightIn: fit.bands[0]!.maxHeightIn, fromKg: 60, toKg: 62, kind: "looser" }] })}>
            <Plus size={14} /> Add
          </Button>
        </div>
      </div>

      <div className="rounded-lg bg-ink-50 p-3">
        <p className="mb-2 text-xs font-medium text-ink-700">Try it</p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select aria-label="Test height" className="h-9 rounded-md border border-ink-200 bg-white px-2" value={test.heightIn} onChange={(e) => setTest({ ...test, heightIn: Number(e.target.value) })}>
            {HEIGHTS.map((h) => <option key={h} value={h}>{formatHeight(h)}</option>)}
          </select>
          <Input aria-label="Test weight kg" className="h-9 w-20" inputMode="decimal" value={test.weightKg} onChange={(e) => setTest({ ...test, weightKg: e.target.value })} />
          <span className="text-ink-500">kg →</span>
          <span className={cn("font-semibold", result.status === "ok" ? "text-ink-900" : "text-ink-500")}>
            {result.status === "ok"
              ? `${result.size}${result.alternative ? ` (${result.alternative.kind === "looser" ? "looser" : "snug"}: ${result.alternative.size})` : ""}`
              : result.status === "too-large"
                ? "Past the largest size"
                : "Check the numbers"}
          </span>
        </div>
      </div>

      {problem && <p className="text-sm text-danger-600">{problem}</p>}
    </div>
  );
}
