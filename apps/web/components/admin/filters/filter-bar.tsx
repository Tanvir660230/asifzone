"use client";

import { useRef, useState, type ReactNode } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover } from "@/components/ui/popover";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { activeFilterChips, filterOptions, removeChipPatch, setFilterPatch, type FilterDefinition, type FilterValues } from "@/lib/admin/filters";
import { cn } from "@/lib/utils";

/**
 * The shared filter bar (P1.8): search, quick filters as toggle pills, the rest in a "More filters" popover, and the
 * active filters as removable chips with "Clear all" — every control, chip and reset derived from the screen's filter
 * definitions (lib/admin/filters.ts). Pair with useFilterState for URL persistence.
 */
export function FilterBar({
  defs,
  values,
  onChange,
  search,
  onSearchChange,
  searchPlaceholder = "Search",
  onClearAll,
  actions,
}: {
  defs: readonly FilterDefinition[];
  values: FilterValues;
  onChange: (patch: FilterValues) => void;
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  onClearAll: () => void;
  /** Right-aligned controls (page size, export). */
  actions?: ReactNode;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const quick = defs.filter((d) => d.placement === "quick");
  const more = defs.filter((d) => d.placement !== "quick");
  const chips = activeFilterChips(defs, values);
  const moreCount = more.filter((d) => {
    const v = values[d.key];
    return Array.isArray(v) ? v.length > 0 : Boolean(v);
  }).length;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {onSearchChange && (
          <SearchInput value={search ?? ""} onChange={onSearchChange} placeholder={searchPlaceholder} data-page-search="" wrapperClassName="w-full sm:w-72" />
        )}
        {more.length > 0 && (
          <>
            <Button ref={moreRef} variant="outline" size="sm" onClick={() => setMoreOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={moreOpen}>
              <SlidersHorizontal size={14} /> More filters
              {moreCount > 0 && <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold leading-[18px] text-accent-fg">{moreCount}</span>}
            </Button>
            <Popover open={moreOpen} onClose={() => setMoreOpen(false)} anchorRef={moreRef} className="w-80 space-y-3 p-4">
              {more.map((def) => (
                <FilterControl key={def.key} def={def} values={values} onChange={(v) => onChange(setFilterPatch(defs, def.key, v))} />
              ))}
            </Popover>
          </>
        )}
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>

      {quick.map((def) => (
        <div key={def.key} role="group" aria-label={def.label} className="flex flex-wrap items-center gap-1">
          {filterOptions(def, values).map((option) => {
            const current = values[def.key];
            const on = Array.isArray(current) ? current.includes(option.value) : current === option.value;
            const next = def.kind === "multi" ? (on ? (current as string[]).filter((v) => v !== option.value) : [...((current as string[]) ?? []), option.value]) : on ? "" : option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={on}
                onClick={() => onChange(setFilterPatch(defs, def.key, next))}
                className={cn(
                  "flex h-8 items-center rounded-full px-3 text-[13px] font-medium transition-colors duration-fast ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
                  on ? "bg-ink-900/[0.08] text-fg" : "text-fg-muted hover:bg-ink-900/[0.04] hover:text-fg",
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      ))}

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={() => onChange(removeChipPatch(defs, values, chip))}
              aria-label={`Remove filter ${chip.label}`}
              className="flex min-h-[28px] items-center gap-1 rounded-full bg-ink-100 py-1 pl-2.5 pr-1.5 text-xs font-medium text-ink-700 transition-colors duration-fast ease-smooth hover:bg-ink-200"
            >
              {chip.label}
              <X size={12} className="text-ink-400" aria-hidden="true" />
            </button>
          ))}
          <button type="button" onClick={onClearAll} className="px-1 text-xs font-medium text-ink-500 underline-offset-2 hover:text-ink-800 hover:underline">
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}

function FilterControl({ def, values, onChange }: { def: FilterDefinition; values: FilterValues; onChange: (value: string | string[]) => void }) {
  const id = `filter-${def.key.replace(/\W/g, "-")}`;
  const value = values[def.key];
  if (def.kind === "date" || def.kind === "text") {
    return (
      <Field label={def.label} htmlFor={id}>
        <Input id={id} type={def.kind === "date" ? "date" : "text"} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />
      </Field>
    );
  }
  if (def.kind === "multi") {
    const selected = (value as string[]) ?? [];
    return (
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-ink-700">{def.label}</legend>
        <div className="flex flex-wrap gap-1.5">
          {def.options.map((o) => (
            <button
              key={o.value}
              type="button"
              aria-pressed={selected.includes(o.value)}
              onClick={() => onChange(selected.includes(o.value) ? selected.filter((v) => v !== o.value) : [...selected, o.value])}
              className={cn("rounded-full border px-2.5 py-1 text-xs", selected.includes(o.value) ? "border-ink-900 bg-ink-900 text-cream-50" : "border-line")}
            >
              {o.label}
            </button>
          ))}
        </div>
      </fieldset>
    );
  }
  return (
    <Field label={def.label} htmlFor={id}>
      <Select id={id} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">Any</option>
        {filterOptions(def, values).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </Field>
  );
}
