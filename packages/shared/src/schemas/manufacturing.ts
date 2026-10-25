/**
 * Request schemas of the manufacturing API (/api/v1/manufacturing — docs/MANUFACTURING.md). Quantities of material are
 * whole stock units; quantities per finished unit are decimal STRINGS (≤ 6 dp) and wastage a decimal string (≤ 2 dp), so
 * no float reaches a requirement. Money in MAJOR units, ≤ 2 decimals, like the finance API.
 */
import { z } from "zod";
import { financeAmountSchema } from "./finance-money";

const optionalText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const id = z.string().trim().min(1).max(64);
const page = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50) };
const businessDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const decimalString = (dp: number, label: string) =>
  z.union([z.string().trim(), z.number().transform(String)]).refine((s) => new RegExp(String.raw`^\d{1,12}(\.\d{1,${dp}})?$`).test(s), `${label}: a number with at most ${dp} decimals`);

export const PRODUCTION_ORDER_STATUSES = ["DRAFT", "APPROVED", "IN_PRODUCTION", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED", "CANCELLED"] as const;
export const BOM_STATUSES = ["DRAFT", "APPROVED", "ARCHIVED"] as const;
export const PRODUCTION_COST_GROUPS = ["MATERIAL", "LABOUR", "EXTERNAL_SERVICE", "OVERHEAD", "OTHER"] as const;
export const MATERIAL_SUPPLIERS = ["BUSINESS", "PRODUCER"] as const;

const materialVariantSchema = z.object({
  sku: z.string().trim().min(2).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "Letters, digits, dot, dash or underscore"),
  spec: z.string().trim().max(60).default("Standard"),
  color: optionalText(60),
});
export const materialCreateSchema = z.object({
  name: z.string().trim().min(2).max(160),
  stockUnit: z.string().trim().min(1).max(16),
  description: optionalText(2000),
  referenceCost: financeAmountSchema.nullable().optional(),
  variants: z.array(materialVariantSchema).min(1).max(100).refine((vs) => new Set(vs.map((v) => v.sku.toUpperCase())).size === vs.length, "Each SKU once"),
});
export const materialUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(160).optional(),
    stockUnit: z.string().trim().min(1).max(16).optional(),
    // left out = unchanged (optionalText would turn a missing description into null and clear it on every edit)
    description: z.string().trim().max(2000).nullable().optional(),
    referenceCost: financeAmountSchema.nullable().optional(),
    addVariants: z.array(materialVariantSchema).max(100).optional(),
    /** How it is bought — replaces the list: one `label` (litre, dozen, tola) is `factor` stock units, ≤ 4 decimals. */
    purchaseUnits: z
      .array(z.object({ label: z.string().trim().min(1).max(24), factor: z.number().positive().max(1_000_000).refine((f) => Math.abs(Math.round(f * 10_000) - f * 10_000) < 1e-6, "At most 4 decimals") }))
      .max(10)
      .refine((us) => new Set(us.map((u) => u.label.toLowerCase())).size === us.length, "Each unit once")
      .optional(),
    /** Renames existing sizes — SKU, spec or colour; a field left out stays as it is. */
    variants: z
      .array(z.object({ id, sku: materialVariantSchema.shape.sku.optional(), spec: z.string().trim().min(1).max(60).optional(), color: z.string().trim().max(60).optional() }))
      .max(100)
      .refine((vs) => new Set(vs.map((v) => v.id)).size === vs.length, "Each size once")
      .optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to change");
export const materialListQuerySchema = z.object({ q: z.string().trim().max(100).optional(), includeArchived: z.enum(["true", "false"]).optional() });

const bomLineSchema = z.object({
  materialVariantId: id,
  finishedVariantId: id.optional().nullable(),
  qtyPerUnit: decimalString(6, "Quantity per unit").refine((s) => Number(s) > 0, "Quantity per unit must be more than 0"),
  wastagePct: decimalString(2, "Wastage").refine((s) => Number(s) < 100, "Wastage is below 100%").optional(),
  suppliedBy: z.enum(MATERIAL_SUPPLIERS).optional(),
  notes: optionalText(300),
});
export const bomCreateSchema = z.object({ productId: id, name: optionalText(120), notes: optionalText(2000), lines: z.array(bomLineSchema).min(1).max(200) });
export const bomUpdateSchema = z.object({ name: optionalText(120), notes: optionalText(2000), lines: z.array(bomLineSchema).min(1).max(200).optional() }).refine((v) => Object.keys(v).length > 0, "Nothing to change");
export const bomListQuerySchema = z.object({ productId: id.optional(), status: z.enum(BOM_STATUSES).optional() });

export const productionOrderCreateSchema = z.object({
  productId: id,
  producerSupplierId: id.optional().nullable(),
  bomId: id.optional().nullable(),
  orderDate: businessDate.optional(),
  expectedDate: businessDate.optional().nullable(),
  terms: optionalText(2000),
  notes: optionalText(2000),
  lines: z.array(z.object({ variantId: id, plannedQty: z.coerce.number().int().min(1).max(10_000_000) })).min(1).max(500),
  extraMaterials: z.array(z.object({ materialVariantId: id, plannedQty: z.coerce.number().int().min(1).max(1_000_000_000), suppliedBy: z.enum(MATERIAL_SUPPLIERS).optional() })).max(200).optional(),
  plannedCosts: z.array(z.object({ categoryId: id, amount: financeAmountSchema, basis: optionalText(300) })).max(100).optional(),
});
export const productionOrderUpdateSchema = productionOrderCreateSchema.partial().refine((v) => Object.keys(v).length > 0, "Nothing to change");
export const productionOrderReasonSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export const productionOrderListQuerySchema = z.object({ status: z.enum(PRODUCTION_ORDER_STATUSES).optional(), productId: id.optional(), producerSupplierId: id.optional(), q: z.string().trim().max(100).optional(), ...page });

export const costCategoryCreateSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,31}$/, "2–32 characters: letters, digits or underscore"),
  name: z.string().trim().min(2).max(80),
  group: z.enum(PRODUCTION_COST_GROUPS),
});
export const costCategoryUpdateSchema = z
  .object({ name: z.string().trim().min(2).max(80).optional(), group: z.enum(PRODUCTION_COST_GROUPS).optional(), isActive: z.boolean().optional(), sortOrder: z.number().int().min(0).max(10_000).optional() })
  .refine((v) => Object.keys(v).length > 0, "Nothing to change");

// ── M2: materials custody (docs/MANUFACTURING.md §6) ──────────────────────────────────────────────────────────────────
const moveLines = z
  .array(z.object({ materialLineId: id, quantity: z.coerce.number().int().min(1).max(1_000_000_000) }))
  .min(1)
  .max(200)
  .refine((ls) => new Set(ls.map((l) => l.materialLineId)).size === ls.length, "Each material once");
export const materialIssueSchema = z.object({ lines: moveLines, note: optionalText(500), overIssueReason: optionalText(500) });
export const materialReturnSchema = z.object({ lines: moveLines, note: optionalText(500) });
export const materialUsageSchema = z.object({
  lines: z
    .array(z.object({ materialLineId: id, consumedQty: z.coerce.number().int().min(0).max(1_000_000_000), scrappedQty: z.coerce.number().int().min(0).max(1_000_000_000) }))
    .min(1)
    .max(200),
});

// ── M3: production costs (docs/MANUFACTURING.md §7) ───────────────────────────────────────────────────────────────────
const costEntryBase = {
  categoryId: id,
  supplierId: id.optional().nullable(),
  reference: optionalText(100),
  description: z.string().trim().min(2).max(300),
  costDate: businessDate.optional(),
  quantity: decimalString(4, "Quantity").optional().nullable(),
  unitRate: decimalString(6, "Rate").optional().nullable(),
  amount: financeAmountSchema.optional().nullable(),
  evidence: optionalText(500),
};
export const productionCostCreateSchema = z
  .object(costEntryBase)
  .refine((v) => (v.quantity != null && v.unitRate != null) !== (v.amount != null), "Give either an amount or a quantity × rate");
export const productionCostUpdateSchema = z.object(costEntryBase).partial().refine((v) => Object.keys(v).length > 0, "Nothing to change");
export const productionCostVoidSchema = z.object({ reason: z.string().trim().min(3).max(500) });

// ── M4: deliveries, inspection and finished goods (docs/MANUFACTURING.md §8) ──────────────────────────────────────────
const nonNeg = z.coerce.number().int().min(0).max(10_000_000);
export const productionReceiptCreateSchema = z.object({
  receiptDate: businessDate.optional(),
  deliveryRef: optionalText(100),
  inspectionNotes: optionalText(2000),
  evidence: optionalText(500),
  lines: z
    .array(
      z
        .object({ orderLineId: id, delivered: nonNeg, accepted: nonNeg, rejected: nonNeg.default(0), rework: nonNeg.default(0), rejectReason: optionalText(300) })
        .refine((l) => l.delivered > 0, "Something was delivered")
        .refine((l) => l.delivered === l.accepted + l.rejected + l.rework, "Delivered must equal accepted + rejected + rework")
        .refine((l) => l.rejected === 0 || Boolean(l.rejectReason), "Say why units were rejected"),
    )
    .min(1)
    .max(500)
    .refine((ls) => new Set(ls.map((l) => l.orderLineId)).size === ls.length, "Each variant once"),
});
export const productionReceiptPostSchema = z.object({ overReceiptReason: optionalText(500) });

// ── M5: close, final cost, abnormal loss (docs/MANUFACTURING.md §9) ─────────────────────────────────────────────────────
export const productionOrderCloseSchema = z
  .object({ abnormalLoss: financeAmountSchema.optional().nullable(), abnormalLossReason: optionalText(500), note: optionalText(500) })
  .refine((v) => !v.abnormalLoss || Boolean(v.abnormalLossReason), { message: "Say why the loss is abnormal", path: ["abnormalLossReason"] });
