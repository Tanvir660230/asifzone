import { urlParam, type UrlField } from "@/lib/url-state";

/**
 * Filter definitions (P1.8) — a list screen declares its filters ONCE: key (in the URL-state grammar), label, kind and
 * options. The URL-state schema, the FilterBar's controls, the active-filter chips and "clear all" are all derived from
 * the definitions, so no page hand-writes filter parsing, chip wording or reset logic.
 *
 * Keys are `f.<name>` (or the shared `from` / `to` date range). Persistence is the URL (hooks/use-url-state.ts).
 */

export interface FilterOption {
  value: string;
  label: string;
}

interface FilterBase {
  key: `f.${string}` | "from" | "to";
  label: string;
  /** Chip text for one active value (default "Label: Option"). */
  chip?: (optionLabel: string, value: string) => string;
  /** Clearing / changing this filter's parent clears it too (district under division). */
  dependsOn?: FilterDefinition["key"];
  /** Where the FilterBar renders it: always-visible quick chips, or the "More filters" popover (default). */
  placement?: "quick" | "more";
}

export type FilterDefinition =
  | (FilterBase & { kind: "select"; options: readonly FilterOption[] | ((values: FilterValues) => readonly FilterOption[]) })
  | (FilterBase & { kind: "multi"; options: readonly FilterOption[] })
  | (FilterBase & { kind: "boolean"; trueLabel: string; falseLabel: string })
  | (FilterBase & { kind: "date" })
  | (FilterBase & { kind: "text" });

export type FilterValues = Record<string, string | string[]>;

function staticOptions(def: FilterDefinition, values: FilterValues = {}): readonly FilterOption[] {
  if (def.kind === "select") return typeof def.options === "function" ? def.options(values) : def.options;
  if (def.kind === "multi") return def.options;
  if (def.kind === "boolean") return [
    { value: "true", label: def.trueLabel },
    { value: "false", label: def.falseLabel },
  ];
  return [];
}

/** The URL field for a definition. A dependent select validates against every option it could ever offer. */
export function filterField(def: FilterDefinition): UrlField<string> | UrlField<string[]> {
  switch (def.kind) {
    case "multi":
      return urlParam.list(def.options.map((o) => o.value));
    case "select":
    case "boolean": {
      // Dynamic option lists are validated loosely (any short string): their full set depends on other filters.
      if (def.kind === "select" && typeof def.options === "function") return urlParam.string();
      const values = staticOptions(def).map((o) => o.value) as [string, ...string[]];
      return urlParam.optionalEnum(values);
    }
    case "date":
      return urlParam.date();
    case "text":
      return urlParam.string();
  }
}

/** The URL-state schema for a set of filter definitions — spread into a screen's useUrlState schema. */
export function filterSchema(defs: readonly FilterDefinition[]): Record<string, UrlField<string> | UrlField<string[]>> {
  return Object.fromEntries(defs.map((d) => [d.key, filterField(d)]));
}

export interface ActiveFilterChip {
  /** Stable React key. */
  id: string;
  label: string;
  filterKey: FilterDefinition["key"];
  /** The value this chip removes (one item of a multi filter). */
  value: string;
}

export function optionLabel(def: FilterDefinition, value: string, values: FilterValues = {}): string {
  return staticOptions(def, values).find((o) => o.value === value)?.label ?? value;
}

/** One chip per active value, in definition order. */
export function activeFilterChips(defs: readonly FilterDefinition[], values: FilterValues): ActiveFilterChip[] {
  return defs.flatMap((def) => {
    const raw = values[def.key];
    const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return items.map((value) => {
      const text = optionLabel(def, value, values);
      return { id: `${def.key}:${value}`, filterKey: def.key, value, label: def.chip ? def.chip(text, value) : `${def.label}: ${text}` };
    });
  });
}

/** The patch that removes one chip — and clears filters that depend on it. */
export function removeChipPatch(defs: readonly FilterDefinition[], values: FilterValues, chip: ActiveFilterChip): FilterValues {
  const def = defs.find((d) => d.key === chip.filterKey);
  if (!def) return {};
  const current = values[def.key];
  const patch: FilterValues = { [def.key]: Array.isArray(current) ? current.filter((v) => v !== chip.value) : "" };
  return { ...patch, ...dependentsCleared(defs, def.key) };
}

/** The patch that changes one filter — clearing filters that depend on it. */
export function setFilterPatch(defs: readonly FilterDefinition[], key: FilterDefinition["key"], value: string | string[]): FilterValues {
  return { [key]: value, ...dependentsCleared(defs, key) };
}

function dependentsCleared(defs: readonly FilterDefinition[], key: string): FilterValues {
  const out: FilterValues = {};
  for (const d of defs) if (d.dependsOn === key) Object.assign(out, { [d.key]: d.kind === "multi" ? [] : "" }, dependentsCleared(defs, d.key));
  return out;
}

/** The patch that clears every filter in the set. */
export function clearFiltersPatch(defs: readonly FilterDefinition[]): FilterValues {
  return Object.fromEntries(defs.map((d) => [d.key, d.kind === "multi" ? [] : ""]));
}

export function filterOptions(def: FilterDefinition, values: FilterValues): readonly FilterOption[] {
  return staticOptions(def, values);
}
