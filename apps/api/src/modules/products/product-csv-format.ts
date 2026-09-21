import { validateAttributeValue, type AttributeDataType } from "@clothing-brand/shared";

/** Turning spreadsheet cells into typed values and back. Pure, so every rule is unit-tested without a database. */

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };
const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const bad = (message: string): Parsed<never> => ({ ok: false, message });

/** Plain decimal numbers only. "1,200" is refused rather than guessed at — in some locales that comma is a decimal point. */
export function parseDecimal(raw: string, opts: { min?: number; max?: number } = {}): Parsed<number> {
  const text = raw.trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) return bad(`"${raw.trim()}" is not a number (use digits and an optional decimal point, e.g. 1250 or 1250.50)`);
  const n = Number(text);
  if (opts.min !== undefined && n < opts.min) return bad(`must be at least ${opts.min}`);
  if (opts.max !== undefined && n > opts.max) return bad(`must be at most ${opts.max}`);
  return ok(n);
}

export function parseInteger(raw: string, opts: { min?: number; max?: number } = {}): Parsed<number> {
  const n = parseDecimal(raw, opts);
  if (!n.ok) return n;
  return Number.isInteger(n.value) ? n : bad(`"${raw.trim()}" must be a whole number`);
}

const TRUE_WORDS = new Set(["yes", "y", "true", "1"]);
const FALSE_WORDS = new Set(["no", "n", "false", "0"]);
export function parseBoolean(raw: string): Parsed<boolean> {
  const text = raw.trim().toLowerCase();
  if (TRUE_WORDS.has(text)) return ok(true);
  if (FALSE_WORDS.has(text)) return ok(false);
  return bad(`"${raw.trim()}" must be yes or no`);
}

export const formatBoolean = (v: boolean) => (v ? "yes" : "no");

const matchOption = (options: string[], raw: string) => options.find((o) => o.toLowerCase() === raw.trim().toLowerCase());

/** One `attr:<key>` cell → the typed value the product form would have produced. Also runs the shared per-field validation,
 * so the import can't store anything the editor would have refused. */
export function parseAttributeCell(field: { label: string; dataType: AttributeDataType; options: string[] }, raw: string): Parsed<unknown> {
  const { dataType, label, options } = field;
  let value: unknown;
  switch (dataType) {
    case "TEXT":
    case "URL":
      value = raw.trim();
      break;
    case "TEXTAREA":
    case "RICH_TEXT":
      value = raw.trim();
      break;
    case "NUMBER":
    case "MEASUREMENT": {
      const n = parseDecimal(raw);
      if (!n.ok) return bad(`${label}: ${n.message}`);
      value = n.value;
      break;
    }
    case "BOOLEAN": {
      const b = parseBoolean(raw);
      if (!b.ok) return bad(`${label}: ${b.message}`);
      value = b.value;
      break;
    }
    case "DATE": {
      const text = raw.trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(text))) return bad(`${label}: "${text}" must be a date written YYYY-MM-DD`);
      value = text;
      break;
    }
    case "SELECT": {
      const hit = matchOption(options, raw);
      if (!hit) return bad(`${label}: "${raw.trim()}" isn't one of the options (${options.join(", ")})`);
      value = hit;
      break;
    }
    case "MULTI_SELECT": {
      const picked: string[] = [];
      for (const part of raw.split("|").map((p) => p.trim()).filter(Boolean)) {
        const hit = matchOption(options, part);
        if (!hit) return bad(`${label}: "${part}" isn't one of the options (${options.join(", ")})`);
        if (!picked.includes(hit)) picked.push(hit);
      }
      value = picked;
      break;
    }
  }
  const message = validateAttributeValue(field, value);
  return message ? bad(message) : ok(value);
}

/** A stored attribute value → its cell text (the inverse of parseAttributeCell). */
export function formatAttributeCell(dataType: AttributeDataType, value: unknown): string {
  if (value === null || value === undefined) return "";
  if (dataType === "BOOLEAN") return formatBoolean(Boolean(value));
  if (dataType === "MULTI_SELECT") return Array.isArray(value) ? value.join("|") : String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (dataType === "DATE") return String(value).slice(0, 10);
  return String(value);
}

/* ───────────────────────── materials ───────────────────────── */

export interface MaterialRef {
  id: string;
  name: string;
  isArchived: boolean;
}

export interface ParsedMaterialLine {
  materialId?: string;
  customName?: string;
  percentage?: number | null;
}

/** "Cotton:80|Polyester:20" (a trailing % is fine; the percentage is optional). A name that matches a catalog material
 * (case-insensitively) uses it; anything else is kept as the product's own text, with a warning. */
export function parseMaterialsCell(raw: string, catalog: Map<string, MaterialRef>): { lines: ParsedMaterialLine[]; warnings: string[]; error: string | null } {
  const lines: ParsedMaterialLine[] = [];
  const warnings: string[] = [];
  for (const token of raw.split("|").map((t) => t.trim()).filter(Boolean)) {
    const match = /^(.*?)(?::\s*(\d+(?:\.\d+)?)\s*%?)?$/.exec(token);
    const name = (match?.[1] ?? token).trim();
    if (!name) return { lines: [], warnings, error: `"${token}" has no material name` };
    let percentage: number | null = null;
    if (match?.[2] !== undefined) {
      const pct = parseDecimal(match[2], { min: 0.001, max: 100 });
      if (!pct.ok) return { lines: [], warnings, error: `${name}: percentage ${pct.message}` };
      percentage = pct.value;
    }
    const hit = catalog.get(name.toLowerCase());
    if (hit && !hit.isArchived) lines.push({ materialId: hit.id, percentage });
    else {
      warnings.push(hit ? `Material "${name}" is archived, so it is saved as plain text` : `Material "${name}" isn't in the catalog, so it is saved as plain text`);
      lines.push({ customName: name, percentage });
    }
  }
  const total = lines.reduce((sum, l) => sum + (l.percentage ?? 0), 0);
  if (total > 100.005) return { lines: [], warnings, error: `the percentages add up to ${Math.round(total * 100) / 100}%, which is more than 100%` };
  return { lines, warnings, error: null };
}

export function formatMaterialsCell(lines: { name: string; percentage: number | null }[]): string {
  return lines.map((l) => (l.percentage === null ? l.name : `${l.name}:${l.percentage}`)).join("|");
}
