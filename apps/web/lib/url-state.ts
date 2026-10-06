import { z } from "zod";

/**
 * The admin URL-state grammar (P1.6) — one vocabulary for list/report/editor state in the query string, so a view can be
 * bookmarked, shared and restored, and every screen spells it the same way:
 *
 *   q     search text            page  1-based page        from / to  date range (YYYY-MM-DD)
 *   view  saved/system view id   size  page size           cmp        comparison period
 *   f.*   one filter per key     sort  `col` / `-col`      gran       granularity (day / week / month)
 *   tab   in-page tab            open  open drawer/record  step       editor step (Product Builder)
 *
 * Pure: parse and serialise against a schema of typed fields built from zod. A bad value in a link falls back to the
 * field's default instead of breaking the page; a value equal to its default is left out of the URL. Keys the schema
 * doesn't own are preserved untouched. The React binding is hooks/use-url-state.ts.
 */

export const URL_STATE_KEYS = ["q", "view", "sort", "page", "size", "tab", "from", "to", "cmp", "gran", "open", "step"] as const;
export type ReservedUrlKey = (typeof URL_STATE_KEYS)[number];
export type UrlStateKey = ReservedUrlKey | `f.${string}`;

export function isUrlStateKey(key: string): key is UrlStateKey {
  return (URL_STATE_KEYS as readonly string[]).includes(key) || /^f\.[a-zA-Z][\w-]*$/.test(key);
}

/** Changing any of these returns a paged list to its first page. */
const RESETS_PAGE = (key: string) => key === "q" || key === "view" || key === "sort" || key === "size" || key.startsWith("f.");

export interface UrlField<T> {
  readonly defaultValue: T;
  /** Raw query value (null when absent) → typed value; invalid → default. */
  parse(raw: string | null): T;
  /** Typed value → raw query value; null when it should be left out (it equals the default). */
  serialize(value: T): string | null;
}

function field<T>(schema: z.ZodType<T>, defaultValue: T, encode: (v: T) => string, decode: (raw: string) => unknown = (raw) => raw): UrlField<T> {
  const same = (a: T, b: T) => encode(a) === encode(b);
  return {
    defaultValue,
    parse(raw) {
      if (raw === null || raw === "") return defaultValue;
      const result = schema.safeParse(decode(raw));
      return result.success ? result.data : defaultValue;
    },
    serialize(value) {
      if (value === undefined || value === null || same(value, defaultValue)) return null;
      const raw = encode(value);
      return raw === "" ? null : raw;
    },
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Field builders for a URL-state schema. */
export const urlParam = {
  string: (defaultValue = "") => field(z.string().max(500), defaultValue, String),
  int: ({ defaultValue, min, max }: { defaultValue: number; min?: number; max?: number }) => {
    let schema = z.coerce.number().int();
    if (min !== undefined) schema = schema.min(min);
    if (max !== undefined) schema = schema.max(max);
    return field<number>(schema, defaultValue, String);
  },
  /** 1-based page number. */
  page: () => urlParam.int({ defaultValue: 1, min: 1 }),
  /** Page size limited to the sizes the screen offers. */
  size: (allowed: readonly number[], defaultValue: number) => field<number>(z.coerce.number().refine((n) => allowed.includes(n)), defaultValue, String),
  enum: <const V extends string>(values: readonly [V, ...V[]], defaultValue: V) => field<V>(z.enum(values as [V, ...V[]]), defaultValue, String),
  /** Optional single choice ("" = none). */
  optionalEnum: <const V extends string>(values: readonly [V, ...V[]]) =>
    field<V | "">(z.union([z.enum(values as [V, ...V[]]), z.literal("")]), "", String),
  /** Comma-separated multi-select; unknown items are dropped rather than discarding the whole list. */
  list: <const V extends string>(values: readonly V[]) => ({
    defaultValue: [] as V[],
    parse(raw: string | null): V[] {
      if (!raw) return [];
      return [...new Set(raw.split(",").map((v) => v.trim()))].filter((v): v is V => (values as readonly string[]).includes(v));
    },
    serialize(value: V[]): string | null {
      return value.length ? value.join(",") : null;
    },
  }) satisfies UrlField<V[]>,
  boolean: (defaultValue = false) => field<boolean>(z.boolean(), defaultValue, (v) => (v ? "1" : "0"), (raw) => raw === "1" || raw === "true" ? true : raw === "0" || raw === "false" ? false : raw),
  /** Calendar date YYYY-MM-DD ("" = none). */
  date: () => field<string>(z.union([z.string().regex(ISO_DATE), z.literal("")]), "", String),
  /** `sort=col` ascending, `sort=-col` descending, restricted to sortable columns. */
  sort: <const C extends string>(columns: readonly C[], defaultValue: { column: C; dir: "asc" | "desc" } | null = null) =>
    ({
      defaultValue,
      parse(raw: string | null) {
        if (!raw) return defaultValue;
        const dir: "asc" | "desc" = raw.startsWith("-") ? "desc" : "asc";
        const column = raw.replace(/^-/, "");
        return (columns as readonly string[]).includes(column) ? { column: column as C, dir } : defaultValue;
      },
      serialize(value: { column: C; dir: "asc" | "desc" } | null) {
        if (!value) return null;
        const raw = `${value.dir === "desc" ? "-" : ""}${value.column}`;
        const fallback = defaultValue ? `${defaultValue.dir === "desc" ? "-" : ""}${defaultValue.column}` : null;
        return raw === fallback ? null : raw;
      },
    }) satisfies UrlField<{ column: C; dir: "asc" | "desc" } | null>,
};

export type UrlSchema = { [K in UrlStateKey]?: UrlField<unknown> };
export type UrlValues<S extends UrlSchema> = { [K in keyof S]: S[K] extends UrlField<infer T> ? T : never };

/** Old query names still accepted on read (deep links that predate the grammar): `{ "f.queue": "queue" }`. */
export type UrlAliases<S extends UrlSchema> = Partial<Record<keyof S, string>>;

export function assertUrlSchema(schema: UrlSchema): void {
  for (const key of Object.keys(schema)) {
    if (!isUrlStateKey(key)) throw new Error(`[url-state] "${key}" is not part of the URL-state grammar (q, view, f.*, sort, page, size, tab, from, to, cmp, gran, open, step)`);
  }
}

export function parseUrlState<S extends UrlSchema>(schema: S, search: URLSearchParams, aliases: UrlAliases<S> = {}): UrlValues<S> {
  const out: Record<string, unknown> = {};
  for (const [key, f] of Object.entries(schema) as [string, UrlField<unknown>][]) {
    const alias = (aliases as Record<string, string | undefined>)[key];
    out[key] = f.parse(search.get(key) ?? (alias ? search.get(alias) : null));
  }
  return out as UrlValues<S>;
}

/**
 * The next query string for a change: the patched keys written (defaults removed), paging reset when a filter-like key
 * changed (unless the patch sets `page` itself), read-only aliases dropped, every unrelated key kept.
 */
export function nextSearch<S extends UrlSchema>(schema: S, current: URLSearchParams, patch: Partial<UrlValues<S>>, aliases: UrlAliases<S> = {}): URLSearchParams {
  const next = new URLSearchParams(current);
  const values = parseUrlState(schema, current, aliases);
  const changed = Object.keys(patch).filter((k) => (schema as Record<string, UrlField<unknown>>)[k] && JSON.stringify((patch as Record<string, unknown>)[k]) !== JSON.stringify((values as Record<string, unknown>)[k]));
  const merged = { ...values, ...patch } as Record<string, unknown>;
  if ("page" in schema && !("page" in patch) && changed.some(RESETS_PAGE)) merged.page = schema.page!.defaultValue;
  for (const [key, f] of Object.entries(schema) as [string, UrlField<unknown>][]) {
    const alias = (aliases as Record<string, string | undefined>)[key];
    if (alias) next.delete(alias);
    const raw = f.serialize(merged[key]);
    if (raw === null) next.delete(key);
    else next.set(key, raw);
  }
  return next;
}
