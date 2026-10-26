/**
 * Inventory valuation posting rule (Financial Core Phase 4B, docs/FINANCE_PHASE_4.md §9). The costing engine records one
 * `inventory.valued` event per valuation entry whose ledger effect isn't booked elsewhere; this rule turns it into journal
 * lines that name MAPPING KEYS only:
 *  - the movement's own value, when no other owner books it (manual adjustments, write-offs, count changes):
 *    Dr/Cr asset.inventory against cogs.inventory_shrinkage (damaged / lost) or cogs.count_adjustments (other counts);
 *    the owner's stock value correction against equity.opening_balance (a go-live value put right, not a sale);
 *  - the cost adjustment = valuation change − ledger change (deficit issue / cover, rounding at zero, a stale snapshot):
 *    Dr/Cr asset.inventory against cogs.cost_adjustments (5150) — so the ledger always equals the valuation.
 * Order-linked units are booked by the Phase 3 order accounting at the line snapshot; for them only the adjustment posts.
 */
import { z } from "zod";
import { FINANCE_VALUATION_STATUSES } from "@clothing-brand/shared";
import { registerPostingRule, type PostingRuleLine } from "./posting-rules";

/** One event per valuation entry whose ledger effect isn't booked elsewhere (recorded by costing.service). */
export const INVENTORY_VALUED_EVENT = "inventory.valued";

const payload = z.object({
  entryId: z.string(),
  movementId: z.string(),
  variantId: z.string(),
  reason: z.string(),
  orderId: z.string().nullable(),
  bookMinor: z.number().int(),
  /** `equity.opening_balance`: the owner's stock value correction (costing.service correctHeldValuesInTx). */
  counterKey: z.enum(["cogs.inventory_shrinkage", "cogs.count_adjustments", "cogs.packaging", "equity.opening_balance"]).nullable(),
  costAdjustmentMinor: z.number().int(),
  /** Of the adjustment, the change of the unbooked fill-to-order deficit (costing.service header): held off the inventory
   * account, so it is not posted — the ledger moves costAdjustment − this. */
  unbookedDeficitChangeMinor: z.number().int().optional(),
  status: z.enum(FINANCE_VALUATION_STATUSES),
  /** Of a stock decrease, the part that is goods already costed as sold outside the website (outside-stock.ts). */
  outsideReleaseMinor: z.number().int().positive().optional(),
});

/** Inventory up by `amount` (down when negative) against `other`. */
function inventoryAgainst(other: "cogs.inventory_shrinkage" | "cogs.count_adjustments" | "cogs.cost_adjustments" | "cogs.packaging" | "asset.inventory_sent_outside" | "equity.opening_balance", amount: number, status: PostingRuleLine["valuationStatus"], memo: string): PostingRuleLine[] {
  if (amount === 0) return [];
  const up = amount > 0;
  const a = Math.abs(amount);
  return [
    { account: "asset.inventory", debit: up ? a : 0, credit: up ? 0 : a, valuationStatus: status, memo },
    { account: other, debit: up ? 0 : a, credit: up ? a : 0, valuationStatus: status, memo },
  ];
}

registerPostingRule(INVENTORY_VALUED_EVENT, 1, {
  payload,
  build: (p) => {
    const release = p.counterKey && p.bookMinor < 0 ? Math.min(p.outsideReleaseMinor ?? 0, -p.bookMinor) : 0;
    const lines = [
      ...(p.counterKey ? inventoryAgainst(p.counterKey, p.bookMinor + release, p.status, `Stock ${p.reason.toLowerCase()}`) : []),
      ...(release ? inventoryAgainst("asset.inventory_sent_outside", -release, p.status, "Stock already costed as sold outside the website") : []),
      ...inventoryAgainst("cogs.cost_adjustments", p.costAdjustmentMinor - (p.unbookedDeficitChangeMinor ?? 0), p.status, "Inventory cost adjustment (valuation vs ledger)"),
    ];
    if (!lines.length) return { ignore: "nothing to post" };
    return { description: `Inventory valuation — ${p.reason.toLowerCase()} (entry ${p.entryId})`, reference: p.movementId, lines };
  },
});
