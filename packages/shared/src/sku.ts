import { z } from "zod";

/** Tokens a SKU pattern may contain. `{SEQ:n}` zero-pads the counter to n digits (1–6). */
export const SKU_TOKEN_HELP = [
  { token: "{PREFIX}", meaning: "The store prefix set below (e.g. AZ)" },
  { token: "{TYPE}", meaning: "The product type's SKU code (e.g. PNJ)" },
  { token: "{COLOR}", meaning: "First three letters of the colour (Black → BLA)" },
  { token: "{SIZE}", meaning: "The size or volume as typed (M, 42, 50ML)" },
  { token: "{SEQ:3}", meaning: "A counter per product type, padded to 3 digits (001, 002 …)" },
] as const;

const TOKEN_RE = /\{(PREFIX|TYPE|COLOR|SIZE|SEQ(?::([1-6]))?)\}/g;

/** Letters and digits only, upper-cased — SKUs end up on labels and in URLs and must be safe in both. */
export function sanitizeSkuPart(value: string | null | undefined): string {
  return (value ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

/** "Black" → "BLA", "Off White" → "OFF", "" → "". */
export function abbreviateForSku(value: string | null | undefined, length = 3): string {
  return sanitizeSkuPart(value).slice(0, length);
}

export function validateSkuPattern(pattern: string): string | null {
  if (pattern.length > 80) return "Pattern is too long (80 characters max)";
  // Whatever is left after removing valid tokens must be literal safe characters.
  const literal = pattern.replace(TOKEN_RE, "");
  if (/[{}]/.test(literal)) return "Unknown or malformed token — use {PREFIX} {TYPE} {COLOR} {SIZE} {SEQ:3}";
  if (!/^[A-Za-z0-9\-_.]*$/.test(literal)) return "Outside the tokens, use only letters, digits, - _ and .";
  if (!/\{SEQ(:[1-6])?\}/.test(pattern)) return "Include {SEQ} so every SKU is unique";
  return null;
}

export const skuSettingsSchema = z.object({
  skuPrefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,8}$/, "1–8 letters or digits"),
  skuPattern: z.string().trim().refine((p) => validateSkuPattern(p) === null, (p) => ({ message: validateSkuPattern(p) ?? "Invalid pattern" })),
});
export type SkuSettingsInput = z.infer<typeof skuSettingsSchema>;

export const skuCodeSchema = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().toUpperCase() || null : v),
  z.string().regex(/^[A-Z0-9]{2,6}$/, "2–6 letters or digits").nullable().optional(),
);

export interface SkuContext {
  prefix: string;
  typeCode: string;
  color?: string | null;
  size?: string | null;
  seq: number;
}

/** Renders a validated pattern. Empty parts (a product with no colour) collapse, so "AZ-PNJ--M-001" never happens. */
export function renderSkuPattern(pattern: string, ctx: SkuContext): string {
  const rendered = pattern.replace(TOKEN_RE, (_m, name: string, digits?: string) => {
    if (name === "PREFIX") return sanitizeSkuPart(ctx.prefix);
    if (name === "TYPE") return sanitizeSkuPart(ctx.typeCode);
    if (name === "COLOR") return abbreviateForSku(ctx.color);
    if (name === "SIZE") return sanitizeSkuPart(ctx.size);
    return String(ctx.seq).padStart(Number(digits ?? 1), "0");
  });
  return rendered.replace(/([-_.])[-_.]+/g, "$1").replace(/^[-_.]+|[-_.]+$/g, "");
}

/** The type code used when a type has no explicit one: its name's first letters ("Panjabi" → "PAN"). */
export const defaultTypeCode = (name: string) => abbreviateForSku(name) || "GEN";
