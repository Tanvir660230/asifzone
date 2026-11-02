/**
 * Request schemas of the stock hub (docs/STOCK_HUB.md, /admin/stock): Bought — one form for a purchase (items, extras,
 * who paid) — Counted and Filled. Money is sent in MAJOR units with at most 2 decimals, like the rest of the finance API.
 */
import { z } from "zod";
import { isBusinessDate } from "../finance/periods";
import { financeAmountSchema } from "./finance-money";
import { OWNER_FUNDING_KINDS } from "./finance-books";

const businessDate = z.string().refine(isBusinessDate, "Use a valid date (YYYY-MM-DD)");
const id = z.string().trim().min(1).max(64);
const optionalText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
/** Each amount at most 1,000,000,000; a whole purchase at most 10,000,000,000 (keeps sums far inside exact numbers). */
export const STOCK_PURCHASE_MAX_AMOUNT = 1_000_000_000;
export const STOCK_PURCHASE_MAX_TOTAL = 10_000_000_000;
const positive = financeAmountSchema.refine((v) => v > 0, "Amount must be more than zero").refine((v) => v <= STOCK_PURCHASE_MAX_AMOUNT, "At most 1,000,000,000");
const quantity = z.number().int("Whole units (stock units: ml, pcs…)").min(1).max(1_000_000);
const onceEach = (lines: Array<{ variantId: string }>) => new Set(lines.map((l) => l.variantId)).size === lines.length;
/** A quantity in a purchase unit (2.5 litre, 1.5 tola): more than 0, at most 4 decimals. */
const fourDecimals = (v: number) => Math.abs(Math.round(v * 10_000) - v * 10_000) < 1e-6;
const purchaseQty = z.number().positive("More than zero").max(1_000_000).refine(fourDecimals, "At most 4 decimals");
/** Ten-thousandths, so bill quantities add up exactly (2.5 + 0.1 litre). */
const tenThousandths = (v: number) => Math.round(v * 10_000);
const nonNegative = financeAmountSchema.refine((v) => v >= 0, "Not below zero").refine((v) => v <= STOCK_PURCHASE_MAX_AMOUNT, "At most 1,000,000,000");
/** How extras (transport, loading…) are spread over the items: by what each line cost, or by how many units it brought. */
export const EXTRAS_METHODS = ["VALUE", "QUANTITY"] as const;
export type ExtrasMethod = (typeof EXTRAS_METHODS)[number];
/** One purchase line (docs/MATERIALS_PURCHASING.md §2–3): how many arrived — in the stock unit (`quantity`), or in one of the
 * item's purchase units (`purchaseUnitId` + `purchaseQty`, converted on the server) — what was paid for the line after the
 * supplier's discount (`amount`), the discount itself, and how many stock units of it arrived damaged (never stocked). */
export const stockPurchaseLineSchema = z
  .object({
    variantId: id,
    quantity: quantity.optional().nullable(),
    purchaseUnitId: id.optional().nullable(),
    purchaseQty: purchaseQty.optional().nullable(),
    amount: positive,
    discount: nonNegative.optional().nullable(),
    damaged: z.number().int("Whole stock units").min(0).max(1_000_000).default(0),
  })
  .refine((l) => (l.quantity != null) !== (l.purchaseUnitId != null), { message: "Give the quantity in the stock unit, or a purchase unit and how many of it", path: ["quantity"] })
  .refine((l) => (l.purchaseUnitId == null) === (l.purchaseQty == null), { message: "How many of the purchase unit?", path: ["purchaseQty"] });
/** The line's quantity as the bill shows it (purchase units when bought in one). */
export const billQuantityOf = (l: { quantity?: number | null; purchaseQty?: number | null }) => l.purchaseQty ?? l.quantity ?? 0;
const materialOnce = (lines: Array<{ materialVariantId: string }>) => new Set(lines.map((l) => l.materialVariantId)).size === lines.length;
/** Who pays: a money account (cash, bank, wallet) or the owner's own money (owner-only). For the owner's money, owner
 * decision Q14 = B: `funding` says whether it is owed back to the owner (REIMBURSE) or added as capital (CAPITAL, the
 * default when omitted — what the form did before the choice existed). */
const paidFrom = z.union([z.object({ financialAccountId: id }).strict(), z.object({ ownerPocket: z.literal(true), funding: z.enum(OWNER_FUNDING_KINDS).optional() }).strict()]);

/** Bought: what arrived, the line total paid for each item, extras spread over the items by value, and who paid. */
export const stockPurchaseSchema = z
  .object({
    date: businessDate.optional(),
    /** Find-or-create by name; empty → "Local market". */
    supplierName: z.string().trim().max(120).optional().nullable().transform((v) => (v ? v : null)).refine((v) => v === null || v.length >= 2, "At least 2 characters"),
    reference: optionalText(100),
    note: optionalText(500),
    /** Why it was entered anyway when it looked like a purchase already recorded (blueprint P0.3) — optional. */
    duplicateReason: optionalText(500),
    lines: z.array(stockPurchaseLineSchema).min(1).max(100).refine(onceEach, "Each item once — add the quantities together"),
    /** Total quantity on the supplier's invoice or receipt, in the units the bill uses (10 litre counts 10, not 10,000 ml),
     * typed from the document: the lines must add up to it, so a size typed into the wrong row or a missing size is caught
     * before anything is written (inventory recovery F-c; docs/MATERIALS_PURCHASING.md §2). */
    documentTotal: z.number().positive().max(100_000_000).refine(fourDecimals, "At most 4 decimals"),
    extras: z.array(z.object({ description: z.string().trim().min(1).max(120), amount: positive })).max(20).default([]),
    extrasMethod: z.enum(EXTRAS_METHODS).default("VALUE"),
    paidFrom,
    /** Before stock costing is live (blueprint P1.4, owner decision Q-F): set each item's catalog cost from this purchase.
     * Omitted = yes. Ignored once costing is live (the purchase is booked and the average cost moves instead). */
    updateCatalogCost: z.boolean().optional(),
  })
  .refine((p) => [...p.lines, ...p.extras].reduce((s, x) => s + x.amount, 0) <= STOCK_PURCHASE_MAX_TOTAL, { message: "A purchase is at most 10,000,000,000 in all", path: ["lines"] })
  .superRefine((p, ctx) => {
    const entered = p.lines.reduce((s, l) => s + tenThousandths(billQuantityOf(l)), 0);
    if (entered !== tenThousandths(p.documentTotal)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["documentTotal"], message: `The lines add up to ${entered / 10_000} but the document says ${p.documentTotal} — check each size before saving` });
    }
  });
export type StockPurchaseInput = z.input<typeof stockPurchaseSchema>;

/**
 * Ordered, not yet arrived (docs/MATERIALS_PURCHASING.md §4): the same lines as Bought, without damaged units (nothing has
 * arrived) or extras (they are paid with a delivery). Makes a purchase order — no stock, no money.
 */
export const stockOrderSchema = z
  .object({
    date: businessDate.optional(),
    expectedDate: businessDate.optional().nullable(),
    supplierName: z.string().trim().max(120).optional().nullable().transform((v) => (v ? v : null)).refine((v) => v === null || v.length >= 2, "At least 2 characters"),
    reference: optionalText(100),
    note: optionalText(500),
    lines: z.array(stockPurchaseLineSchema).min(1).max(100).refine(onceEach, "Each item once — add the quantities together"),
    documentTotal: z.number().positive().max(100_000_000).refine(fourDecimals, "At most 4 decimals"),
  })
  .refine((o) => o.lines.every((l) => !l.damaged), { message: "Nothing has arrived yet — damaged units are entered with the delivery", path: ["lines"] })
  .refine((o) => !o.expectedDate || !o.date || o.expectedDate >= o.date, { message: "Expected after the order date", path: ["expectedDate"] })
  .superRefine((o, ctx) => {
    const entered = o.lines.reduce((s, l) => s + tenThousandths(billQuantityOf(l)), 0);
    if (entered !== tenThousandths(o.documentTotal)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["documentTotal"], message: `The lines add up to ${entered / 10_000} but the order says ${o.documentTotal}` });
  });
export type StockOrderInput = z.input<typeof stockOrderSchema>;

/**
 * A delivery against an ordered purchase (docs/MATERIALS_PURCHASING.md §4): per item, good units into stock and damaged ones
 * rejected (stock units); the bill made now — paid now from an account, or left to pay — or later, when the supplier's
 * invoice comes; extras paid with it need the account they were paid from.
 */
export const stockDeliverySchema = z
  .object({
    date: businessDate.optional(),
    supplierRef: optionalText(100),
    lines: z
      .array(z.object({ variantId: id, good: z.number().int().min(0).max(1_000_000), damaged: z.number().int().min(0).max(1_000_000).default(0) }))
      .min(1)
      .max(100)
      .refine(onceEach, "Each item once")
      .refine((ls) => ls.some((l) => l.good + l.damaged > 0), "Enter what arrived"),
    bill: z.enum(["NOW", "LATER"]).default("NOW"),
    paidFromAccountId: id.optional().nullable(),
    extras: z.array(z.object({ description: z.string().trim().min(1).max(120), amount: positive })).max(20).default([]),
    extrasMethod: z.enum(EXTRAS_METHODS).default("VALUE"),
  })
  .refine((d) => d.bill === "NOW" || !d.paidFromAccountId, { message: "A bill that comes later is paid later", path: ["paidFromAccountId"] })
  .refine((d) => !d.extras.length || Boolean(d.paidFromAccountId), { message: "Say which account paid the extras", path: ["paidFromAccountId"] });
export type StockDeliveryInput = z.input<typeof stockDeliverySchema>;

/** Before saving a purchase: does it look like one already entered (blueprint P0.3)? The supplier by id (formal receipt)
 * or by name (the stock hub's form); amounts are line totals in major units. */
export const purchaseDuplicateCheckSchema = z
  .object({
    supplierId: id.optional().nullable(),
    supplierName: z.string().trim().max(120).optional().nullable(),
    date: businessDate.optional(),
    lines: z.array(z.object({ variantId: id, amount: z.number().min(0).max(STOCK_PURCHASE_MAX_TOTAL) })).min(1).max(200),
  })
  .refine((p) => Boolean(p.supplierId) || Boolean(p.supplierName), "Name the supplier");
export type PurchaseDuplicateCheckInput = z.input<typeof purchaseDuplicateCheckSchema>;

/** Finishing a purchase stuck mid-way: optionally from another account (only while nothing has been paid for it). */
export const stockPurchaseFinishSchema = z.object({ paidFrom: paidFrom.optional() });
export type StockPurchaseFinishInput = z.input<typeof stockPurchaseFinishSchema>;

export const stockPurchaseListQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });

/** Why a count differs: a loss (DAMAGED, LOST, SAMPLE given away) or a gain / correction (FOUND, COUNT_FIX). */
export const STOCK_COUNT_REASONS = ["DAMAGED", "LOST", "SAMPLE", "FOUND", "COUNT_FIX"] as const;
export type StockCountReason = (typeof STOCK_COUNT_REASONS)[number];

/** Counted: what is on the shelf for each item; a shortfall needs a reason. `products`: products counted as a whole grid —
 * every active size and colour of each must then be on the sheet (0 when none), so a size left out is refused, not
 * silently kept at its old figure (inventory recovery F-c). */
export const stockCountsSchema = z.object({
  date: businessDate.optional(),
  products: z.array(id).max(100).optional(),
  lines: z
    .array(z.object({ variantId: id, counted: z.number().int().min(0).max(10_000_000), reason: z.enum(STOCK_COUNT_REASONS).optional().nullable(), note: optionalText(300) }))
    .min(1)
    .max(500)
    .refine(onceEach, "Each item once"),
});
export type StockCountsInput = z.input<typeof stockCountsSchema>;

/** The owner's stock value correction (docs/STOCK_HUB.md §12): what each item's units on hand are really worth a piece.
 * `commit` false = a preview, nothing written. */
export const stockValueCorrectionSchema = z.object({
  reason: z.string().trim().min(5).max(300),
  lines: z.array(z.object({ variantId: id, unitCost: financeAmountSchema.refine((v) => v >= 0, "Not below zero").refine((v) => v <= STOCK_PURCHASE_MAX_AMOUNT, "At most 1,000,000,000") })).min(1).max(100).refine(onceEach, "Each item once"),
  commit: z.boolean().default(false),
});
export type StockValueCorrectionInput = z.input<typeof stockValueCorrectionSchema>;

/** How a fill-to-order product sells past what is filled and makeable (inventory recovery phase 2): TRACKED — only what
 * is filled plus what the free materials can make; UNLIMITED — never blocks, each unit sold past the bottles is a costed
 * deficit filled later; BACKORDER — up to `backorderLimit` units per variant beyond that. Caps, clothing and every other
 * product that is not filled to order stay TRACKED. */
export const STOCK_POLICIES = ["TRACKED", "UNLIMITED", "BACKORDER"] as const;
export type StockPolicy = (typeof STOCK_POLICIES)[number];

export const stockPolicySchema = z
  .object({
    policy: z.enum(STOCK_POLICIES),
    backorderLimit: z.number().int().min(1).max(10_000).optional().nullable(),
    /** Per-variant overrides (null = follow the product). */
    variants: z.array(z.object({ variantId: id, policy: z.enum(STOCK_POLICIES).nullable() })).max(200).optional(),
    reason: z.string().trim().min(3).max(300),
  })
  .refine((p) => p.policy !== "BACKORDER" || (p.backorderLimit ?? 0) > 0, { message: "Say how many units may be sold before they are filled", path: ["backorderLimit"] })
  .refine((p) => !(p.variants ?? []).some((v) => v.policy === "BACKORDER") || (p.backorderLimit ?? 0) > 0, { message: "A size on backorder needs the backorder limit", path: ["backorderLimit"] });
export type StockPolicyInput = z.input<typeof stockPolicySchema>;

/** How a product is stocked: READY — sold from the shelf; FILLED_TO_ORDER — filled from its recipe as orders come (attar);
 * MATERIAL — used to make other products, never sold (only a product that has never been ordered). */
export const STOCKING_MODES = ["READY", "FILLED_TO_ORDER", "MATERIAL"] as const;
export type StockingMode = (typeof STOCKING_MODES)[number];

export const stockingSchema = z
  .object({
    mode: z.enum(STOCKING_MODES),
    /** The material's stock unit (ml, g, pcs…) — needed when it becomes a material. */
    stockUnit: z.string().trim().min(1).max(16).optional(),
    reason: z.string().trim().min(3).max(300),
  })
  .refine((s) => s.mode !== "MATERIAL" || !!s.stockUnit, { message: "Say the unit it is counted in (ml, g, pcs…)", path: ["stockUnit"] });
export type StockingInput = z.input<typeof stockingSchema>;

/**
 * Filled (inventory recovery phase 3): bottles filled from the approved recipe. `used`: what was really used of a material
 * when it differs from the recipe (it then becomes the bottles' cost). `wasted`: material spilt or spoilt on top of that —
 * it leaves stock too and is part of the bottles' cost, and needs `wasteReason`. Every quantity in the material's stock unit.
 */
export const stockFillSchema = z
  .object({
    variantId: id,
    quantity: z.number().int("Whole bottles").min(1).max(100_000),
    used: z.array(z.object({ materialVariantId: id, quantity: z.number().int().min(0).max(100_000_000) })).max(30).refine(materialOnce, "Each material once").optional(),
    wasted: z.array(z.object({ materialVariantId: id, quantity: z.number().int().min(1).max(100_000_000) })).max(30).refine(materialOnce, "Each material once").optional(),
    wasteReason: optionalText(300),
    note: optionalText(300),
  })
  .refine((f) => !(f.wasted ?? []).length || (f.wasteReason ?? "").length >= 3, { message: "Say why material was wasted (spilt, broken bottle…)", path: ["wasteReason"] });
export type StockFillInput = z.input<typeof stockFillSchema>;
