import { z } from "zod";
import { blankToNull, nullableString, slugSchema } from "./common";
import { skuCodeSchema } from "../sku";
import { sectionLayerSchema, type PublicSection } from "../sections";
import type { SizeGuideData } from "../config/product-types";
import { OPTIONAL_COMPLETENESS_KEYS } from "../completeness-checks";

/* ───────────────────────── enums ───────────────────────── */

export const ATTRIBUTE_DATA_TYPES = [
  "TEXT",
  "TEXTAREA",
  "NUMBER",
  "MEASUREMENT",
  "BOOLEAN",
  "SELECT",
  "MULTI_SELECT",
  "DATE",
  "URL",
  "RICH_TEXT",
] as const;
export const attributeDataTypeEnum = z.enum(ATTRIBUTE_DATA_TYPES);
export type AttributeDataType = z.infer<typeof attributeDataTypeEnum>;

export const ATTRIBUTE_DATA_TYPE_LABELS: Record<AttributeDataType, string> = {
  TEXT: "Text (one line)",
  TEXTAREA: "Text (multi-line)",
  NUMBER: "Number",
  MEASUREMENT: "Measurement (number + unit)",
  BOOLEAN: "Yes / No",
  SELECT: "Select (one option)",
  MULTI_SELECT: "Multi-select",
  DATE: "Date",
  URL: "Link (URL)",
  RICH_TEXT: "Rich text",
};

export const sizeGuideModeEnum = z.enum(["NOT_APPLICABLE", "OFF_BY_DEFAULT", "ON_BY_DEFAULT"]);
export type SizeGuideMode = z.infer<typeof sizeGuideModeEnum>;

const OPTION_TYPES: ReadonlySet<AttributeDataType> = new Set(["SELECT", "MULTI_SELECT"]);
export const attributeTypeHasOptions = (t: AttributeDataType) => OPTION_TYPES.has(t);
const UNIT_TYPES: ReadonlySet<AttributeDataType> = new Set(["NUMBER", "MEASUREMENT"]);
export const attributeTypeHasUnit = (t: AttributeDataType) => UNIT_TYPES.has(t);

/* ───────────────────────── admin input schemas ───────────────────────── */

/** camelCase, because the key is also the property name under `product.attributes`. */
export const attributeKeySchema = z
  .string()
  .min(2)
  .max(40)
  .regex(/^[a-z][a-zA-Z0-9]*$/, "Use letters and digits only, starting with a lowercase letter (e.g. embroideryType)");

const RESERVED_ATTRIBUTE_KEYS = new Set(["sizeGuide", "__proto__", "constructor", "prototype"]);

const optionsSchema = z
  .array(z.string().trim().min(1).max(80))
  .max(100)
  .refine((opts) => new Set(opts.map((o) => o.toLowerCase())).size === opts.length, "Options must be unique");

const attributeDefinitionBase = z.object({
  label: z.string().trim().min(1).max(80),
  unit: nullableString(20),
  placeholder: nullableString(120),
  helpText: nullableString(300),
  options: optionsSchema.default([]),
});

export const createAttributeDefinitionSchema = attributeDefinitionBase
  .extend({
    key: attributeKeySchema.refine((k) => !RESERVED_ATTRIBUTE_KEYS.has(k), "That key is reserved"),
    dataType: attributeDataTypeEnum,
  })
  .superRefine((data, ctx) => {
    if (attributeTypeHasOptions(data.dataType) && data.options.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Add at least one option", path: ["options"] });
    }
  });

/** `key` and `dataType` are immutable: stored values are keyed and typed by them. */
export const updateAttributeDefinitionSchema = attributeDefinitionBase.partial().extend({ isArchived: z.boolean().optional() });

export const specGroupSchema = z.object({
  name: z.string().trim().min(1).max(80),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});

export const sizeGuideTableSchema = z
  .object({
    columns: z.array(z.string().trim().min(1).max(40)).min(1, "Add at least one column").max(12),
    rows: z.array(z.array(z.string().max(60))).min(1, "Add at least one row").max(80),
  })
  .superRefine((data, ctx) => {
    data.rows.forEach((row, i) => {
      if (row.length !== data.columns.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Row ${i + 1} must have ${data.columns.length} cells`, path: ["rows", i] });
      }
    });
  });

export const sizeGuidePresetSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: nullableString(300),
    unit: nullableString(40),
    notes: nullableString(500),
  })
  .and(sizeGuideTableSchema);

export const variantDimensionSchema = z.object({
  targetField: z.enum(["size", "color"]),
  label: z.string().trim().min(1).max(40),
  options: z.array(z.string().trim().min(1).max(48)).max(60).default([]),
});
export type VariantDimension = z.infer<typeof variantDimensionSchema>;

export const templateAttributeInputSchema = z.object({
  definitionId: z.string().min(1),
  required: z.boolean().default(false),
  specGroupId: z.preprocess(blankToNull, z.string().min(1).nullable().optional()),
  placeholder: nullableString(120),
  showOnStorefront: z.boolean().default(true),
});

export const templateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: nullableString(300),
  variantDimensions: z
    .array(variantDimensionSchema)
    .max(2, "A template supports at most two variant dimensions")
    .refine((dims) => new Set(dims.map((d) => d.targetField)).size === dims.length, "Size and colour can each be used once")
    .default([]),
  sizeGuideMode: sizeGuideModeEnum.default("NOT_APPLICABLE"),
  sizeGuidePresetId: z.preprocess(blankToNull, z.string().min(1).nullable().optional()),
  carePresetId: z.preprocess(blankToNull, z.string().min(1).nullable().optional()),
  /** Publish requirements beyond the always-required basics. */
  requiredChecks: z
    .array(z.enum(OPTIONAL_COMPLETENESS_KEYS as [string, ...string[]]))
    .max(20)
    .refine((k) => new Set(k).size === k.length, "Duplicate checks")
    .default([]),
  /** Page-section overrides for every product of this template. Sent whole; omit to leave them alone. */
  sections: sectionLayerSchema.optional(),
  /** Order in the array is the display order. */
  attributes: z
    .array(templateAttributeInputSchema)
    .max(80)
    .refine((a) => new Set(a.map((x) => x.definitionId)).size === a.length, "An attribute can only be added once")
    .default([]),
  isArchived: z.boolean().optional(),
});

export const careGuidePresetSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: nullableString(300),
  /** One care instruction per entry, in display order. */
  steps: z.array(z.string().trim().min(1).max(300)).min(1, "Add at least one care step").max(30),
});

export const materialSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: nullableString(300),
});

export const productTypeSchema = z.object({
  name: z.string().trim().min(1).max(80),
  key: z.preprocess((v) => (v === "" ? undefined : v), slugSchema.optional()),
  description: nullableString(300),
  parentId: z.preprocess(blankToNull, z.string().min(1).nullable().optional()),
  templateId: z.string().min(1),
  /** Short code for the SKU generator's {TYPE} token; blank falls back to the name's first letters. */
  skuCode: skuCodeSchema,
  sortOrder: z.number().int().min(0).max(1000).default(0),
  isActive: z.boolean().default(true),
});
export const updateProductTypeSchema = productTypeSchema.omit({ key: true }).partial();

export type CreateAttributeDefinitionInput = z.infer<typeof createAttributeDefinitionSchema>;
export type UpdateAttributeDefinitionInput = z.infer<typeof updateAttributeDefinitionSchema>;
export type SpecGroupInput = z.infer<typeof specGroupSchema>;
export type SizeGuidePresetInput = z.infer<typeof sizeGuidePresetSchema>;
export type TemplateInput = z.infer<typeof templateSchema>;
export type ProductTypeInput = z.infer<typeof productTypeSchema>;
export type CareGuidePresetInput = z.infer<typeof careGuidePresetSchema>;
export type MaterialInput = z.infer<typeof materialSchema>;
export type UpdateProductTypeInput = z.infer<typeof updateProductTypeSchema>;

/* ───────────────────────── API shapes ───────────────────────── */

/** One field a product of this type collects — a template attribute joined with its definition. */
export interface ResolvedAttributeField {
  definitionId: string;
  key: string;
  label: string;
  dataType: AttributeDataType;
  unit: string | null;
  placeholder: string | null;
  helpText: string | null;
  required: boolean;
  options: string[];
  specGroupId: string | null;
  specGroupName: string | null;
  showOnStorefront: boolean;
}

/** Everything the product editor needs to know about a type, resolved through its template. */
export interface ResolvedTypeConfig {
  typeId: string;
  key: string;
  name: string;
  description: string | null;
  isActive: boolean;
  legacyType: string;
  templateId: string;
  templateName: string;
  variantDimensions: VariantDimension[];
  sizeGuide: { mode: SizeGuideMode; presetId: string | null; chart: SizeGuideData | null };
  /** The template's default care guide (a product can pick another or write its own). */
  care: { presetId: string | null; name: string | null; steps: string[] };
  requiredChecks: string[];
  /** The template's own page-section overrides (the middle layer of product → template → store). */
  sectionOverrides: { sectionKey: string; enabled?: boolean | null; sortOrder?: number | null; title?: string | null; content?: string | null }[];
  fields: ResolvedAttributeField[];
}

export interface SpecItemView {
  key: string;
  label: string;
  dataType: AttributeDataType;
  unit: string | null;
  value: string | number | boolean | string[];
}

/** What the storefront renders for a product, resolved server-side from the type's template. */
export interface ProductResolvedView {
  type: { id: string; key: string; name: string } | null;
  variantDimensions: VariantDimension[];
  specGroups: { name: string; items: SpecItemView[] }[];
  sizeGuide: { show: boolean; chart: SizeGuideData | null };
  /** Care steps to show: the product's own list, else its preset, else the template's default preset. */
  care: { title: string; steps: string[]; source: "product" | "preset" | "template" } | null;
  materials: { name: string; percentage: number | null }[];
  /** The enabled page sections in display order, resolved product → template → global → default. */
  sections: PublicSection[];
  faqs: { question: string; answer: string }[];
}

/* ───────────────────────── value handling ───────────────────────── */

export function isBlankAttributeValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

const MAX_LENGTH: Partial<Record<AttributeDataType, number>> = { TEXT: 500, TEXTAREA: 5000, RICH_TEXT: 20_000, URL: 2000 };

/** Error message for a value that doesn't fit its field, or null when it does. Blank values are fine
 * here — whether a blank is allowed is the `required` flag's job. */
export function validateAttributeValue(
  field: Pick<ResolvedAttributeField, "label" | "dataType" | "options">,
  value: unknown,
): string | null {
  if (isBlankAttributeValue(value)) return null;
  const { label, dataType, options } = field;
  const max = MAX_LENGTH[dataType];

  switch (dataType) {
    case "TEXT":
    case "TEXTAREA":
    case "RICH_TEXT":
      if (typeof value !== "string") return `${label} must be text`;
      return max !== undefined && value.length > max ? `${label} must be at most ${max} characters` : null;
    case "URL":
      // Regex rather than `new URL()`: this package is compiled without DOM/Node lib types, and only
      // http(s) links are ever wanted here (they're rendered as anchors on the storefront).
      return typeof value === "string" && value.length <= (max ?? 2000) && /^https?:\/\/[^\s/$.?#][^\s]*$/i.test(value)
        ? null
        : `${label} must be a valid http(s) link`;
    case "NUMBER":
    case "MEASUREMENT": {
      const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
      return Number.isFinite(n) && Math.abs(n) < 1e9 ? null : `${label} must be a number`;
    }
    case "BOOLEAN":
      return typeof value === "boolean" ? null : `${label} must be yes or no`;
    case "DATE":
      return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) && !Number.isNaN(Date.parse(value))
        ? null
        : `${label} must be a valid date`;
    case "SELECT":
      return typeof value === "string" && options.includes(value) ? null : `${label} must be one of the listed options`;
    case "MULTI_SELECT":
      return Array.isArray(value) && value.every((v) => typeof v === "string" && options.includes(v))
        ? null
        : `${label} must only contain listed options`;
  }
}

export interface ProductValidationIssue {
  path: (string | number)[];
  message: string;
}

/** The per-type rules that used to live in the product zod schema (they needed the hard-coded type
 * config). Pure, so the API runs it with a config loaded from the database and the admin form runs the
 * same function with the config it fetched — one definition of "valid for this type". */
export function validateProductAgainstConfig(
  input: {
    attributes?: Record<string, unknown> | null;
    variants?: { size?: string | null; color?: string | null }[];
  },
  config: Pick<ResolvedTypeConfig, "fields" | "variantDimensions" | "sizeGuide">,
): ProductValidationIssue[] {
  const issues: ProductValidationIssue[] = [];
  const attrs = input.attributes ?? {};

  for (const field of config.fields) {
    const value = attrs[field.key];
    if (field.required && isBlankAttributeValue(value)) {
      issues.push({ path: ["attributes", field.key], message: `${field.label} is required` });
      continue;
    }
    const message = validateAttributeValue(field, value);
    if (message) issues.push({ path: ["attributes", field.key], message });
  }

  // A saved guide only matters — and is only validated — for types that show one: switching a product to
  // a type without a size guide leaves the old table behind, and it must not block saving.
  const sizeGuide = attrs.sizeGuide as Partial<SizeGuideData> | undefined;
  if (config.sizeGuide.mode !== "NOT_APPLICABLE" && sizeGuide && typeof sizeGuide === "object" && sizeGuide.enabled === true) {
    const parsed = sizeGuideTableSchema.safeParse({ columns: sizeGuide.columns, rows: sizeGuide.rows });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        issues.push({ path: ["attributes", "sizeGuide", ...issue.path], message: issue.message });
      }
    }
  }

  const sizeDim = config.variantDimensions.find((d) => d.targetField === "size");
  const colorDim = config.variantDimensions.find((d) => d.targetField === "color");
  input.variants?.forEach((v, idx) => {
    if (sizeDim && (!v.size || v.size.trim() === "")) {
      issues.push({ path: ["variants", idx, "size"], message: `${sizeDim.label} is required` });
    }
    if (colorDim && (!v.color || v.color.trim() === "")) {
      issues.push({ path: ["variants", idx, "color"], message: `${colorDim.label} is required` });
    }
  });

  return issues;
}
