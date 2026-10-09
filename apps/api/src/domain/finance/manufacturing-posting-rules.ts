/**
 * Manufacturing posting rules (docs/MANUFACTURING.md §6–§9). Production documents that move stock post through the event
 * inbox in the same transaction as their stock and valuation. Mapping keys only; every work-in-progress line names the
 * production order as party, so an order's WIP is its party balance on the WIP account.
 *
 *   manufacturing.material_moved  ISSUE:  Dr asset.wip / Cr asset.inventory   (material out of stock into production)
 *                                 RETURN: Dr asset.inventory / Cr asset.wip   (unused material back to stock)
 *
 * Valuation differences (none for issues within stock) are posted by the costing engine, so inventory = valuation.
 */
import { z } from "zod";
import { registerPostingRule, type PostingRuleLine } from "./posting-rules";

export const MANUFACTURING_EVENT_TYPES = {
  materialMoved: "manufacturing.material_moved",
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
