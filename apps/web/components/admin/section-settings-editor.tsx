"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import {
  isEmptyOverride,
  resolveSections,
  type SectionLayer,
  type SectionOverrideInput,
  type SectionSource,
} from "@clothing-brand/shared";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type SectionLevel = "store" | "template" | "product";

interface SectionSettingsEditorProps {
  level: SectionLevel;
  /** The levels *below* this one, so the editor can show what a blank field inherits. */
  base: { global?: SectionLayer; template?: SectionLayer };
  /** This level's own overrides. */
  value: SectionOverrideInput[];
  onChange: (rows: SectionOverrideInput[]) => void;
}

const LEVEL_KEY = { store: "global", template: "template", product: "product" } as const;
const AREA_LABEL = { accordion: "Beside the photos", block: "Full-width block", control: "Small control" } as const;
const SOURCE_LABEL: Record<SectionSource, string> = { product: "this product", template: "the template", global: "the store settings", default: "the default" };

export const layerOf = (rows: SectionOverrideInput[]): SectionLayer =>
  Object.fromEntries(rows.map((r) => [r.sectionKey, { enabled: r.enabled, sortOrder: r.sortOrder, title: r.title, content: r.content }]));

const CONTENT_HELP = {
  text: "Text customers see. Line breaks are kept; basic formatting is allowed.",
  lines: "One item per line.",
  video: "A YouTube or Vimeo link, or a direct https link to an .mp4 / .webm file.",
  none: "",
} as const;

/** Turn sections on or off, reorder them, retitle them and (for text sections) write their words — at one level of the
 * store → template → product cascade. Anything left blank inherits from the level below and says so. */
export function SectionSettingsEditor({ level, base, value, onChange }: SectionSettingsEditorProps) {
  const layerKey = LEVEL_KEY[level];
  // What the page would do without this level's choices (to label "inherited from …"), and with them (the display order).
  const inherited = new Map(resolveSections(base).map((s) => [s.key, s]));
  const effective = resolveSections({ ...base, [layerKey]: layerOf(value) });
  const rowOf = (key: string) => value.find((r) => r.sectionKey === key);
  const hasOrder = value.some((r) => r.sortOrder != null);

  function patch(key: string, change: Partial<SectionOverrideInput>) {
    const current = rowOf(key) ?? { sectionKey: key as SectionOverrideInput["sectionKey"] };
    const next = { ...current, ...change } as SectionOverrideInput;
    const rest = value.filter((r) => r.sectionKey !== key);
    // A row that overrides nothing is dropped, so clearing every field really does mean "inherit".
    onChange(isEmptyOverride(next) ? rest : [...rest, next]);
  }

  function move(index: number, delta: number) {
    const order = effective.map((s) => s.key);
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target]!, order[index]!];
    // Moving pins the whole order at this level (10, 20, …) — a single swap can't be expressed against inherited numbers.
    const rows = new Map(value.map((r) => [r.sectionKey as string, r]));
    order.forEach((key, i) => rows.set(key, { ...(rows.get(key) ?? { sectionKey: key as SectionOverrideInput["sectionKey"] }), sortOrder: (i + 1) * 10 } as SectionOverrideInput));
    onChange([...rows.values()]);
  }

  return (
    <div className="space-y-2" data-testid="section-settings">
      {hasOrder && (
        <button type="button" className="text-xs text-ink-500 underline hover:text-ink-900" onClick={() => onChange(value.map((r) => ({ ...r, sortOrder: null })).filter((r) => !isEmptyOverride(r)))}>
          Reset the order to {level === "store" ? "the default" : "what it inherits"}
        </button>
      )}
      <ol className="space-y-2">
        {effective.map((s, i) => {
          const row = rowOf(s.key);
          const base = inherited.get(s.key)!;
          const visibility = row?.enabled == null ? "" : String(row.enabled);
          const setHere = row != null && !isEmptyOverride(row);
          return (
            <li key={s.key} className={cn("rounded-lg border p-3", s.enabled ? "border-ink-100 bg-cream-50" : "border-dashed border-ink-200 bg-ink-50/40")} data-section={s.key}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="flex flex-col">
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="text-ink-400 hover:text-ink-900 disabled:opacity-25" aria-label={`Move ${s.label} up`}>
                      <ArrowUp size={14} />
                    </button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === effective.length - 1} className="text-ink-400 hover:text-ink-900 disabled:opacity-25" aria-label={`Move ${s.label} down`}>
                      <ArrowDown size={14} />
                    </button>
                  </div>
                  <div>
                    <p className={cn("text-sm font-medium", s.enabled ? "text-ink-900" : "text-ink-500")}>{s.label}</p>
                    <p className="text-[11px] text-ink-400">
                      {AREA_LABEL[s.area]}
                      {setHere ? " · set here" : ""}
                      {!setHere && level !== "store" && base.source.enabled !== "default" ? ` · from ${SOURCE_LABEL[base.source.enabled]}` : ""}
                    </p>
                  </div>
                </div>
                <Select
                  value={visibility}
                  onChange={(e) => patch(s.key, { enabled: e.target.value === "" ? null : e.target.value === "true" })}
                  className="h-8 w-44 text-xs"
                  aria-label={`${s.label} visibility`}
                >
                  <option value="">{level === "store" ? `Default (${base.enabled ? "shown" : "hidden"})` : `Inherit (${base.enabled ? "shown" : "hidden"})`}</option>
                  <option value="true">Show</option>
                  <option value="false">Hide</option>
                </Select>
              </div>

              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Input
                  value={row?.title ?? ""}
                  onChange={(e) => patch(s.key, { title: e.target.value })}
                  placeholder={`Title — ${base.title}`}
                  className="h-8 text-xs"
                  aria-label={`${s.label} title`}
                  maxLength={80}
                />
              </div>

              {s.contentType !== "none" && (
                <div className="mt-2">
                  {s.contentType === "video" ? (
                    <Input value={row?.content ?? ""} onChange={(e) => patch(s.key, { content: e.target.value })} placeholder="https://www.youtube.com/watch?v=…" className="h-8 text-xs" aria-label={`${s.label} link`} />
                  ) : (
                    <Textarea
                      value={row?.content ?? ""}
                      onChange={(e) => patch(s.key, { content: e.target.value })}
                      rows={s.contentType === "lines" ? 3 : 2}
                      placeholder={base.content ? `${base.content.slice(0, 140)}${base.content.length > 140 ? "…" : ""}` : s.contentType === "lines" ? "One per line" : "Text"}
                      className="text-xs"
                      aria-label={`${s.label} text`}
                    />
                  )}
                  <p className="mt-0.5 text-[11px] text-ink-400">{CONTENT_HELP[s.contentType]}</p>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
