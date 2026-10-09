/**
 * Manufacturing posting rules (docs/MANUFACTURING.md §6–§9). Production documents that move stock post through the event
 * inbox in the same transaction as their stock and valuation. Mapping keys only; every work-in-progress line names the
 * production order as party, so an order's WIP is its party balance on the WIP account.
 *
 *   manufacturing.material_moved  ISSUE:  Dr asset.wip / Cr asset.inventory   (material out of stock into production)
 *                                 RETURN: Dr asset.inventory / Cr asset.wip   (unused material back to stock)
 *   manufacturing.cost_accrued    Dr asset.wip / Cr liability.production_accrual (an approved production cost, until invoiced)
 *                                 a void revision (#r1) supersedes it — the accrual is reversed
 *
 * Valuation differences (none for issues within stock) are posted by the costing engine, so inventory = valuation.
 */
import { z } from "zod";
import { registerPostingRule, type PostingRuleLine } from "./posting-rules";

export const MANUFACTURING_EVENT_TYPES = {
  materialMoved: "manufacturing.material_moved",
  costAccrued: "manufacturing.cost_accrued",
} as const;

export const orderParty = (productionOrderId: string) => ({ partyType: "ProductionOrder", partyId: productionOrderId });

const materialMovedPayload = z.object({
  productionOrderId: z.string(),
  orderNumber: z.string(),
  kind: z.enum(["ISSUE", "RETURN"]),
  /** The moves this event books (one request). */
  moveIds: z.array(z.string()).min(1),
  valueMinor: z.number().int().nonnegative(),
  status: z.enum(["KNOWN", "ESTIMATED", "MISSING"]),
});
export type MaterialMovedPayload = z.infer<typeof materialMovedPayload>;

registerPostingRule(MANUFACTURING_EVENT_TYPES.materialMoved, 1, {
  payload: materialMovedPayload,
  build: (p) => {
    if (p.valueMinor === 0) return { ignore: "the moved material carried no value" };
    const party = orderParty(p.productionOrderId);
    const issue = p.kind === "ISSUE";
    const lines: PostingRuleLine[] = [
      { account: "asset.wip", debit: issue ? p.valueMinor : 0, credit: issue ? 0 : p.valueMinor, valuationStatus: p.status, memo: `${issue ? "Material issued to" : "Material returned from"} ${p.orderNumber}`, ...party },
      { account: "asset.inventory", debit: issue ? 0 : p.valueMinor, credit: issue ? p.valueMinor : 0, valuationStatus: p.status, memo: `${issue ? "Issued to" : "Returned from"} ${p.orderNumber}`, ...party },
    ];
    return { description: `${issue ? "Material issued" : "Material returned"} — ${p.orderNumber}`, reference: p.orderNumber, lines };
  },
});

const costAccruedPayload = z.object({
  entryId: z.string(),
  productionOrderId: z.string(),
  orderNumber: z.string(),
  category: z.string(),
  supplierId: z.string().nullable(),
  amountMinor: z.number().int().nonnegative(),
  void: z.boolean(),
  supersedes: z.string().nullable(),
});
export type CostAccruedPayload = z.infer<typeof costAccruedPayload>;

registerPostingRule(MANUFACTURING_EVENT_TYPES.costAccrued, 1, {
  payload: costAccruedPayload,
  build: (p) => {
    const reverses = p.supersedes ? [p.supersedes] : [];
    if (p.void) return { description: `Production cost voided — ${p.orderNumber}`, reference: p.orderNumber, lines: [], reverses };
    const accrualParty = p.supplierId ? { partyType: "Supplier", partyId: p.supplierId } : orderParty(p.productionOrderId);
    return {
      description: `Production cost (${p.category}) — ${p.orderNumber}`,
      reference: p.orderNumber,
      lines: [
        { account: "asset.wip", debit: p.amountMinor, credit: 0, valuationStatus: "KNOWN", memo: `${p.category} — ${p.orderNumber}`, ...orderParty(p.productionOrderId) },
        { account: "liability.production_accrual", debit: 0, credit: p.amountMinor, memo: `Accrued, not invoiced — ${p.orderNumber}`, ...accrualParty },
      ],
      reverses,
    };
  },
});
