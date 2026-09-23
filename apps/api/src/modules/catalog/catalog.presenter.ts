import type { Prisma } from "@prisma/client";
import {
  buildCareView,
  buildResolvedView,
  buildSizeGuideView,
  buildSpecGroups,
  DEFAULT_SPEC_GROUP_NAME,
  isBlankAttributeValue,
  type AttributeDataType,
  type ResolvedAttributeField,
  type ResolvedTypeConfig,
  type SizeGuideData,
  type SizeGuideMode,
  type VariantDimension,
} from "@clothing-brand/shared";

// Re-exported so existing local imports (this module's tests, product.service.ts) keep working — the
// implementations live in packages/shared (spec-groups.ts, resolved-view.ts) so the admin wizard's live
// preview resolves a draft with the very same rules instead of re-deriving them client-side.
export { buildCareView, buildResolvedView, buildSizeGuideView, buildSpecGroups, DEFAULT_SPEC_GROUP_NAME };

/** Everything needed to turn a ProductTypeDef into a ResolvedTypeConfig — see catalog.service.ts. */
export const TYPE_INCLUDE = {
  template: {
    include: {
      sizeGuidePreset: true,
      carePreset: true,
      sections: true,
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
    sectionOverrides: template.sections.map((r) => ({ sectionKey: r.sectionKey, enabled: r.enabled, sortOrder: r.sortOrder, title: r.title, content: r.content })),
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
