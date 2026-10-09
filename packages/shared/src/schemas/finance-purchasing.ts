/**
 * Request schemas of the Phase 4 purchasing API (/api/v1/purchasing — docs/FINANCE_PHASE_4.md). 4A: suppliers and
 * purchase tax codes. Money in MAJOR units, at most 2 decimals, like Phases 1–3.
 */
import { z } from "zod";
import { financeAmountSchema } from "./finance-money";

const optionalText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const page = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50) };

export const SUPPLIER_STATUSES = ["ACTIVE", "ON_HOLD", "INACTIVE"] as const;
export const supplierCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9-]{1,23}$/, "2–24 characters: letters, digits and dashes");

const supplierAddressSchema = z
  .object({
    line: optionalText(200),
    area: optionalText(100),
    district: optionalText(100),
    division: optionalText(100),
    postalCode: optionalText(20),
    country: optionalText(100),
  })
  .optional()
  .nullable();

const supplierFields = {
  legalName: z.string().trim().min(2).max(200),
  displayName: z.string().trim().min(1).max(120).optional(),
  contactName: optionalText(120),
  phone: optionalText(40),
  email: z.string().trim().email().max(200).optional().nullable().or(z.literal("").transform(() => null)),
  address: supplierAddressSchema,
  taxId: optionalText(60),
  vatRegistrationNo: optionalText(60),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "ISO 4217 code, e.g. BDT").optional(),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).default(0),
  paymentTermsNote: optionalText(200),
  creditLimit: financeAmountSchema.optional().nullable(),
  defaultTaxCodeId: z.string().trim().min(1).max(64).optional().nullable(),
  defaultExpenseAccountId: z.string().trim().min(1).max(64).optional().nullable(),
  notes: optionalText(2000),
  evidence: optionalText(1000),
};

export const supplierCreateSchema = z.object({ code: supplierCodeSchema.optional(), ...supplierFields });

/** The code is permanent (the cross-installation merge key) and can't be edited. */
export const supplierUpdateSchema = z
  .object({
    ...supplierFields,
    legalName: supplierFields.legalName.optional(),
    paymentTermsDays: z.coerce.number().int().min(0).max(365).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to change");

export const supplierStatusSchema = z
  .object({ status: z.enum(SUPPLIER_STATUSES), reason: optionalText(500) })
  .refine((v) => v.status === "ACTIVE" || Boolean(v.reason), { message: "Say why the supplier is on hold or inactive", path: ["reason"] });

export const supplierListQuerySchema = z.object({ q: z.string().trim().max(100).optional(), status: z.enum(SUPPLIER_STATUSES).optional(), ...page });

/** A percentage 0–100 with up to 4 decimals, kept as a decimal STRING (it is stored as a Decimal — no float on the way). */
const percent = z
  .union([z.number(), z.string().trim()])
  .transform((v) => String(v))
  .refine((s) => /^\d{1,3}(\.\d{1,4})?$/.test(s), "0–100, at most 4 decimals")
  .refine((s) => {
    const [whole] = s.split(".");
    return Number(whole) < 100 || /^100(\.0{1,4})?$/.test(s);
  }, "0–100, at most 4 decimals");

export const taxCodeCreateSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_.-]{0,23}$/, "1–24 characters: letters, digits, dot, dash or underscore"),
  name: z.string().trim().min(2).max(120),
  description: optionalText(500),
  rate: percent,
  recoverablePct: percent,
  recoverableMappingKey: z.string().trim().max(64).optional(),
  nonRecoverableMappingKey: z.string().trim().max(64).optional(),
});

/** Rate, recoverable share and accounts are permanent — a new rate is a new code. */
export const taxCodeUpdateSchema = z
  .object({ name: z.string().trim().min(2).max(120).optional(), description: optionalText(500), isActive: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0, "Nothing to change");

export type SupplierCreateInput = z.infer<typeof supplierCreateSchema>;
export type SupplierUpdateInput = z.infer<typeof supplierUpdateSchema>;
export type TaxCodeCreateInput = z.infer<typeof taxCodeCreateSchema>;

// ── Phase 4C: the valuation cutover (docs/FINANCE_PHASE_4C.md) ────────────────────────────────────────────────────────

export const CUTOVER_VALUATION_STATUSES = ["KNOWN", "ESTIMATED", "MISSING"] as const;
export const CUTOVER_COST_SOURCES = ["OPENING_COUNT", "CATALOG_VARIANT", "CATALOG_PRODUCT", "OWNER", "SUPPLIER_INVOICE", "NONE"] as const;

export const cutoverDraftSchema = z.object({ notes: optionalText(2000) });

/** One line's approved cost. MISSING has no cost (source NONE); KNOWN needs evidence. Up to 500 lines per call. */
export const cutoverLinesSchema = z.object({
  lines: z
    .array(
      z
        .object({
          variantId: z.string().trim().min(1).max(64),
          unitCost: financeAmountSchema.nullable(),
          valuationStatus: z.enum(CUTOVER_VALUATION_STATUSES),
          costSource: z.enum(CUTOVER_COST_SOURCES),
          evidence: optionalText(500),
        })
        .refine((l) => (l.valuationStatus === "MISSING") === (l.unitCost === null), "MISSING lines have no cost; KNOWN and ESTIMATED lines need one")
        .refine((l) => l.valuationStatus !== "KNOWN" || Boolean(l.evidence), "A KNOWN cost needs its evidence")
        .refine((l) => (l.valuationStatus === "MISSING") === (l.costSource === "NONE"), "Only a MISSING line has source NONE"),
    )
    .min(1)
    .max(500)
    .refine((ls) => new Set(ls.map((l) => l.variantId)).size === ls.length, "Each variant once"),
});

/** Signed: positive = inventory was understated at opening (credit to opening balance equity). */
export const cutoverSettingsSchema = z
  .object({
    notes: optionalText(2000),
    openingErrorAmount: z
      .number()
      .refine((v) => Number.isFinite(v) && Math.abs(Math.round(v * 100) - v * 100) < 1e-6 && Math.abs(v) < 1e13, "At most 2 decimals")
      .optional(),
    openingErrorReason: optionalText(1000),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to change");

export const cutoverApproveSchema = z.object({ acknowledgeMissing: z.boolean().default(false) });
export const cutoverReopenSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export const cutoverLineQuerySchema = z.object({ status: z.enum(CUTOVER_VALUATION_STATUSES).optional(), search: z.string().trim().max(100).optional(), ...page });

// ── Phase 4D: purchase orders, goods receipts, supplier returns (docs/FINANCE_PHASE_4D.md) ────────────────────────────

const id = z.string().trim().min(1).max(64);
const qty = z.coerce.number().int().min(1).max(1_000_000);
const businessDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

export const PURCHASE_ORDER_STATUSES = ["DRAFT", "SUBMITTED", "APPROVED", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED", "CANCELLED"] as const;
export const GOODS_RECEIPT_STATUSES = ["DRAFT", "POSTED", "REVERSED"] as const;
export const PURCHASE_RETURN_STATUSES = ["DRAFT", "APPROVED", "SHIPPED", "CANCELLED"] as const;

const purchaseOrderLineSchema = z
  .object({
    lineType: z.enum(["STOCK", "NON_STOCK"]),
    variantId: id.optional().nullable(),
    expenseAccountId: id.optional().nullable(),
    description: optionalText(300),
    qtyOrdered: qty,
    unitPrice: financeAmountSchema,
    taxCodeId: id.optional().nullable(),
  })
  .refine((l) => (l.lineType === "STOCK" ? Boolean(l.variantId) && !l.expenseAccountId : Boolean(l.expenseAccountId) && !l.variantId), "A stock line names a variant; a service / expense line names an expense account")
  .refine((l) => l.lineType === "STOCK" || Boolean(l.description), "Describe a service / expense line");

export const purchaseOrderCreateSchema = z.object({
  supplierId: id,
  orderDate: businessDateSchema.optional(),
  expectedDate: businessDateSchema.optional().nullable(),
  deliveryTerms: optionalText(300),
  notes: optionalText(2000),
  lines: z.array(purchaseOrderLineSchema).min(1).max(200),
});
export const purchaseOrderUpdateSchema = purchaseOrderCreateSchema.partial().refine((v) => Object.keys(v).length > 0, "Nothing to change");
export const purchaseOrderReasonSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export const purchaseOrderListQuerySchema = z.object({ status: z.enum(PURCHASE_ORDER_STATUSES).optional(), supplierId: id.optional(), q: z.string().trim().max(100).optional(), ...page });

const goodsReceiptLineSchema = z
  .object({
    purchaseOrderLineId: id.optional().nullable(),
    variantId: id.optional().nullable(),
    qtyAccepted: z.coerce.number().int().min(0).max(1_000_000),
    qtyRejected: z.coerce.number().int().min(0).max(1_000_000).default(0),
    /** A receipt without an order only: the actual unit cost. */
    unitCost: financeAmountSchema.optional().nullable(),
  })
  .refine((l) => l.qtyAccepted + l.qtyRejected > 0, "Receive or reject at least one unit")
  .refine((l) => Boolean(l.purchaseOrderLineId) !== Boolean(l.variantId), "A line is either an order line or (without an order) a variant");

export const goodsReceiptCreateSchema = z
  .object({
    purchaseOrderId: id.optional().nullable(),
    supplierId: id.optional().nullable(),
    receiptDate: businessDateSchema.optional(),
    supplierRef: optionalText(100),
    notes: optionalText(2000),
    evidence: optionalText(500),
    directReason: optionalText(500),
    lines: z.array(goodsReceiptLineSchema).min(1).max(200),
  })
  .refine((r) => Boolean(r.purchaseOrderId) || Boolean(r.supplierId), "Name the purchase order, or the supplier of a receipt without one")
  .refine((r) => Boolean(r.purchaseOrderId) || Boolean(r.directReason), "A receipt without a purchase order needs its reason");
export const goodsReceiptPostSchema = z.object({ overReceiptReason: optionalText(500) });
export const goodsReceiptListQuerySchema = z.object({ status: z.enum(GOODS_RECEIPT_STATUSES).optional(), purchaseOrderId: id.optional(), supplierId: id.optional(), ...page });

export const purchaseReturnCreateSchema = z.object({
  supplierId: id,
  returnDate: businessDateSchema.optional(),
  reason: z.string().trim().min(3).max(500),
  notes: optionalText(2000),
  lines: z
    .array(z.object({ goodsReceiptLineId: id.optional().nullable(), variantId: id.optional().nullable(), quantity: qty }).refine((l) => Boolean(l.goodsReceiptLineId) || Boolean(l.variantId), "Name the receipt line or the variant"))
    .min(1)
    .max(200),
});
export const purchaseReturnListQuerySchema = z.object({ status: z.enum(PURCHASE_RETURN_STATUSES).optional(), supplierId: id.optional(), ...page });

export const purchasingSettingsSchema = z
  .object({
    purchaseApprovalThreshold: financeAmountSchema.nullable().optional(),
    overReceiptTolerancePct: z.number().min(0).max(100).refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, "At most 2 decimals").optional(),
    invoicePriceTolerancePct: z.number().min(0).max(100).refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, "At most 2 decimals").optional(),
    reason: optionalText(500),
  })
  .refine((v) => v.purchaseApprovalThreshold !== undefined || v.overReceiptTolerancePct !== undefined || v.invoicePriceTolerancePct !== undefined, "Nothing to change");

// ── Phase 4E: supplier invoices and credit notes (docs/FINANCE_PHASE_4E.md) ────────────────────────────────────────────
export const SUPPLIER_INVOICE_KINDS = ["INVOICE", "CREDIT_NOTE"] as const;
export const SUPPLIER_INVOICE_STATUSES = ["DRAFT", "POSTED", "VOID"] as const;
export const SUPPLIER_INVOICE_LINE_TYPES = ["STOCK", "RETURN", "EXPENSE", "PRODUCTION_COST"] as const;

const supplierInvoiceLineSchema = z
  .object({
    lineType: z.enum(SUPPLIER_INVOICE_LINE_TYPES),
    goodsReceiptLineId: id.optional().nullable(),
    purchaseReturnLineId: id.optional().nullable(),
    purchaseOrderLineId: id.optional().nullable(),
    productionCostEntryId: id.optional().nullable(),
    expenseAccountId: id.optional().nullable(),
    description: optionalText(300),
    quantity: qty.default(1),
    unitPrice: financeAmountSchema,
    taxCodeId: id.optional().nullable(),
  })
  .refine(
    (l) =>
      l.lineType === "STOCK" ? Boolean(l.goodsReceiptLineId)
      : l.lineType === "RETURN" ? Boolean(l.purchaseReturnLineId)
      : l.lineType === "PRODUCTION_COST" ? Boolean(l.productionCostEntryId)
      : Boolean(l.expenseAccountId),
    "Goods name their receipt line, returns their return line, production costs their cost entry, expenses their account",
  )
  .refine((l) => l.lineType !== "EXPENSE" || Boolean(l.description), "Describe an expense line");

export const supplierInvoiceCreateSchema = z.object({
  kind: z.enum(SUPPLIER_INVOICE_KINDS).default("INVOICE"),
  supplierId: id,
  supplierRef: z.string().trim().min(1).max(100),
  invoiceDate: businessDateSchema.optional(),
  dueDate: businessDateSchema.optional().nullable(),
  notes: optionalText(2000),
  evidence: optionalText(500),
  lines: z.array(supplierInvoiceLineSchema).min(1).max(200),
});
export const supplierInvoiceUpdateSchema = supplierInvoiceCreateSchema.omit({ kind: true, supplierId: true }).partial().refine((v) => Object.keys(v).length > 0, "Nothing to change");
export const supplierInvoicePostSchema = z.object({ varianceReason: optionalText(500) });
export const supplierInvoiceVoidSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export const supplierInvoiceListQuerySchema = z.object({ status: z.enum(SUPPLIER_INVOICE_STATUSES).optional(), kind: z.enum(SUPPLIER_INVOICE_KINDS).optional(), supplierId: id.optional(), q: z.string().trim().max(100).optional(), ...page });
export const supplierOpenItemsQuerySchema = z.object({ supplierId: id });
export type SupplierInvoiceCreateInput = z.infer<typeof supplierInvoiceCreateSchema>;
export type SupplierInvoiceUpdateInput = z.infer<typeof supplierInvoiceUpdateSchema>;

export type PurchaseOrderCreateInput = z.infer<typeof purchaseOrderCreateSchema>;
export type PurchaseOrderUpdateInput = z.infer<typeof purchaseOrderUpdateSchema>;
export type GoodsReceiptCreateInput = z.infer<typeof goodsReceiptCreateSchema>;
export type PurchaseReturnCreateInput = z.infer<typeof purchaseReturnCreateSchema>;
