/**
 * Posting rules of the commerce accounting events (Financial Core Phase 3, docs/FINANCE_PHASE_3.md §4). The projector
 * (commerce-accounting.service.ts) records one event per commerce fact, with amounts taken from the dashboard's own
 * engine; these rules turn each into journal lines that name MAPPING KEYS only. Every line carries the order as its
 * party, so the ledger can be reconciled order by order.
 *
 * The receivable is the hub of an order: recognition debits it with what the order charges; payments credit it from the
 * clearing account of their provider; refunds debit it back and credit where the money went. For an exchange replacement
 * (never a sale of its own) the hub is "exchange price differences" instead.
 *
 * Every event may supersede an earlier revision of the same fact (`supersedes`): the processor reverses that one first.
 * A `void` revision only reverses (the fact no longer exists).
 */
import { z } from "zod";
import type { AccountMappingKey } from "@clothing-brand/shared";
import { registerPostingRule, type PostingRuleLine, type PostingRuleResult } from "./posting-rules";

export const COMMERCE_EVENT_TYPES = {
  recognised: "commerce.order.recognised",
  reversed: "commerce.order.recognition_reversed",
  payment: "commerce.payment.received",
  returnCharge: "commerce.return_charge.received",
  refund: "commerce.refund.completed",
  returned: "commerce.return.restocked",
  writtenOff: "commerce.return.written_off",
  credit: "commerce.store_credit.entry",
  stockWriteOff: "finance.stock.write_off_estimated",
  salesReturn: "commerce.return.sales_return",
  // Blueprint P0.4 (tab 11 §4): restock only at receipt.
  awaiting: "commerce.return.awaiting",
  received: "commerce.return.received",
  receivedDamaged: "commerce.return.received_damaged",
  notReturned: "commerce.return.not_returned",
  replacementCost: "commerce.exchange.replacement_cost",
  uncollected: "commerce.order.uncollected_written_off",
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

/** The clearing account a payment of each provider lands in (store credit spent on an order leaves the reserved balance). */
export const PROVIDER_CLEARING: Record<string, AccountMappingKey> = {
  COD: "clearing.cod",
  SSLCOMMERZ: "clearing.gateway.sslcommerz",
  EPS_PG: "clearing.gateway.eps",
  MANUAL: "clearing.manual_receipts",
  STORE_CREDIT: "liability.store_credit_reserved",
};

const party = (orderId: string | null) => (orderId ? { partyType: "Order", partyId: orderId } : {});
/** A line on the credit side for a positive amount, on the debit side for a negative one (a negative adjustment). */
function credit(account: AccountMappingKey, amount: number, extra: Partial<PostingRuleLine> = {}): PostingRuleLine {
  return amount >= 0 ? { account, debit: 0, credit: amount, ...extra } : { account, debit: -amount, credit: 0, ...extra };
}
function debit(account: AccountMappingKey, amount: number, extra: Partial<PostingRuleLine> = {}): PostingRuleLine {
  return amount >= 0 ? { account, debit: amount, credit: 0, ...extra } : { account, debit: 0, credit: -amount, ...extra };
}
const mirror = (lines: PostingRuleLine[]): PostingRuleLine[] => lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit }));
const hub = (exchange: boolean): AccountMappingKey => (exchange ? "revenue.exchange_differences" : "asset.receivable_trade");

function voidOr(p: { void: boolean; supersedes: string | null }, description: string, build: () => PostingRuleLine[], reference?: string | null): PostingRuleResult {
  const reverses = p.supersedes ? [p.supersedes] : [];
  if (p.void) return { description: `Withdrawn: ${description}`, lines: [], reverses, reference };
  return { description, lines: build(), reverses, reference };
}

// ── order recognition (the dashboard's realisation moment) ─────────────────────────────────────────────────────────

const costLine = z.object({ orderItemId: z.string(), sku: z.string(), quantity: z.number().int(), unitCost: minor, amount: minor, status: z.enum(["KNOWN", "ESTIMATED"]) });
export const recognitionComponents = z.object({
  /** Realised merchandise excluding VAT — exactly the positive part of realised_net_sales. */
  merchandise: minor,
  vat: minor,
  /** Shipping and any other charge: what the order total holds beyond merchandise, VAT and price adjustment. */
  shipping: minor,
  adjustment: minor,
  /** What the order charges (its total). */
  receivable: minor,
  cogs: z.array(costLine),
});
export type RecognitionComponents = z.infer<typeof recognitionComponents>;

export function recognitionLines(c: RecognitionComponents, orderId: string | null): PostingRuleLine[] {
  const pty = party(orderId);
  const lines: PostingRuleLine[] = [
    debit("asset.receivable_trade", c.receivable, pty),
    credit("revenue.merchandise", c.merchandise, pty),
    credit("liability.vat_output", c.vat, pty),
    credit("revenue.shipping", c.shipping, pty),
    credit("revenue.price_adjustments", c.adjustment, pty),
  ];
  for (const status of ["KNOWN", "ESTIMATED"] as const) {
    const amount = c.cogs.filter((l) => l.status === status).reduce((s, l) => s + l.amount, 0);
    if (!amount) continue;
    lines.push({ account: "cogs.goods", debit: amount, credit: 0, valuationStatus: status, ...pty, memo: `${status === "KNOWN" ? "Recorded" : "Approved estimated"} cost of units sold` });
    lines.push({ account: "asset.inventory", debit: 0, credit: amount, valuationStatus: status, ...pty });
  }
  return lines;
}

const recognisedPayload = z.object({ ...base, paymentMethod: z.string(), components: recognitionComponents, missingCost: z.array(z.object({ orderItemId: z.string(), sku: z.string(), quantity: z.number().int() })) });
registerPostingRule(COMMERCE_EVENT_TYPES.recognised, 1, {
  payload: recognisedPayload,
  build: (p) => voidOr(p, `Sale recognised — order ${p.orderNumber}`, () => recognitionLines(p.components, p.orderId), p.orderNumber),
});

// ── refunds (cash part always; revenue part when the dashboard counts it) ──────────────────────────────────────────

const refundRevenue = z.object({ merchandiseExVat: minor, merchandiseVat: minor, other: minor });
export function refundRevenueLines(r: z.infer<typeof refundRevenue>, orderId: string | null, exchange: boolean): PostingRuleLine[] {
  const pty = party(orderId);
  return [
    debit("revenue.returns_refunds", r.merchandiseExVat, pty),
    debit("liability.vat_output", r.merchandiseVat, pty),
    debit("revenue.other_refunds", r.other, pty),
    credit(hub(exchange), r.merchandiseExVat + r.merchandiseVat + r.other, pty),
  ];
}

const refundPayload = z.object({
  ...base,
  refundId: z.string(),
  amount: minor,
  moneySide: z.string(),
  exchange: z.boolean(),
  /** null when the dashboard does not count a revenue part (before realisation, after a cancellation, overpayment only). */
  revenue: refundRevenue.nullable(),
  allocation: z.object({ overpayment: minor, merchandise: minor, merchandiseExVat: minor, other: minor }),
});
registerPostingRule(COMMERCE_EVENT_TYPES.refund, 1, {
  payload: refundPayload,
  build: (p) =>
    voidOr(p, `Refund — order ${p.orderNumber}`, () => [
      debit(hub(p.exchange), p.amount, party(p.orderId)),
      credit(p.moneySide as AccountMappingKey, p.amount, party(p.orderId)),
      ...(p.revenue ? refundRevenueLines(p.revenue, p.orderId, p.exchange) : []),
    ], p.orderNumber),
});

// ── returns into stock (COGS reversed at the recorded cost) and damaged units written off ─────────────────────────

const valuation = z.enum(["KNOWN", "ESTIMATED"]);
const returnPayload = z.object({ ...base, movementId: z.string(), variantId: z.string(), units: z.number().int(), cost: minor, status: valuation });
registerPostingRule(COMMERCE_EVENT_TYPES.returned, 1, {
  payload: returnPayload,
  build: (p) =>
    voidOr(p, `Returned to stock — order ${p.orderNumber} (${p.units} unit(s))`, () => [
      { account: "asset.inventory", debit: p.cost, credit: 0, valuationStatus: p.status, ...party(p.orderId) },
      { account: "cogs.goods", debit: 0, credit: p.cost, valuationStatus: p.status, ...party(p.orderId), memo: p.status === "KNOWN" ? "Recorded cost of returned units" : "Approved estimated cost of returned units" },
    ], p.orderNumber),
});

// ── Blueprint P0.4: restock only at receipt (owner decisions Q5, Q13, Q13b, Q-A, Q-B, Q-C; tab 11 §4) ───────────────────
// A return agreed under the store's returns rule takes the cost out of COGS at the agreement (S1) and holds it as Goods
// awaiting return (1620) until the goods are received (S2, into inventory; S3, damaged ones then out to shrinkage) or
// written off as never returned (S7, shrinkage). Either 1620 or inventory holds a returned unit's cost — never both.

const agreedPayload = z.object({ ...base, expectationId: z.string(), orderItemId: z.string(), variantId: z.string(), units: z.number().int(), cost: minor, status: valuation });
registerPostingRule(COMMERCE_EVENT_TYPES.awaiting, 1, {
  payload: agreedPayload,
  build: (p) =>
    voidOr(p, `Return agreed, goods awaiting return — order ${p.orderNumber} (${p.units} unit(s))`, () => [
      { account: "asset.goods_awaiting_return", debit: p.cost, credit: 0, valuationStatus: p.status, ...party(p.orderId) },
      { account: "cogs.goods", debit: 0, credit: p.cost, valuationStatus: p.status, ...party(p.orderId), memo: "Cost of units agreed back, not received yet" },
    ], p.orderNumber),
});

const receiptPayload = z.object({ ...base, expectationId: z.string(), movementId: z.string(), units: z.number().int(), cost: minor, status: valuation });
registerPostingRule(COMMERCE_EVENT_TYPES.received, 1, {
  payload: receiptPayload,
  build: (p) =>
    voidOr(p, `Return received into stock — order ${p.orderNumber} (${p.units} unit(s))`, () => [
      { account: "asset.inventory", debit: p.cost, credit: 0, valuationStatus: p.status, ...party(p.orderId) },
      { account: "asset.goods_awaiting_return", debit: 0, credit: p.cost, valuationStatus: p.status, ...party(p.orderId) },
    ], p.orderNumber),
});
registerPostingRule(COMMERCE_EVENT_TYPES.receivedDamaged, 1, {
  payload: receiptPayload,
  build: (p) =>
    voidOr(p, `Return received damaged, written off — order ${p.orderNumber} (${p.units} unit(s))`, () => [
      { account: "cogs.inventory_shrinkage", debit: p.cost, credit: 0, valuationStatus: p.status, ...party(p.orderId), memo: "Returned damaged, at its recorded cost" },
      { account: "asset.inventory", debit: 0, credit: p.cost, valuationStatus: p.status, ...party(p.orderId) },
    ], p.orderNumber),
});

const lostPayload = z.object({ ...base, expectationId: z.string(), units: z.number().int(), cost: minor, status: valuation, reason: z.string() });
registerPostingRule(COMMERCE_EVENT_TYPES.notReturned, 1, {
  payload: lostPayload,
  build: (p) =>
    voidOr(p, `Never returned, written off — order ${p.orderNumber} (${p.units} unit(s)): ${p.reason}`, () => [
      { account: "cogs.inventory_shrinkage", debit: p.cost, credit: 0, valuationStatus: p.status, ...party(p.orderId), memo: "Agreed back, never returned" },
      { account: "asset.goods_awaiting_return", debit: 0, credit: p.cost, valuationStatus: p.status, ...party(p.orderId) },
    ], p.orderNumber),
});

// S5: an exchange replacement under the rule is costed when delivered (its original's cost left COGS at the approval).
const replacementPayload = z.object({ ...base, lines: z.array(z.object({ orderItemId: z.string(), units: z.number().int(), cost: minor, status: valuation })) });
registerPostingRule(COMMERCE_EVENT_TYPES.replacementCost, 1, {
  payload: replacementPayload,
  build: (p) =>
    voidOr(p, `Exchange replacement delivered — order ${p.orderNumber}`, () =>
      p.lines.flatMap((l) => [
        { account: "cogs.goods" as AccountMappingKey, debit: l.cost, credit: 0, valuationStatus: l.status, ...party(p.orderId), memo: "Cost of the exchange replacement" },
        { account: "asset.inventory" as AccountMappingKey, debit: 0, credit: l.cost, valuationStatus: l.status, ...party(p.orderId) },
      ]), p.orderNumber),
});

const writeOffPayload = z.object({ ...base, returnRequestId: z.string(), orderItemId: z.string(), units: z.number().int(), cost: minor, status: valuation });
registerPostingRule(COMMERCE_EVENT_TYPES.writtenOff, 1, {
  payload: writeOffPayload,
  build: (p) =>
    voidOr(p, `Returned damaged, written off — order ${p.orderNumber} (${p.units} unit(s))`, () => [
      { account: "cogs.inventory_shrinkage", debit: p.cost, credit: 0, valuationStatus: p.status, ...party(p.orderId), memo: "Damaged return at its recorded cost" },
      { account: "asset.inventory", debit: 0, credit: p.cost, valuationStatus: p.status, ...party(p.orderId) },
    ], p.orderNumber),
});

// ── an approved item return: goods the order no longer charges (PAYMENT_LEDGER §5c) ────────────────────────────────
// A sales return whether or not money goes back — a partial delivery's rejected items never are paid for. The receivable
// falls by what the order stops charging; a later refund of that money is then overpayment (no second revenue part).

const salesReturnRevenue = z.object({ merchandiseExVat: minor, vat: minor, other: minor });
export function salesReturnLines(r: z.infer<typeof salesReturnRevenue>, orderId: string | null, exchange: boolean): PostingRuleLine[] {
  const pty = party(orderId);
  return [
    debit("revenue.returns_refunds", r.merchandiseExVat, pty),
    debit("liability.vat_output", r.vat, pty),
    debit("revenue.other_refunds", r.other, pty),
    credit(hub(exchange), r.merchandiseExVat + r.vat + r.other, pty),
  ];
}
const salesReturnPayload = z.object({ ...base, returnRequestId: z.string(), value: minor, exchange: z.boolean(), revenue: salesReturnRevenue });
registerPostingRule(COMMERCE_EVENT_TYPES.salesReturn, 1, {
  payload: salesReturnPayload,
  build: (p) => voidOr(p, `Items returned, no longer charged — order ${p.orderNumber}`, () => salesReturnLines(p.revenue, p.orderId, p.exchange), p.orderNumber),
});

// ── a returned order's charge nobody will pay (the payment position: a returned order owes nothing more) ──────────

const uncollectedPayload = z.object({ ...base, amount: minor });
registerPostingRule(COMMERCE_EVENT_TYPES.uncollected, 1, {
  payload: uncollectedPayload,
  build: (p) =>
    voidOr(p, `Order returned — charge not collected, written off — order ${p.orderNumber}`, () => [
      { account: "revenue.other_refunds", debit: p.amount, credit: 0, ...party(p.orderId), memo: "Delivery and other charges the returned order never collected" },
      { account: "asset.receivable_trade", debit: 0, credit: p.amount, ...party(p.orderId) },
    ], p.orderNumber),
});

// ── order realisation reversed by a later cancellation (the dashboard's P5-2 reversal) ────────────────────────────

const reversalPayload = z.object({
  ...base,
  recognition: recognitionComponents,
  exchange: z.boolean(),
  refunds: z.array(z.object({ refundId: z.string(), revenue: refundRevenue })),
  /** `awaiting`: an agreed return under the receipt rule (its cost went to goods awaiting return, not inventory). */
  returns: z.array(z.object({ movementId: z.string(), cost: minor, status: valuation, awaiting: z.boolean().optional() })),
  /** Sales returns before the cancellation (absent on reversals recorded before they existed). */
  salesReturns: z.array(z.object({ returnRequestId: z.string(), revenue: salesReturnRevenue })).optional(),
});
registerPostingRule(COMMERCE_EVENT_TYPES.reversed, 1, {
  payload: reversalPayload,
  build: (p) =>
    voidOr(p, `Sale reversed by cancellation — order ${p.orderNumber}`, () => [
      ...mirror(recognitionLines(p.recognition, p.orderId)),
      ...p.refunds.flatMap((r) => mirror(refundRevenueLines(r.revenue, p.orderId, p.exchange))),
      ...(p.salesReturns ?? []).flatMap((r) => mirror(salesReturnLines(r.revenue, p.orderId, p.exchange))),
      ...p.returns.flatMap((r) => [
        { account: "cogs.goods" as AccountMappingKey, debit: r.cost, credit: 0, valuationStatus: r.status, ...party(p.orderId) },
        { account: (r.awaiting ? "asset.goods_awaiting_return" : "asset.inventory") as AccountMappingKey, debit: 0, credit: r.cost, valuationStatus: r.status, ...party(p.orderId) },
      ]),
    ], p.orderNumber),
});

// ── customer payments into clearing ────────────────────────────────────────────────────────────────────────────────

const paymentPayload = z.object({ ...base, paymentId: z.string(), provider: z.string(), amount: minor, exchange: z.boolean() });
registerPostingRule(COMMERCE_EVENT_TYPES.payment, 1, {
  payload: paymentPayload,
  build: (p) =>
    voidOr(p, `Payment received (${p.provider}) — order ${p.orderNumber}`, () => {
      const into = PROVIDER_CLEARING[p.provider];
      if (!into) throw new Error(`No clearing account for payment provider ${p.provider}`);
      return [debit(into, p.amount, party(p.orderId)), credit(hub(p.exchange), p.amount, party(p.orderId))];
    }, p.orderNumber),
});

// ── a refused parcel's return charge (docs/PAYMENT_LEDGER.md §5a) ────────────────────────────────────────────────────
// Not order money: it never touches the receivable. It lands in its provider's clearing and recovers courier cost — a
// credit to delivery & courier expense, so the expense shows what the courier cost net of what customers paid back.

registerPostingRule(COMMERCE_EVENT_TYPES.returnCharge, 1, {
  payload: paymentPayload,
  build: (p) =>
    voidOr(p, `Return charge received (${p.provider}) — order ${p.orderNumber}`, () => {
      const into = PROVIDER_CLEARING[p.provider];
      if (!into) throw new Error(`No clearing account for payment provider ${p.provider}`);
      return [debit(into, p.amount, party(p.orderId)), credit("expense.courier_fees", p.amount, party(p.orderId))];
    }, p.orderNumber),
});

// ── store credit (a liability to the customer) ─────────────────────────────────────────────────────────────────────

const creditPayload = z.object({
  ...base,
  entryId: z.string(),
  creditType: z.string(),
  customerId: z.string(),
  /** Signed, as the credit ledger records it. */
  amount: minor,
  exchange: z.boolean(),
  /** Issuance only: the part that settles money the order already owes the customer, and the part that is a return. */
  receivablePart: minor,
  returnPart: minor,
});
registerPostingRule(COMMERCE_EVENT_TYPES.credit, 1, {
  payload: creditPayload,
  build: (p) =>
    voidOr(p, `Store credit ${p.creditType.toLowerCase().replace(/_/g, " ")}${p.orderNumber ? ` — order ${p.orderNumber}` : ""}`, () => {
      const pty = p.orderId ? party(p.orderId) : { partyType: "Customer", partyId: p.customerId };
      if (p.creditType === "ORDER_PAYMENT") return [debit("liability.store_credit", -p.amount, pty), credit("liability.store_credit_reserved", -p.amount, pty)];
      if (p.creditType === "ORDER_PAYMENT_RELEASED") return [debit("liability.store_credit_reserved", p.amount, pty), credit("liability.store_credit", p.amount, pty)];
      return [
        debit(hub(p.exchange), p.receivablePart, pty),
        debit("revenue.store_credit_returns", p.returnPart, pty),
        credit("liability.store_credit", p.amount, pty),
      ];
    }),
});

// ── an approved estimate for a stock write-off with no recorded cost (finance exception resolution) ───────────────

const stockWriteOffPayload = z.object({
  ...base, exceptionId: z.string(), movementId: z.string(), variantId: z.string(), units: z.number().int(), cost: minor, reason: z.string(),
  /** The part that is goods already costed as sold outside the website (outside-stock.ts). */
  outsideReleaseMinor: z.number().int().positive().optional(),
});
registerPostingRule(COMMERCE_EVENT_TYPES.stockWriteOff, 1, {
  payload: stockWriteOffPayload,
  build: (p) => {
    const release = Math.min(p.outsideReleaseMinor ?? 0, p.cost);
    return voidOr(p, `Stock written off at an approved estimate (${p.units} unit(s))`, () => [
      { account: "cogs.inventory_shrinkage", debit: p.cost - release, credit: 0, valuationStatus: "ESTIMATED", memo: p.reason },
      ...(release ? [{ account: "asset.inventory_sent_outside" as AccountMappingKey, debit: release, credit: 0, valuationStatus: "ESTIMATED" as const, memo: "Stock already costed as sold outside the website" }] : []),
      { account: "asset.inventory", debit: 0, credit: p.cost, valuationStatus: "ESTIMATED" },
    ]);
  },
});
