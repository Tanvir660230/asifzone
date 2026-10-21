/**
 * Posting rules of the owner's-books events (docs/FINANCE_OWNER_BOOKS.md). Like the commerce rules they name MAPPING KEYS
 * only, carry the order (or campaign) as party, and may supersede an earlier revision of the same fact.
 *
 *   courier charge estimated   Dr 6600 delivery & courier      Cr 2140 courier charges accrued   (party: the order)
 *   gateway fee estimated      Dr 6700 payment gateway fees    Cr 2145 gateway fees accrued      (party: the order)
 *   ad spend (a day)           Dr 6500 marketing & advertising  Cr the ad account                 (party: the campaign)
 *   prepaid share (a month)    Dr the cost's expense account    Cr 1720 prepaid expenses          (party: the prepaid cost)
 *
 * An estimate is withdrawn (a void revision reverses it) once the courier's or gateway's settlement for the order is
 * posted — the settlement books the ACTUAL charge, so the charge is never counted twice.
 */
import { z } from "zod";
import { registerPostingRule, type PostingRuleLine, type PostingRuleResult } from "./posting-rules";

export const OWNER_BOOKS_EVENT_TYPES = {
  courierCharge: "finance.courier.charge_estimated",
  gatewayFee: "finance.gateway.fee_estimated",
  adSpend: "finance.ads.spend",
  prepaidShare: "finance.prepaid.amortised",
} as const;

const minor = z.number().int();
const base = {
  semanticKey: z.string(),
  fp: z.string(),
  supersedes: z.string().nullable(),
  void: z.boolean(),
  orderId: z.string().nullable(),
  orderNumber: z.string().nullable(),
};
const party = (orderId: string | null) => (orderId ? { partyType: "Order", partyId: orderId } : {});

function voidOr(p: { void: boolean; supersedes: string | null }, description: string, build: () => PostingRuleLine[], reference?: string | null): PostingRuleResult {
  const reverses = p.supersedes ? [p.supersedes] : [];
  if (p.void) return { description: `Withdrawn: ${description}`, lines: [], reverses, reference };
  return { description, lines: build(), reverses, reference };
}

const courierChargePayload = z.object({
  ...base,
  consignmentId: z.string().nullable(),
  outcome: z.enum(["DELIVERED", "PARTIAL", "RETURNED"]),
  zone: z.string(),
  delivery: minor,
  cod: minor,
  returnCharge: minor,
  total: minor,
  cardId: z.string(),
});
registerPostingRule(OWNER_BOOKS_EVENT_TYPES.courierCharge, 1, {
  payload: courierChargePayload,
  build: (p) =>
    voidOr(p, `Courier charge (estimate, ${p.outcome.toLowerCase()}, ${p.zone}) — order ${p.orderNumber}`, () => [
      { account: "expense.courier_fees", debit: p.total, credit: 0, ...party(p.orderId), memo: `Estimated until the courier's payout: ${p.delivery ? `delivery ${p.delivery / 100}` : ""}${p.cod ? ` COD ${p.cod / 100}` : ""}${p.returnCharge ? `return ${p.returnCharge / 100}` : ""}`.trim() },
      { account: "liability.courier_charges_accrued", debit: 0, credit: p.total, ...party(p.orderId) },
    ], p.orderNumber),
});

const gatewayFeePayload = z.object({ ...base, paymentId: z.string(), provider: z.string(), amount: minor, fee: minor, rateId: z.string() });
registerPostingRule(OWNER_BOOKS_EVENT_TYPES.gatewayFee, 1, {
  payload: gatewayFeePayload,
  build: (p) =>
    voidOr(p, `Gateway fee (estimate, ${p.provider}) — order ${p.orderNumber}`, () => [
      { account: "expense.gateway_fees", debit: p.fee, credit: 0, ...party(p.orderId), memo: "Estimated until the gateway's settlement" },
      { account: "liability.gateway_fees_accrued", debit: 0, credit: p.fee, ...party(p.orderId) },
    ], p.orderNumber),
});

// ── ad spend: one campaign-day (§5.3) ─────────────────────────────────────────────────────────────────────────────────

const adSpendPayload = z.object({
  semanticKey: z.string(), fp: z.string(), supersedes: z.string().nullable(), void: z.boolean(),
  campaignId: z.string(), campaignName: z.string(), date: z.string(), amount: minor, basis: z.enum(["ACTUAL", "PLANNED"]), adAccountLedgerId: z.string(),
});
registerPostingRule(OWNER_BOOKS_EVENT_TYPES.adSpend, 1, {
  payload: adSpendPayload,
  build: (p) =>
    voidOr(p, `Ad spend ${p.date} — ${p.campaignName}${p.basis === "PLANNED" ? " (budget, until the actual spend is known)" : ""}`, () => [
      { account: "expense.advertising", debit: p.amount, credit: 0, partyType: "AdCampaign", partyId: p.campaignId, memo: p.basis === "PLANNED" ? "Planned from the budget" : "Actual spend" },
      { account: { accountId: p.adAccountLedgerId }, debit: 0, credit: p.amount, partyType: "AdCampaign", partyId: p.campaignId },
    ]),
});

// ── prepaid cost: one month's share (§6.1) ────────────────────────────────────────────────────────────────────────────

const prepaidPayload = z.object({
  semanticKey: z.string(), fp: z.string(), supersedes: z.string().nullable(), void: z.boolean(),
  prepaidId: z.string(), name: z.string(), period: z.string(), amount: minor, expenseAccountId: z.string(),
});
registerPostingRule(OWNER_BOOKS_EVENT_TYPES.prepaidShare, 1, {
  payload: prepaidPayload,
  build: (p) =>
    voidOr(p, `${p.name} — share for ${p.period}`, () => [
      { account: { accountId: p.expenseAccountId }, debit: p.amount, credit: 0, partyType: "PrepaidCost", partyId: p.prepaidId },
      { account: "asset.prepaid", debit: 0, credit: p.amount, partyType: "PrepaidCost", partyId: p.prepaidId },
    ]),
});

// ── landed cost: transport / labour / customs added to the goods it brought in (§7.1) ─────────────────────────────────

export const LANDED_COST_EVENT = "finance.landed_cost.allocated";
const landedPayload = z.object({ landedCostId: z.string(), number: z.string(), amount: minor });
registerPostingRule(LANDED_COST_EVENT, 1, {
  payload: landedPayload,
  build: (p) => ({
    description: `Landed cost ${p.number} added to the goods it brought in`,
    reference: p.number,
    lines: [
      { account: "asset.inventory", debit: p.amount, credit: 0, valuationStatus: "KNOWN", partyType: "LandedCost", partyId: p.landedCostId },
      { account: "liability.landed_cost_clearing", debit: 0, credit: p.amount, partyType: "LandedCost", partyId: p.landedCostId },
    ],
  }),
});

export const LANDED_COST_REVERSED_EVENT = "finance.landed_cost.reversed";
registerPostingRule(LANDED_COST_REVERSED_EVENT, 1, {
  payload: landedPayload,
  build: (p) => ({
    description: `Landed cost ${p.number} cancelled — taken back off the goods`,
    reference: p.number,
    lines: [
      { account: "liability.landed_cost_clearing", debit: p.amount, credit: 0, partyType: "LandedCost", partyId: p.landedCostId },
      { account: "asset.inventory", debit: 0, credit: p.amount, valuationStatus: "KNOWN", partyType: "LandedCost", partyId: p.landedCostId },
    ],
  }),
});

// ── courier claims for lost parcels (§3.5) ────────────────────────────────────────────────────────────────────────────

export const COURIER_CLAIM_EVENTS = {
  opened: "finance.courier_claim.opened",
  viaPayout: "finance.courier_claim.paid_in_payout",
  writtenOff: "finance.courier_claim.written_off",
} as const;
const claimPayload = z.object({ claimId: z.string(), number: z.string(), orderId: z.string(), orderNumber: z.string(), amount: minor });
registerPostingRule(COURIER_CLAIM_EVENTS.opened, 1, {
  payload: claimPayload,
  build: (p) => ({
    description: `Courier claim ${p.number} — lost parcel, order ${p.orderNumber}`,
    reference: p.number,
    lines: [
      { account: "asset.courier_claims", debit: p.amount, credit: 0, partyType: "Order", partyId: p.orderId },
      { account: "cogs.inventory_shrinkage", debit: 0, credit: p.amount, partyType: "Order", partyId: p.orderId, memo: "Recovery claimed for goods lost in delivery" },
    ],
  }),
});
registerPostingRule(COURIER_CLAIM_EVENTS.viaPayout, 1, {
  payload: claimPayload,
  build: (p) => ({
    description: `Courier claim ${p.number} paid inside a payout — order ${p.orderNumber}`,
    reference: p.number,
    lines: [
      { account: "expense.settlement_adjustments", debit: p.amount, credit: 0, memo: "The payout's extra was this claim" },
      { account: "asset.courier_claims", debit: 0, credit: p.amount, partyType: "Order", partyId: p.orderId },
    ],
  }),
});
registerPostingRule(COURIER_CLAIM_EVENTS.writtenOff, 1, {
  payload: claimPayload,
  build: (p) => ({
    description: `Courier claim ${p.number} not paid — written off (order ${p.orderNumber})`,
    reference: p.number,
    lines: [
      { account: "cogs.inventory_shrinkage", debit: p.amount, credit: 0, partyType: "Order", partyId: p.orderId, memo: "Part of a courier claim never paid" },
      { account: "asset.courier_claims", debit: 0, credit: p.amount, partyType: "Order", partyId: p.orderId },
    ],
  }),
});

// ── expense allocation: a cost paid into 6990 split to where it belongs (docs/FINANCE_CENTER.md) ──────────────────────

export const EXPENSE_ALLOCATED_EVENT = "finance.expense.allocated";
const allocationPayload = z.object({
  ...{ semanticKey: z.string(), fp: z.string(), supersedes: z.string().nullable(), void: z.boolean() },
  expenseId: z.string(),
  number: z.string(),
  description: z.string(),
  lines: z.array(z.object({ accountId: z.string(), productId: z.string().nullable(), amount: minor, note: z.string().nullable() })),
});
registerPostingRule(EXPENSE_ALLOCATED_EVENT, 1, {
  payload: allocationPayload,
  build: (p) =>
    voidOr(p, `${p.number} split — ${p.description}`, () => [
      ...p.lines.map((l) => ({ account: { accountId: l.accountId }, debit: l.amount, credit: 0, memo: l.note, ...(l.productId ? { partyType: "Product", partyId: l.productId } : { partyType: "Expense", partyId: p.expenseId }) })),
      { account: "expense.unallocated" as const, debit: 0, credit: p.lines.reduce((s, l) => s + l.amount, 0), partyType: "Expense", partyId: p.expenseId },
    ], p.number),
});
