import type { Prisma } from "@prisma/client";
import {
  DEFAULT_SIZE_GUIDE,
  isBlankAttributeValue,
  type AttributeDataType,
  type ProductResolvedView,
  type ResolvedAttributeField,
  type ResolvedTypeConfig,
  type SizeGuideData,
  type SizeGuideMode,
  type SpecItemView,
  type VariantDimension,
} from "@clothing-brand/shared";

/** Everything needed to turn a ProductTypeDef into a ResolvedTypeConfig — see catalog.service.ts. */
export const TYPE_INCLUDE = {
  template: {
    include: {
      sizeGuidePreset: true,
      carePreset: true,
      attributes: {
        orderBy: { sortOrder: "asc" as const },
        include: {
          definition: { include: { options: { orderBy: { sortOrder: "asc" as const } } } },
          specGroup: true,
        },
      },
    },
  },
} satisfies Prisma.ProductTypeDefInclude;

export type TypeWithTemplate = Prisma.ProductTypeDefGetPayload<{ include: typeof TYPE_INCLUDE }>;

/** Grouping used for fields an admin left out of any spec group. */
export const DEFAULT_SPEC_GROUP_NAME = "Specifications";

export function presetToChart(preset: {
  name: string;
  unit: string | null;
  columns: unknown;
  rows: unknown;
  notes: string | null;
}): SizeGuideData {
  return {
    title: preset.name,
    unit: preset.unit ?? undefined,
    columns: preset.columns as string[],
    rows: preset.rows as string[][],
    ...(preset.notes ? { notes: preset.notes } : {}),
  };
}

export function toResolvedTypeConfig(type: TypeWithTemplate): ResolvedTypeConfig {
  const { template } = type;
  const fields: ResolvedAttributeField[] = template.attributes
    .filter((ta) => !ta.definition.isArchived)
    .map((ta) => ({
      definitionId: ta.definitionId,
      key: ta.definition.key,
      label: ta.definition.label,
      dataType: ta.definition.dataType as AttributeDataType,
      unit: ta.definition.unit,
      placeholder: ta.placeholder ?? ta.definition.placeholder,
      helpText: ta.definition.helpText,
      required: ta.required,
      options: ta.definition.options.map((o) => o.value),
      specGroupId: ta.specGroupId,
      specGroupName: ta.specGroup?.name ?? null,
      showOnStorefront: ta.showOnStorefront,
    }));

  return {
    typeId: type.id,
    key: type.key,
    name: type.name,
    description: type.description,
    isActive: type.isActive,
    legacyType: type.legacyType,
    templateId: template.id,
    templateName: template.name,
    variantDimensions: (template.variantDimensions as VariantDimension[] | null) ?? [],
    sizeGuide: {
      mode: template.sizeGuideMode as SizeGuideMode,
      presetId: template.sizeGuidePresetId,
      chart: template.sizeGuidePreset ? presetToChart(template.sizeGuidePreset) : null,
    },
    care: {
      presetId: template.carePresetId,
      name: template.carePreset?.name ?? null,
      steps: template.carePreset ? (template.carePreset.steps as string[]) : [],
    },
    requiredChecks: template.requiredChecks,
    fields,
  };
}

/* ───────────────────────── attribute value <-> storage ───────────────────────── */

export interface AttributeValueColumns {
  valueText: string | null;
  valueNumber: number | null;
  valueBoolean: boolean | null;
  valueDate: Date | null;
  valueJson: string[] | null;
}

const EMPTY_COLUMNS: AttributeValueColumns = { valueText: null, valueNumber: null, valueBoolean: null, valueDate: null, valueJson: null };

/** Maps an already-validated value onto the typed column for its data type (all others null). */
export function toStoredColumns(dataType: AttributeDataType, value: unknown): AttributeValueColumns {
  switch (dataType) {
    case "NUMBER":
    case "MEASUREMENT":
      return { ...EMPTY_COLUMNS, valueNumber: Number(value) };
    case "BOOLEAN":
      return { ...EMPTY_COLUMNS, valueBoolean: Boolean(value) };
    case "DATE":
      return { ...EMPTY_COLUMNS, valueDate: new Date(String(value)) };
    case "MULTI_SELECT":
      return { ...EMPTY_COLUMNS, valueJson: value as string[] };
    default:
      return { ...EMPTY_COLUMNS, valueText: String(value).trim() };
  }
}

export interface StoredAttributeRow {
  valueText: string | null;
  valueNumber: { toString(): string } | number | null;
  valueBoolean: boolean | null;
  valueDate: Date | null;
  valueJson: unknown;
}

/** Inverse of toStoredColumns — the value as the API serves it under `product.attributes[key]`. */
export function fromStoredRow(dataType: AttributeDataType, row: StoredAttributeRow): string | number | boolean | string[] | null {
  switch (dataType) {
    case "NUMBER":
    case "MEASUREMENT":
      return row.valueNumber === null ? null : Number(row.valueNumber.toString());
    case "BOOLEAN":
      return row.valueBoolean;
    case "DATE":
      return row.valueDate ? row.valueDate.toISOString().slice(0, 10) : null;
    case "MULTI_SELECT":
      return Array.isArray(row.valueJson) ? (row.valueJson as string[]) : null;
    default:
      return row.valueText;
  }
}

/* ───────────────────────── product view ───────────────────────── */

interface ProductForPresentation {
  attributes: unknown;
  attributeValues: (StoredAttributeRow & { definition: { key: string; dataType: string } })[];
}

/** `product.attributes` as clients see it: values for the type's defined fields, plus whatever legacy JSON
 * has no definition (the product's own sizeGuide, keys left from a previous type).
 *
 * For a defined field the typed row wins; the legacy JSON value is only a fallback for a product that has
 * no row yet (written by the seed script or a release that predates the rows). That is safe against stale
 * values resurfacing because saving through the API deletes a cleared field's row *and* rewrites the JSON
 * without any defined key. */
export function presentAttributes(product: ProductForPresentation, fields: ResolvedAttributeField[]): Record<string, unknown> {
  const legacy = product.attributes && typeof product.attributes === "object" && !Array.isArray(product.attributes) ? (product.attributes as Record<string, unknown>) : {};
  const fieldKeys = new Set(fields.map((f) => f.key));
  const rowByKey = new Map(product.attributeValues.map((r) => [r.definition.key, r]));
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(legacy)) {
    if (!fieldKeys.has(key)) result[key] = value;
  }
  for (const field of fields) {
    const row = rowByKey.get(field.key);
    const value = row ? fromStoredRow(field.dataType, row) : legacy[field.key];
    if (!isBlankAttributeValue(value)) result[field.key] = value;
  }
  return result;
}

export function buildSpecGroups(fields: ResolvedAttributeField[], attributes: Record<string, unknown>): ProductResolvedView["specGroups"] {
  const groups = new Map<string, SpecItemView[]>();
  for (const field of fields) {
    if (!field.showOnStorefront) continue;
    const value = attributes[field.key];
    if (isBlankAttributeValue(value)) continue;
    const name = field.specGroupName ?? DEFAULT_SPEC_GROUP_NAME;
    const items = groups.get(name) ?? [];
    items.push({ key: field.key, label: field.label, dataType: field.dataType, unit: field.unit, value: value as SpecItemView["value"] });
    groups.set(name, items);
  }
  // Groups appear in the order their first field appears in the template.
  return [...groups.entries()].map(([name, items]) => ({ name, items }));
}

/** Whether the product page offers a size guide, and which chart: the product's own saved guide wins;
 * otherwise the template's preset (or the generic chart when the template has none). */
export function buildSizeGuideView(
  config: Pick<ResolvedTypeConfig, "sizeGuide"> | null,
  attributes: Record<string, unknown>,
): ProductResolvedView["sizeGuide"] {
  if (!config || config.sizeGuide.mode === "NOT_APPLICABLE") return { show: false, chart: null };
  const saved = attributes.sizeGuide;
  if (saved && typeof saved === "object") {
    return { show: (saved as SizeGuideData).enabled === true, chart: saved as SizeGuideData };
  }
  return { show: config.sizeGuide.mode === "ON_BY_DEFAULT", chart: config.sizeGuide.chart ?? DEFAULT_SIZE_GUIDE };
}

/** What care steps to show, most specific first: the product's own list, its chosen preset, then the template's default. */
export function buildCareView(
  product: { careOverride: unknown; carePreset: { name: string; steps: unknown } | null },
  config: Pick<ResolvedTypeConfig, "care"> | null,
): ProductResolvedView["care"] {
  const own = Array.isArray(product.careOverride) ? (product.careOverride as string[]).filter(Boolean) : [];
  if (own.length) return { title: "Care", steps: own, source: "product" };
  const steps = product.carePreset ? (product.carePreset.steps as string[]) : [];
  if (product.carePreset && steps.length) return { title: product.carePreset.name, steps, source: "preset" };
  if (config && config.care.steps.length) return { title: config.care.name ?? "Care", steps: config.care.steps, source: "template" };
  return null;
}

export function buildResolvedView(
  config: ResolvedTypeConfig | null,
  attributes: Record<string, unknown>,
  extras: { care: ProductResolvedView["care"]; materials: ProductResolvedView["materials"] } = { care: null, materials: [] },
): ProductResolvedView {
  return {
    type: config ? { id: config.typeId, key: config.key, name: config.name } : null,
    variantDimensions: config?.variantDimensions ?? [],
    specGroups: config ? buildSpecGroups(config.fields, attributes) : [],
    sizeGuide: buildSizeGuideView(config, attributes),
    care: extras.care,
    materials: extras.materials,
  };
}
