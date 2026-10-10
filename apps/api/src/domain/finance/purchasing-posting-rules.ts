/**
 * Purchasing posting rules (Financial Core Phase 4D, docs/FINANCE_PHASE_4D.md). Stock documents post through the event
 * inbox, recorded in the same transaction as their stock and valuation (receiving is never blocked by a missing mapping —
 * the event waits FAILED and retryable). Mapping keys only; every line names the supplier as party.
 *
 *   purchasing.goods_received  Dr asset.inventory / Cr liability.grni           (the receipt's value)
 *     a reversal is a void revision (`#r1`) that supersedes it: the processor reverses the receipt's journal
 *   purchasing.return_shipped  Dr liability.supplier_returns / Cr asset.inventory (the value the stock left at)
 *
 * Deficit cover and other valuation differences are posted by the costing engine (inventory.valued → 5150), so the
 * inventory account always equals the valuation.
 */
import { z } from "zod";
import { registerPostingRule, type PostingRuleLine } from "./posting-rules";

export const PURCHASING_EVENT_TYPES = {
  received: "purchasing.goods_received",
  returnShipped: "purchasing.return_shipped",
} as const;

const minor = z.number().int().nonnegative();
const supplierParty = (supplierId: string) => ({ partyType: "Supplier", partyId: supplierId });

const receivedPayload = z.object({
  receiptId: z.string(),
  number: z.string(),
  supplierId: z.string(),
  valueMinor: minor,
  void: z.boolean(),
  supersedes: z.string().nullable(),
});
export type GoodsReceivedPayload = z.infer<typeof receivedPayload>;

registerPostingRule(PURCHASING_EVENT_TYPES.received, 1, {
  payload: receivedPayload,
  build: (p) => {
    const reverses = p.supersedes ? [p.supersedes] : [];
    if (p.void) return { description: `Goods receipt ${p.number} reversed`, reference: p.number, lines: [], reverses };
    if (p.valueMinor === 0) return reverses.length ? { description: `Goods receipt ${p.number}`, reference: p.number, lines: [], reverses } : { ignore: "receipt has no value" };
    const lines: PostingRuleLine[] = [
      { account: "asset.inventory", debit: p.valueMinor, credit: 0, valuationStatus: "KNOWN", memo: `Goods received ${p.number}`, ...supplierParty(p.supplierId) },
      { account: "liability.grni", debit: 0, credit: p.valueMinor, memo: `Received, not invoiced — ${p.number}`, ...supplierParty(p.supplierId) },
    ];
    return { description: `Goods receipt ${p.number}`, reference: p.number, lines, reverses };
  },
});

const returnPayload = z.object({ returnId: z.string(), number: z.string(), supplierId: z.string(), valueMinor: minor });
export type ReturnShippedPayload = z.infer<typeof returnPayload>;

registerPostingRule(PURCHASING_EVENT_TYPES.returnShipped, 1, {
  payload: returnPayload,
  build: (p) => {
    if (p.valueMinor === 0) return { ignore: "returned units carried no value" };
    return {
      description: `Supplier return ${p.number}`,
      reference: p.number,
      lines: [
        { account: "liability.supplier_returns", debit: p.valueMinor, credit: 0, memo: `Returned to supplier, not yet credited — ${p.number}`, ...supplierParty(p.supplierId) },
        { account: "asset.inventory", debit: 0, credit: p.valueMinor, valuationStatus: "KNOWN", memo: `Goods returned ${p.number}`, ...supplierParty(p.supplierId) },
      ],
    };
  },
});
