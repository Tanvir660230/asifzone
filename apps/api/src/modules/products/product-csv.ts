import { randomUUID } from "node:crypto";
import {
  NO_SIZE_VALUE,
  PRODUCT_IMPORT_LIMITS,
  brandTierEnum,
  createProductSchema,
  slugify,
  updateProductSchema,
  validateProductAgainstConfig,
  type CreateProductInput,
  type ProductImportIssue,
  type ProductImportItem,
  type ProductImportReport,
  type ProductImportResult,
  type ResolvedTypeConfig,
  type UpdateProductInput,
} from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { recordAudit } from "../../lib/audit";
import { CsvParseError, parseCsv, toCsv, unguardCell, type CsvRecord } from "../../lib/csv";
import { getTypeWithTemplate } from "../catalog/catalog.service";
import { fromStoredRow, toResolvedTypeConfig, type TypeWithTemplate } from "../catalog/catalog.presenter";
import { generateSku } from "../catalog/sku.service";
import {
  formatAttributeCell,
  formatBoolean,
  formatMaterialsCell,
  parseAttributeCell,
  parseBoolean,
  parseDecimal,
  parseInteger,
  parseMaterialsCell,
  type MaterialRef,
} from "./product-csv-format";
import { createProduct, getProductById, updateProduct } from "./product.service";

/* ───────────────────────── the format ─────────────────────────
 * One row per variant. A product's own columns are written on its first row and left blank on the rest (on import they may be
 * on any row of the product, as long as they don't disagree). `slug` is on every row: it is what ties rows into a product and
 * matches an existing one. `attr:<key>` columns carry the product type's attributes. Images can't travel in a CSV and are not
 * part of it; `status` is informational (an import never publishes anything).
 */

export const PRODUCT_COLUMNS = [
  "slug", "name", "status", "category", "product_type", "brand", "brand_tier", "short_description", "description",
  "base_price", "compare_at_price", "cost_price", "tax_rate", "track_inventory", "low_stock_threshold", "is_featured",
  "seo_title", "seo_description", "focus_keyword", "materials", "care_guide", "care_steps",
] as const;
export const VARIANT_COLUMNS = [
  "variant_sku", "variant_barcode", "variant_size", "variant_color", "variant_color_hex", "variant_price",
  "variant_compare_at_price", "variant_cost_price", "variant_stock", "variant_weight", "variant_active",
] as const;
const KNOWN = new Set<string>([...PRODUCT_COLUMNS, ...VARIANT_COLUMNS]);
const ALIASES: Record<string, string> = { sku: "variant_sku", barcode: "variant_barcode", size: "variant_size", color: "variant_color", colour: "variant_color", stock: "variant_stock" };

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(String(v)));

/* ───────────────────────── export ───────────────────────── */

const EXPORT_INCLUDE = {
  category: { select: { slug: true } },
  type: { select: { key: true } },
  variants: { orderBy: { sortOrder: "asc" as const } },
  attributeValues: { include: { definition: { select: { key: true, dataType: true } } } },
  materials: { include: { material: { select: { name: true } } }, orderBy: { sortOrder: "asc" as const } },
  carePreset: { select: { name: true } },
};

/** Every non-deleted product (or one type's) in the importable format. Text cells that start like a spreadsheet formula are
 * defused by the CSV writer, and the import undoes that, so exporting and re-importing changes nothing. */
export async function exportProductsFullCsv(typeId?: string): Promise<string> {
  const products = await prisma.product.findMany({ where: { deletedAt: null, ...(typeId ? { typeId } : {}) }, orderBy: { createdAt: "asc" }, include: EXPORT_INCLUDE });

  const attributeKeys: string[] = [];
  if (typeId) {
    const type = await getTypeWithTemplate(typeId).catch(() => null);
    if (type) for (const f of toResolvedTypeConfig(type).fields) attributeKeys.push(f.key);
  }
  for (const p of products) for (const v of p.attributeValues) if (!attributeKeys.includes(v.definition.key)) attributeKeys.push(v.definition.key);

  const header = [...PRODUCT_COLUMNS, ...VARIANT_COLUMNS, ...attributeKeys.map((k) => `attr:${k}`)];
  const rows: unknown[][] = [];
  for (const p of products) {
    const attrs = new Map(p.attributeValues.map((v) => [v.definition.key, formatAttributeCell(v.definition.dataType as never, fromStoredRow(v.definition.dataType as never, v))]));
    const materials = formatMaterialsCell(p.materials.map((m) => ({ name: m.material?.name ?? m.customName ?? "", percentage: m.percentage === null ? null : Number(m.percentage.toString()) })));
    const careSteps = Array.isArray(p.careOverride) ? (p.careOverride as string[]).join("|") : "";
    p.variants.forEach((v, i) => {
      const first = i === 0;
      const own = (value: unknown) => (first ? value : "");
      rows.push([
        p.slug, own(p.name), own(p.status), own(p.category.slug), own(p.type?.key ?? p.productType), own(p.brand), own(p.brandTier), own(p.shortDescription), own(p.description),
        own(num(p.basePrice)), own(num(p.compareAtPrice)), own(num(p.costPrice)), own(num(p.taxRate)), own(formatBoolean(p.trackInventory)), own(p.lowStockThreshold), own(formatBoolean(p.isFeatured)),
        own(p.seoTitle), own(p.seoDescription), own(p.focusKeyword), own(materials), own(p.carePreset?.name), own(careSteps),
        v.sku, v.barcode, v.size === NO_SIZE_VALUE ? "" : v.size, v.color, v.colorHex, num(v.price), num(v.compareAtPrice), num(v.costPrice), v.stock, num(v.weight), formatBoolean(v.isActive),
        ...attributeKeys.map((k) => (first ? (attrs.get(k) ?? "") : "")),
      ]);
    });
  }
  return toCsv(header, rows);
}

/** Just the header, for one type's columns — what to fill in for new products. */
export async function importTemplateCsv(typeId?: string): Promise<string> {
  const keys: string[] = [];
  if (typeId) {
    const type = await getTypeWithTemplate(typeId).catch(() => null);
    if (!type) throw AppError.badRequest("Product type does not exist");
    for (const f of toResolvedTypeConfig(type).fields) keys.push(f.key);
  }
  return toCsv([...PRODUCT_COLUMNS, ...VARIANT_COLUMNS, ...keys.map((k) => `attr:${k}`)], []);
}

/* ───────────────────────── planning (validate without writing) ───────────────────────── */

interface PlannedProduct {
  action: "create" | "update";
  slug: string;
  name: string;
  rows: number[];
  existingId?: string;
  typeId: string;
  input: CreateProductInput | UpdateProductInput;
  /** Indexes into `input.variants` that have no SKU yet and get one generated when written. */
  generateSkuFor: number[];
  variantCount: number;
  changes: string[];
}

interface Refs {
  categories: { id: string; name: string; slug: string }[];
  types: { id: string; key: string; name: string; isActive: boolean }[];
  carePresets: { id: string; name: string; isArchived: boolean }[];
  materials: Map<string, MaterialRef>;
}

async function loadRefs(): Promise<Refs> {
  const [categories, types, carePresets, materials] = await Promise.all([
    prisma.category.findMany({ where: { deletedAt: null }, select: { id: true, name: true, slug: true } }),
    prisma.productTypeDef.findMany({ select: { id: true, key: true, name: true, isActive: true } }),
    prisma.careGuidePreset.findMany({ select: { id: true, name: true, isArchived: true } }),
    prisma.material.findMany({ select: { id: true, name: true, isArchived: true } }),
  ]);
  return { categories, types, carePresets, materials: new Map(materials.map((m) => [m.name.toLowerCase(), m])) };
}

/** Where a zod path ends up in the spreadsheet. */
const COLUMN_OF_FIELD: Record<string, string> = {
  slug: "slug", name: "name", categoryId: "category", brand: "brand", brandTier: "brand_tier", shortDescription: "short_description", description: "description",
  basePrice: "base_price", compareAtPrice: "compare_at_price", costPrice: "cost_price", taxRate: "tax_rate", trackInventory: "track_inventory",
  lowStockThreshold: "low_stock_threshold", isFeatured: "is_featured", seoTitle: "seo_title", seoDescription: "seo_description", focusKeyword: "focus_keyword",
  materials: "materials", carePresetId: "care_guide", careOverride: "care_steps",
  sku: "variant_sku", barcode: "variant_barcode", size: "variant_size", color: "variant_color", colorHex: "variant_color_hex", price: "variant_price",
  stock: "variant_stock", weight: "variant_weight", isActive: "variant_active",
};

type Existing = Awaited<ReturnType<typeof getProductById>>;

async function inChunks<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

export async function planProductImport(csv: string): Promise<{ report: ProductImportReport; planned: PlannedProduct[] }> {
  const errors: ProductImportIssue[] = [];
  const warnings: ProductImportIssue[] = [];
  const emptyReport = (ignoredColumns: string[] = [], rows = 0): ProductImportReport => ({
    ok: errors.length === 0,
    summary: { rows, products: 0, create: 0, update: 0, unchanged: 0, invalid: 0 },
    errors,
    warnings,
    items: [],
    ignoredColumns,
  });

  let records: CsvRecord[];
  try {
    records = parseCsv(csv);
  } catch (err) {
    if (!(err instanceof CsvParseError)) throw err;
    errors.push({ row: err.line, product: null, column: null, message: `${err.message}. Check the quotes around that value.` });
    return { report: emptyReport(), planned: [] };
  }
  if (records.length < 2) {
    errors.push({ row: null, product: null, column: null, message: records.length === 0 ? "The file is empty." : "The file has a header but no product rows." });
    return { report: emptyReport(), planned: [] };
  }

  // Header: normalised names, aliases, attribute columns.
  const [headerRecord, ...dataRecords] = records as [CsvRecord, ...CsvRecord[]];
  if (dataRecords.length > PRODUCT_IMPORT_LIMITS.maxRows) {
    errors.push({ row: null, product: null, column: null, message: `The file has ${dataRecords.length} rows; the limit is ${PRODUCT_IMPORT_LIMITS.maxRows}. Split it into smaller files.` });
    return { report: emptyReport([], dataRecords.length), planned: [] };
  }
  const columnIndex = new Map<string, number>();
  const attrColumns: { key: string; index: number }[] = [];
  const ignoredColumns: string[] = [];
  headerRecord.cells.forEach((raw, index) => {
    const text = raw.replace(/^\ufeff/, "").trim();
    if (!text) return;
    if (/^attr:/i.test(text)) {
      attrColumns.push({ key: text.slice(5).trim(), index });
      return;
    }
    const name = text.toLowerCase().replace(/[\s-]+/g, "_");
    const canonical = ALIASES[name] ?? name;
    if (KNOWN.has(canonical) && !columnIndex.has(canonical)) columnIndex.set(canonical, index);
    else ignoredColumns.push(text);
  });
  if (!columnIndex.has("slug") && !columnIndex.has("name")) errors.push({ row: 1, product: null, column: null, message: "The file needs a `slug` or a `name` column to tell products apart." });
  if (!columnIndex.has("variant_sku")) errors.push({ row: 1, product: null, column: "variant_sku", message: "The file needs a `variant_sku` column: each row is one variant." });
  if (errors.length) return { report: emptyReport(ignoredColumns, dataRecords.length), planned: [] };

  const cell = (record: CsvRecord, column: string) => unguardCell((record.cells[columnIndex.get(column) ?? -1] ?? "").trim());

  // Group rows into products.
  const groups = new Map<string, CsvRecord[]>();
  for (const record of dataRecords) {
    const slugCell = cell(record, "slug").toLowerCase();
    const key = slugCell || slugify(cell(record, "name"));
    if (!key) {
      errors.push({ row: record.line, product: null, column: "slug", message: "This row has neither a slug nor a name, so it can't be matched to a product." });
      continue;
    }
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  if (groups.size > PRODUCT_IMPORT_LIMITS.maxProducts) {
    errors.push({ row: null, product: null, column: null, message: `The file has ${groups.size} products; the limit is ${PRODUCT_IMPORT_LIMITS.maxProducts}. Split it into smaller files.` });
    return { report: emptyReport(ignoredColumns, dataRecords.length), planned: [] };
  }

  // Reference data, and what already exists for the slugs and SKUs in the file.
  const refs = await loadRefs();
  const slugs = [...groups.keys()];
  const existingRows = await prisma.product.findMany({ where: { slug: { in: slugs } }, select: { id: true, slug: true, name: true, deletedAt: true } });
  const existingBySlug = new Map(existingRows.map((p) => [p.slug, p]));
  const fileSkus = dataRecords.map((r) => cell(r, "variant_sku")).filter(Boolean);
  const skuOwners = new Map(
    (await prisma.productVariant.findMany({ where: { sku: { in: fileSkus } }, select: { sku: true, productId: true, product: { select: { slug: true } } } })).map((v) => [v.sku, v]),
  );
  const existingProducts = new Map<string, Existing>();
  await inChunks(existingRows.filter((p) => !p.deletedAt), 8, async (p) => {
    existingProducts.set(p.slug, await getProductById(p.id));
  });
  const typeCache = new Map<string, { type: TypeWithTemplate; config: ResolvedTypeConfig }>();
  const typeOf = async (id: string) => {
    if (!typeCache.has(id)) {
      const type = await getTypeWithTemplate(id);
      typeCache.set(id, { type, config: toResolvedTypeConfig(type) });
    }
    return typeCache.get(id)!;
  };

  const planned: PlannedProduct[] = [];
  const invalid = new Set<string>();
  const seenSkus = new Map<string, number>(); // sku → the line that first used it

  for (const [key, rows] of groups) {
    const lines = rows.map((r) => r.line);
    const issue = (target: ProductImportIssue[], row: number | null, column: string | null, message: string) => {
      if (target === errors) invalid.add(key);
      // One problem per cell: a value that failed to parse would otherwise also be reported as "required" by the schema check.
      if (column !== null && target.some((e) => e.product === key && e.row === row && e.column === column)) return;
      target.push({ row, product: key, column, message });
    };
    const fail = (row: number | null, column: string | null, message: string) => issue(errors, row, column, message);
    const warn = (row: number | null, column: string | null, message: string) => issue(warnings, row, column, message);

    // Product-level cells: the non-blank ones across the product's rows must agree.
    const merged = new Map<string, { value: string; line: number }>();
    for (const column of PRODUCT_COLUMNS) {
      if (!columnIndex.has(column) || column === "slug") continue;
      for (const r of rows) {
        const value = cell(r, column);
        if (!value) continue;
        const seen = merged.get(column);
        if (!seen) merged.set(column, { value, line: r.line });
        else if (seen.value !== value) fail(r.line, column, `"${column}" is different on lines ${seen.line} and ${r.line}. Give it once, or the same value on each row.`);
      }
    }
    const own = (column: string) => merged.get(column)?.value ?? "";
    const ownLine = (column: string) => merged.get(column)?.line ?? lines[0]!;

    const existing = existingBySlug.get(key);
    if (existing?.deletedAt) {
      fail(lines[0]!, "slug", `"${key}" belongs to a product in Trash. Restore it first, or use a different slug.`);
      continue;
    }
    const current = existing ? existingProducts.get(key) : undefined;
    const action: "create" | "update" = current ? "update" : "create";
    const name = own("name") || current?.name || "";
    if (action === "create" && !own("name")) fail(lines[0]!, "name", "A new product needs a name.");

    // Category and type.
    let categoryId: string | undefined;
    if (own("category")) {
      const text = own("category").toLowerCase();
      const bySlug = refs.categories.filter((c) => c.slug.toLowerCase() === text);
      const hits = bySlug.length ? bySlug : refs.categories.filter((c) => c.name.toLowerCase() === text);
      if (hits.length === 1) categoryId = hits[0]!.id;
      else fail(ownLine("category"), "category", hits.length ? `"${own("category")}" matches more than one category; use its slug.` : `No category "${own("category")}". Use an existing category's slug or name.`);
    } else if (action === "create") fail(lines[0]!, "category", "A new product needs a category.");

    let typeRef = current ? { id: current.typeId ?? "", key: "" } : undefined;
    if (own("product_type")) {
      const text = own("product_type").toLowerCase();
      const hit = refs.types.find((t) => t.key.toLowerCase() === text) ?? refs.types.find((t) => t.name.toLowerCase() === text);
      if (!hit) fail(ownLine("product_type"), "product_type", `No product type "${own("product_type")}". Use a type's key or name from Catalog setup.`);
      else if (current && hit.id !== current.typeId) fail(ownLine("product_type"), "product_type", "An import can't change an existing product's type. Change it in the product editor.");
      else if (!current && !hit.isActive) fail(ownLine("product_type"), "product_type", `The "${hit.name}" product type is archived.`);
      else typeRef = { id: hit.id, key: hit.key };
    } else if (action === "create") fail(lines[0]!, "product_type", "A new product needs a product_type (a type's key or name).");
    if (!typeRef?.id) {
      if (action === "update") fail(lines[0]!, "product_type", "This product has no type on record, so it can't be updated by import.");
      continue;
    }
    const { config } = await typeOf(typeRef.id).catch(() => ({ config: null as unknown as ResolvedTypeConfig }));
    if (!config) {
      fail(lines[0]!, "product_type", "This product's type no longer exists.");
      continue;
    }

    if (own("status")) {
      const status = own("status").toUpperCase();
      if (action === "create" && status !== "DRAFT") warn(ownLine("status"), "status", "An import always creates draft products; publish them from the product list once they are complete.");
      if (action === "update" && status !== current!.status) warn(ownLine("status"), "status", `Status is not changed by an import (it stays ${current!.status}).`);
    }

    // Scalars. Parsed into `patch`; blank = "leave as is" on update, "use the default" on create.
    const patch: Record<string, unknown> = {};
    const setNumber = (column: string, field: string, opts: { min?: number; max?: number; int?: boolean } = {}) => {
      if (!own(column)) return;
      const parsed = opts.int ? parseInteger(own(column), opts) : parseDecimal(own(column), opts);
      if (parsed.ok) patch[field] = parsed.value;
      else fail(ownLine(column), column, parsed.message);
    };
    const setBool = (column: string, field: string) => {
      if (!own(column)) return;
      const parsed = parseBoolean(own(column));
      if (parsed.ok) patch[field] = parsed.value;
      else fail(ownLine(column), column, parsed.message);
    };
    const setText = (column: string, field: string) => {
      if (own(column)) patch[field] = own(column);
    };
    if (action === "update" && own("name")) patch.name = own("name");
    setText("brand", "brand");
    setText("short_description", "shortDescription");
    setText("description", "description");
    setText("seo_title", "seoTitle");
    setText("seo_description", "seoDescription");
    setText("focus_keyword", "focusKeyword");
    setNumber("base_price", "basePrice", { min: 0.01 });
    setNumber("compare_at_price", "compareAtPrice", { min: 0 });
    setNumber("cost_price", "costPrice", { min: 0 });
    setNumber("tax_rate", "taxRate", { min: 0, max: 100 });
    setNumber("low_stock_threshold", "lowStockThreshold", { min: 0, int: true });
    setBool("track_inventory", "trackInventory");
    setBool("is_featured", "isFeatured");
    if (own("brand_tier")) {
      const tier = brandTierEnum.safeParse(own("brand_tier").toUpperCase());
      if (tier.success) patch.brandTier = tier.data;
      else fail(ownLine("brand_tier"), "brand_tier", `"${own("brand_tier")}" must be PREMIUM, PLATINUM or LUXURY.`);
    }
    if (action === "create" && patch.basePrice === undefined && !own("base_price")) fail(lines[0]!, "base_price", "A new product needs a base_price.");
    if (categoryId) patch.categoryId = categoryId;

    // Care and materials.
    if (own("care_guide")) {
      const preset = refs.carePresets.find((c) => c.name.toLowerCase() === own("care_guide").toLowerCase());
      if (!preset) fail(ownLine("care_guide"), "care_guide", `No care guide named "${own("care_guide")}".`);
      else if (preset.isArchived && preset.id !== current?.carePresetId) fail(ownLine("care_guide"), "care_guide", `The care guide "${preset.name}" is archived.`);
      else patch.carePresetId = preset.id;
    }
    if (own("care_steps")) patch.careOverride = own("care_steps").split("|").map((s) => s.trim()).filter(Boolean);
    if (own("materials")) {
      const parsed = parseMaterialsCell(own("materials"), refs.materials);
      if (parsed.error) fail(ownLine("materials"), "materials", parsed.error);
      else {
        patch.materials = parsed.lines;
        for (const w of parsed.warnings) warn(ownLine("materials"), "materials", w);
      }
    }

    // Attributes.
    const fieldsByKey = new Map(config.fields.map((f) => [f.key.toLowerCase(), f]));
    const csvAttributes: Record<string, unknown> = {};
    for (const col of attrColumns) {
      for (const r of rows) {
        const raw = unguardCell((r.cells[col.index] ?? "").trim());
        if (!raw) continue;
        const field = fieldsByKey.get(col.key.toLowerCase());
        if (!field) {
          warn(r.line, `attr:${col.key}`, `"${col.key}" isn't a field of the ${config.name} type, so it is ignored.`);
          continue;
        }
        const parsed = parseAttributeCell(field, raw);
        if (!parsed.ok) fail(r.line, `attr:${col.key}`, parsed.message);
        else if (field.key in csvAttributes && JSON.stringify(csvAttributes[field.key]) !== JSON.stringify(parsed.value)) fail(r.line, `attr:${col.key}`, `"attr:${col.key}" is different on two rows of this product.`);
        else csvAttributes[field.key] = parsed.value;
      }
    }

    // Variants.
    interface VariantDraft { id?: string; line: number; fields: Record<string, unknown>; sku: string }
    const variantDrafts: VariantDraft[] = [];
    const bySku = new Map((current?.variants ?? []).map((v) => [v.sku, v]));
    for (const r of rows) {
      const sku = cell(r, "variant_sku");
      const fields: Record<string, unknown> = {};
      const vNumber = (column: string, field: string, opts: { min?: number; int?: boolean } = {}) => {
        const raw = cell(r, column);
        if (!raw) return;
        const parsed = opts.int ? parseInteger(raw, opts) : parseDecimal(raw, opts);
        if (parsed.ok) fields[field] = parsed.value;
        else fail(r.line, column, parsed.message);
      };
      vNumber("variant_price", "price", { min: 0.01 });
      vNumber("variant_compare_at_price", "compareAtPrice", { min: 0.01 });
      vNumber("variant_cost_price", "costPrice", { min: 0 });
      vNumber("variant_stock", "stock", { min: 0, int: true });
      vNumber("variant_weight", "weight", { min: 0 });
      if (cell(r, "variant_active")) {
        const parsed = parseBoolean(cell(r, "variant_active"));
        if (parsed.ok) fields.isActive = parsed.value;
        else fail(r.line, "variant_active", parsed.message);
      }
      for (const [column, field] of [["variant_barcode", "barcode"], ["variant_size", "size"], ["variant_color", "color"], ["variant_color_hex", "colorHex"]] as const) {
        if (cell(r, column)) fields[field] = cell(r, column);
      }
      if (typeof fields.colorHex === "string" && !/^#[0-9a-fA-F]{6}$/.test(fields.colorHex)) fail(r.line, "variant_color_hex", `"${fields.colorHex}" must look like #1A2B3C.`);

      if (sku) {
        if (sku.length > 64) fail(r.line, "variant_sku", "A SKU can be at most 64 characters.");
        const firstUse = seenSkus.get(sku);
        if (firstUse !== undefined) fail(r.line, "variant_sku", `The SKU "${sku}" is also used on line ${firstUse}.`);
        else seenSkus.set(sku, r.line);
        const owner = skuOwners.get(sku);
        if (owner && owner.product.slug !== key) fail(r.line, "variant_sku", `The SKU "${sku}" already belongs to the product "${owner.product.slug}".`);
      }
      variantDrafts.push({ id: bySku.get(sku)?.id, line: r.line, fields, sku });
    }

    // Final variant list: on an update, every existing variant stays (merged with what the file says), and rows with a new or
    // blank SKU add variants. Nothing is ever deleted by an import.
    const variantLines = new Map<number, number>(); // index in the final list → CSV line
    const changes: string[] = [];
    let finalVariants: Record<string, unknown>[];
    const generateSkuFor: number[] = [];
    if (action === "create") {
      finalVariants = variantDrafts.map((d, i) => {
        variantLines.set(i, d.line);
        if (!d.sku) generateSkuFor.push(i);
        return { sku: d.sku || "PENDING", stock: 0, attributeValueIds: [], ...d.fields };
      });
    } else {
      const drafts = new Map(variantDrafts.filter((d) => d.id).map((d) => [d.id!, d]));
      finalVariants = current!.variants
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((v, i) => {
          const d = drafts.get(v.id);
          if (d) variantLines.set(i, d.line);
          const before = {
            id: v.id, sku: v.sku, barcode: v.barcode, size: v.size, sizeLabel: v.sizeLabel, color: v.color, colorHex: v.colorHex, price: num(v.price),
            compareAtPrice: num(v.compareAtPrice), costPrice: num(v.costPrice), stock: v.stock, weight: num(v.weight), isActive: v.isActive,
            attributeValueIds: v.attributeValues.map((a) => a.attributeValueId),
          };
          const after = { ...before, ...(d?.fields ?? {}) };
          for (const [field, to] of Object.entries(d?.fields ?? {})) {
            const from = (before as Record<string, unknown>)[field];
            if (String(from ?? "") !== String(to ?? "")) changes.push(`variant ${v.sku}: ${field} ${from ?? "—"} → ${to}`);
          }
          return after;
        });
      for (const d of variantDrafts.filter((x) => !x.id)) {
        const at = finalVariants.length;
        variantLines.set(at, d.line);
        if (!d.sku) generateSkuFor.push(at);
        finalVariants.push({ sku: d.sku || "PENDING", stock: 0, attributeValueIds: [], ...d.fields });
        changes.push(`new variant ${d.sku || "(SKU generated)"}`);
      }
    }
    // (size, colour) is unique per product.
    const combos = new Map<string, number>();
    finalVariants.forEach((v, i) => {
      const combo = `${String(v.size || NO_SIZE_VALUE)}\u0000${String(v.color || "")}`;
      const seen = combos.get(combo);
      if (seen !== undefined) fail(variantLines.get(i) ?? lines[0]!, "variant_size", `Two variants would both be size "${v.size || NO_SIZE_VALUE}" / colour "${v.color || "—"}". Each combination can exist once per product.`);
      combos.set(combo, i);
    });

    // Assemble the write and check it with the same schemas and type rules the editor uses.
    let input: CreateProductInput | UpdateProductInput | null = null;
    if (action === "create") {
      const draft = {
        name, slug: key, typeId: typeRef.id, status: "DRAFT", ...patch,
        attributes: csvAttributes, variants: finalVariants,
      };
      const parsed = createProductSchema.safeParse(draft);
      if (!parsed.success) for (const i of parsed.error.issues) fail(...locate(i.path, variantLines, lines), zodMessage(i.message));
      else input = parsed.data;
      for (const i of validateProductAgainstConfig({ attributes: csvAttributes, variants: finalVariants as { size?: string; color?: string }[] }, config)) {
        fail(...locate(i.path, variantLines, lines), zodMessage(i.message));
      }
    } else {
      const fieldKeys = new Set(config.fields.map((f) => f.key));
      const touched = Object.keys(csvAttributes).length > 0;
      // Attributes are sent whole-object to the writer: what the type doesn't define (the size guide, older values) must ride along or it is cleared.
      const keep = Object.fromEntries(Object.entries(current!.attributes).filter(([k]) => !fieldKeys.has(k)));
      const draft = {
        slug: current!.slug, // an update must not re-derive the slug from a new name
        ...patch,
        ...(touched ? { attributes: { ...keep, ...csvAttributes } } : {}),
        variants: finalVariants,
      };
      const parsed = updateProductSchema.safeParse(draft);
      if (!parsed.success) for (const i of parsed.error.issues) fail(...locate(i.path, variantLines, lines), zodMessage(i.message));
      else input = parsed.data;
      const mergedAttributes = { ...current!.attributes, ...csvAttributes };
      for (const i of validateProductAgainstConfig(
        { attributes: touched ? mergedAttributes : undefined, variants: finalVariants as { size?: string; color?: string }[] },
        { ...config, fields: touched ? config.fields : [] },
      )) fail(...locate(i.path, variantLines, lines), zodMessage(i.message));

      // What changes, in words (for the preview and to skip products that already match).
      const scalar: [string, string, unknown, unknown][] = [
        ["name", "name", current!.name, patch.name], ["brand", "brand", current!.brand, patch.brand], ["short_description", "shortDescription", current!.shortDescription, patch.shortDescription],
        ["description", "description", current!.description, patch.description], ["base_price", "basePrice", num(current!.basePrice), patch.basePrice],
        ["compare_at_price", "compareAtPrice", num(current!.compareAtPrice), patch.compareAtPrice], ["cost_price", "costPrice", num(current!.costPrice), patch.costPrice],
        ["tax_rate", "taxRate", num(current!.taxRate), patch.taxRate], ["low_stock_threshold", "lowStockThreshold", current!.lowStockThreshold, patch.lowStockThreshold],
        ["track_inventory", "trackInventory", current!.trackInventory, patch.trackInventory], ["is_featured", "isFeatured", current!.isFeatured, patch.isFeatured],
        ["brand_tier", "brandTier", current!.brandTier, patch.brandTier], ["seo_title", "seoTitle", current!.seoTitle, patch.seoTitle],
        ["seo_description", "seoDescription", current!.seoDescription, patch.seoDescription], ["focus_keyword", "focusKeyword", current!.focusKeyword, patch.focusKeyword],
        ["category", "categoryId", current!.categoryId, patch.categoryId], ["care_guide", "carePresetId", current!.carePresetId, patch.carePresetId],
      ];
      for (const [label, , from, to] of scalar) {
        if (to === undefined) continue;
        const short = (v: unknown) => (typeof v === "string" && v.length > 40 ? `${v.slice(0, 40)}…` : (v ?? "—"));
        if (String(from ?? "").trim() !== String(to).trim()) changes.unshift(`${label}: ${short(from)} → ${short(to)}`); // cells are trimmed, so ends aren't a change
      }
      for (const [k, v] of Object.entries(csvAttributes)) {
        if (JSON.stringify(current!.attributes[k] ?? null) !== JSON.stringify(v)) changes.push(`attr:${k}: ${JSON.stringify(current!.attributes[k] ?? null)} → ${JSON.stringify(v)}`);
      }
      if (patch.materials !== undefined) {
        const now = JSON.stringify(current!.materials.map((m) => [m.materialId ?? m.customName, m.percentage]));
        const next = JSON.stringify((patch.materials as { materialId?: string; customName?: string; percentage?: number | null }[]).map((m) => [m.materialId ?? m.customName, m.percentage ?? null]));
        if (now !== next) changes.push("materials changed");
      }
      if (patch.careOverride !== undefined && JSON.stringify(patch.careOverride) !== JSON.stringify(current!.careOverride ?? [])) changes.push("care steps changed");
    }

    if (invalid.has(key) || !input) continue;
    planned.push({
      action, slug: key, name, rows: lines, existingId: current?.id,
      typeId: typeRef.id, input, generateSkuFor, variantCount: finalVariants.length, changes,
    });
  }

  const unchanged = planned.filter((p) => p.action === "update" && p.changes.length === 0).length;
  const items: ProductImportItem[] = planned.map((p) => ({ action: p.action, slug: p.slug, name: p.name, rows: p.rows, variants: p.variantCount, changes: p.changes }));
  const report: ProductImportReport = {
    ok: errors.length === 0,
    summary: {
      rows: dataRecords.length,
      products: groups.size,
      create: planned.filter((p) => p.action === "create").length,
      update: planned.filter((p) => p.action === "update" && p.changes.length > 0).length,
      unchanged,
      invalid: invalid.size,
    },
    errors,
    warnings,
    items: items.slice(0, 200),
    ignoredColumns,
  };
  return { report, planned };
}

const zodMessage = (message: string) => (message === "Required" ? "A value is required." : message);

/** A zod / type-rule path → the CSV line and column it came from. */
function locate(path: (string | number)[], variantLines: Map<number, number>, lines: number[]): [number | null, string | null] {
  if (path[0] === "variants" && typeof path[1] === "number") return [variantLines.get(path[1]) ?? lines[0] ?? null, COLUMN_OF_FIELD[String(path[2] ?? "")] ?? null];
  if (path[0] === "attributes") return [lines[0] ?? null, `attr:${String(path[1] ?? "")}`];
  return [lines[0] ?? null, COLUMN_OF_FIELD[String(path[0] ?? "")] ?? null];
}

/* ───────────────────────── commit ───────────────────────── */

/** Writes what the file says. The file is checked again first (the catalog may have changed since the preview). By default any
 * error stops everything; with `skipInvalid` the products that pass are imported and the rest are left out. Each product is its
 * own write through the same create/update code the editor uses, so a failure affects only that product. */
export async function runProductImport(csv: string, opts: { skipInvalid?: boolean }, adminId: string, ip?: string): Promise<{ report: ProductImportReport; result: ProductImportResult | null }> {
  const { report, planned } = await planProductImport(csv);
  const blocked = report.errors.length > 0;
  if (blocked && !opts.skipInvalid) return { report, result: null };
  if (report.errors.some((e) => e.product === null)) return { report, result: null }; // file-level problems can't be skipped

  const batchId = randomUUID();
  const result: ProductImportResult = { created: 0, updated: 0, skipped: report.summary.invalid + report.summary.unchanged, failed: [], batchId };
  for (const p of planned) {
    if (p.action === "update" && p.changes.length === 0) continue;
    try {
      const input = structuredClone(p.input) as { variants: { sku: string; size?: string | null; color?: string | null }[] };
      // Blank SKUs are generated now (numbers are reserved at write time, never in the preview).
      const taken = input.variants.map((v) => v.sku).filter((s) => s !== "PENDING");
      for (const index of p.generateSkuFor) {
        const v = input.variants[index]!;
        v.sku = await generateSku({ typeId: p.typeId, color: v.color, size: v.size, taken });
        taken.push(v.sku);
      }
      if (p.action === "create") {
        await createProduct(input as CreateProductInput, adminId, ip);
        result.created++;
      } else {
        await updateProduct(p.existingId!, input as UpdateProductInput, adminId, ip, { stockNote: "Changed by CSV import" });
        result.updated++;
      }
    } catch (err) {
      result.failed.push({ slug: p.slug, message: err instanceof AppError ? err.message : "Unexpected error" });
      if (!(err instanceof AppError)) console.error("[product-import] unexpected failure for", p.slug, err);
    }
  }
  recordAudit({
    adminId,
    action: "products.imported",
    entityType: "products",
    entityId: batchId,
    ipAddress: ip ?? null,
    metadata: { created: result.created, updated: result.updated, skipped: result.skipped, failed: result.failed.length, rows: report.summary.rows },
  });
  return { report, result };
}
