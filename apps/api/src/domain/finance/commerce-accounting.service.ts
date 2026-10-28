/**
 * The commerce → ledger projector (Financial Core Phase 3, docs/FINANCE_PHASE_3.md §2–§5).
 *
 * It reads an order exactly as the dashboard does — the metrics fact loader (loadOrderFacts) and the engine's own
 * producers (realisedMerch, merchRefunds, cogsSold, cogsReturned) — and records, through the Phase 1 event inbox, one
 * financial event per commerce fact:
 *   recognition at the dashboard's realisation moment (COD: first delivery; online: first successful payment),
 *   its reversal at a later cancellation, each payment, each completed refund, each return into stock, each damaged unit
 *   written off, each store-credit entry.
 * It never writes a commerce table and emits no commerce event.
 *
 * Desired state, revised by supersession: every fact has a semantic key (`order:<id>:refund:<refundId>`, …); its events
 * are revisions `<key>#r<n>`. A run computes each fact's payload and fingerprint; when the latest revision already has it,
 * nothing happens (a re-run, a retry, a concurrent run: exactly once). When commerce changed a fact after it was posted, a
 * new revision supersedes the old (reversal + new journal). When a fact disappeared, a void revision reverses it.
 *
 * The books start at the Financial Opening Date: a fact dated before it is not posted (the opening balances carry it).
 * Nothing is projected until the opening balances are posted, so choosing the date never posts a sale (and locks the
 * date) by itself; the first sweep after posting catches every fact from the opening date up.
 * Missing costs are never invented: the line opens a MISSING_COST exception and no cost is booked for it, unless an
 * approved estimate (APPROVED_ESTIMATES policy) resolved it — then it is booked, labelled ESTIMATED.
 */
import { createHash, randomUUID } from "node:crypto";
import type { CustomerCreditEntry, FinancialEvent, Prisma } from "@prisma/client";
import { businessDate, orderContributions, realisationOf, refundAllocations, returnAllocations, returnEvents, type OrderFact } from "@clothing-brand/shared";
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { installId } from "../../config/installation";
import { loadOrderFacts } from "../metrics/facts.repository";
import { type FinanceActor } from "./finance-audit";
import { getFinanceContext, type FinanceContext } from "./finance-context";
import { financeTransaction } from "./finance-tx";
import { financeError, toMinor } from "./finance-values";
import { processFinancialEvent, recordFinancialEvent } from "./events.service";
import { COMMERCE_EVENT_TYPES, PROVIDER_CLEARING, type RecognitionComponents } from "./commerce-posting-rules";
import { markEstimateApproved, upsertException, type ExceptionSpec } from "./finance-exceptions.service";
import { commerceReadiness, ensureCommerceAccountingInTx } from "./commerce-setup.service";
import { chargeEstimatesForOrder, loadRateCards } from "./charge-projection";
import { ensureOwnerBooksSetupInTx } from "./owner-books-setup.service";
import { OUTSIDE_RELEASE_REASONS, outsideReleaseInTx } from "./outside-stock";
import { ESTIMATE_SOURCE_LABEL, estimateUnitCosts } from "./cost-estimate";

export const PROJECTOR_ACTOR: FinanceActor = { type: "SYSTEM", label: "system:commerce-projector" };

export interface Desired {
  semanticKey: string;
  type: string;
  at: Date;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
}
export interface DatedException extends ExceptionSpec {
  at: Date;
}

const GATEWAYS = new Set(["SSLCOMMERZ", "EPS_PG"]);
const ISSUANCE = new Set(["CANCELLATION", "ORDER_MODIFICATION", "RETURN", "EXCHANGE", "REFUND_TO_CREDIT"]);
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const stable = (v: unknown) =>
  JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
const fingerprint = (d: Desired) => createHash("sha256").update(stable({ type: d.type, at: d.at.toISOString(), payload: d.payload })).digest("hex").slice(0, 24);

export interface OrderExtras {
  /** Refund id → the provider of the payment it refunds (null when it names none). */
  refundPayment: Map<string, string | null>;
  /** Item-level returns with written-off (damaged) units. */
  returnRequests: Array<{ id: string; at: Date; lines: Array<{ orderItemId: string; writtenOff: number }> }>;
  /** The order's store-credit entries, signed minor units. */
  credits: Array<{ id: string; type: string; customerId: string; amount: number; at: Date }>;
  /** Approved estimated unit cost (minor) per order line. */
  estimates: Map<string, number>;
  /** Current catalog cost per variant (minor) — only ever a suggestion on an exception, never booked. */
  suggested: Map<string, number>;
  /** When an order that is RETURNED now became so (its last move to RETURNED); null otherwise. */
  returnedAt?: Date | null;
}

async function loadExtras(o: OrderFact, ctx: FinanceContext): Promise<OrderExtras> {
  const cur = ctx.business.baseCurrency;
  const [refunds, rrs, credits, estimates, variants, returned] = await Promise.all([
    prisma.refund.findMany({ where: { orderId: o.id }, select: { id: true, payment: { select: { provider: true } } } }),
    prisma.returnRequest.findMany({ where: { orderId: o.id, type: "RETURN", status: "APPROVED" }, select: { id: true, lines: true, reviewedAt: true, createdAt: true } }),
    prisma.customerCreditEntry.findMany({ where: { orderId: o.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    prisma.financeException.findMany({
      where: { businessId: ctx.business.id, orderId: o.id, kind: "MISSING_COST", resolution: "ESTIMATE_APPROVED", key: { startsWith: "cost:line:" } },
      select: { key: true, estimatedUnitCost: true },
    }),
    prisma.productVariant.findMany({ where: { id: { in: o.lines.map((l) => l.variantId) } }, select: { id: true, costPrice: true, product: { select: { costPrice: true } } } }),
    o.status === "RETURNED" ? prisma.orderStatusHistory.findFirst({ where: { orderId: o.id, status: "RETURNED" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }) : null,
  ]);
  return {
    returnedAt: returned?.createdAt ?? null,
    refundPayment: new Map(refunds.map((r) => [r.id, r.payment?.provider ?? null])),
    returnRequests: rrs
      .filter((r) => Array.isArray(r.lines))
      .map((r) => ({
        id: r.id,
        at: r.reviewedAt ?? r.createdAt,
        lines: (r.lines as Array<{ orderItemId?: string; writtenOff?: number }>)
          .filter((l) => l.orderItemId && (l.writtenOff ?? 0) > 0)
          .map((l) => ({ orderItemId: l.orderItemId!, writtenOff: l.writtenOff! })),
      })),
    credits: credits.map((c) => ({ id: c.id, type: c.type, customerId: c.customerId, amount: signedMinor(c.amount, cur), at: c.createdAt })),
    estimates: new Map(estimates.filter((e) => e.estimatedUnitCost).map((e) => [e.key.slice("cost:line:".length), toMinor(e.estimatedUnitCost!, cur)])),
    suggested: new Map(variants.map((v) => [v.id, toMinor(v.costPrice ?? v.product.costPrice ?? 0, cur)])),
  };
}

function signedMinor(v: Prisma.Decimal | number | string, cur: string): number {
  const s = v.toString();
  return s.startsWith("-") ? -toMinor(s.slice(1), cur) : toMinor(s, cur);
}

/** The order's facts as accounting events (amounts from the dashboard engine) and the exceptions they raise. Pure. */
export function desiredForOrder(o: OrderFact, x: OrderExtras): { events: Desired[]; exceptions: DatedException[] } {
  const events: Desired[] = [];
  const exceptions: DatedException[] = [];
  const real = realisationOf(o);
  const exchange = o.isExchangeReplacement;
  const base = `order:${o.id}`;
  const cut = real?.reversedAt?.getTime() ?? Infinity;
  const lineById = new Map(o.lines.map((l) => [l.orderItemId, l]));
  const missingCost = (key: string, at: Date, l: OrderFact["lines"][number], units: number, what: string) => {
    const suggested = x.suggested.get(l.variantId) ?? 0;
    exceptions.push({
      kind: "MISSING_COST", key, at, sourceType: "OrderItem", sourceId: l.orderItemId, orderId: o.id, orderNumber: o.orderNumber,
      title: `No recorded cost — ${l.productName} (${l.sku}) ×${units}, ${what}`,
      details: { orderItemId: l.orderItemId, variantId: l.variantId, sku: l.sku, units, what, suggestedUnitCost: suggested || null, suggestionSource: "the catalog's current cost price — a suggestion, not a recorded cost" },
      amountMinor: suggested ? suggested * units : null,
    });
  };

  // Recognition — merchandise exactly as realised_net_sales counts it; the rest of the order's charge by its snapshot.
  let recognition: RecognitionComponents | null = null;
  if (real) {
    const merchandise = sum(orderContributions(o, "realisedMerch").filter((c) => c.at!.getTime() === real.at.getTime()).map((c) => c.amount));
    const vat = o.taxAmount ?? 0;
    const shipping = o.total - merchandise - vat - o.priceAdjustment;
    if (shipping < 0) {
      exceptions.push({
        kind: "ORDER_TOTAL_MISMATCH", key: `total:${o.id}`, at: real.at, sourceType: "Order", sourceId: o.id, orderId: o.id, orderNumber: o.orderNumber,
        title: `Order ${o.orderNumber}: merchandise, VAT and adjustments exceed the order total`,
        details: { total: o.total, merchandise, vat, adjustment: o.priceAdjustment, taxMode: o.taxMode, shippingTaxAmount: o.shippingTaxAmount },
        amountMinor: -shipping,
      });
    }
    const cogs: RecognitionComponents["cogs"] = orderContributions(o, "cogsSold")
      .filter((c) => c.at!.getTime() === real.at.getTime() && c.line)
      .map((c) => ({ orderItemId: c.line!.orderItemId, sku: c.line!.sku, quantity: c.line!.quantity, unitCost: c.line!.unitCostSnapshot!, amount: c.amount, status: "KNOWN" as const }));
    const missing: Array<{ orderItemId: string; sku: string; quantity: number }> = [];
    for (const l of o.lines.filter((l) => l.unitCostSnapshot === null)) {
      const est = x.estimates.get(l.orderItemId);
      if (est !== undefined) cogs.push({ orderItemId: l.orderItemId, sku: l.sku, quantity: l.quantity, unitCost: est, amount: est * l.quantity, status: "ESTIMATED" });
      else {
        missing.push({ orderItemId: l.orderItemId, sku: l.sku, quantity: l.quantity });
        missingCost(`cost:line:${l.orderItemId}`, real.at, l, l.quantity, `sold on order ${o.orderNumber}`);
      }
    }
    recognition = { merchandise, vat, shipping, adjustment: o.priceAdjustment, receivable: o.total, cogs };
    events.push({ semanticKey: `${base}:recognition`, type: COMMERCE_EVENT_TYPES.recognised, at: real.at, entityType: "Order", entityId: o.id, payload: { paymentMethod: o.paymentMethod, components: recognition, missingCost: missing } });
  }

  // Refunds — the dashboard's own allocation; the revenue part only when the dashboard counts it.
  const refundRevenue: Array<{ refundId: string; revenue: { merchandiseExVat: number; merchandiseVat: number; other: number } }> = [];
  const allocations = refundAllocations(o);
  for (const a of allocations) {
    if (!a.refundId) continue;
    const counted = real !== null && a.at.getTime() >= real.at.getTime() && a.at.getTime() < cut && a.merchandise + a.other > 0;
    const revenue = counted ? { merchandiseExVat: a.merchandiseExVat, merchandiseVat: a.merchandise - a.merchandiseExVat, other: a.other } : null;
    if (revenue) refundRevenue.push({ refundId: a.refundId, revenue });
    const provider = x.refundPayment.get(a.refundId) ?? null;
    const moneySide = provider && GATEWAYS.has(provider) ? PROVIDER_CLEARING[provider]! : "liability.refunds_payable";
    events.push({
      semanticKey: `${base}:refund:${a.refundId}`, type: COMMERCE_EVENT_TYPES.refund, at: a.at, entityType: "Refund", entityId: a.refundId,
      payload: { refundId: a.refundId, amount: a.amount, moneySide, exchange, revenue, allocation: { overpayment: a.overpayment, merchandise: a.merchandise, merchandiseExVat: a.merchandiseExVat, other: a.other } },
    });
  }
  const engineRefunds = sum(orderContributions(o, "merchRefunds").filter((c) => c.at!.getTime() < cut && c.amount > 0).map((c) => c.amount));
  const projectedRefunds = sum(refundRevenue.map((r) => r.revenue.merchandiseExVat));
  if (engineRefunds !== projectedRefunds) {
    exceptions.push({
      kind: "ENGINE_MISMATCH", key: `engine:refunds:${o.id}`, at: new Date(), sourceType: "Order", sourceId: o.id, orderId: o.id, orderNumber: o.orderNumber,
      title: `Order ${o.orderNumber}: refund allocation differs from the dashboard engine`, details: { engine: engineRefunds, projected: projectedRefunds },
    });
  }

  // Item returns — what the order no longer charges (PAYMENT_LEDGER §5c): a sales return, money back or not. The part an
  // earlier refund already took off sales is not posted again (the engine's own allocation).
  const salesReturns: Array<{ returnRequestId: string; at: Date; revenue: { merchandiseExVat: number; vat: number; other: number } }> = [];
  for (const a of returnAllocations(o)) {
    if (!a.returnId || !real || a.at.getTime() >= cut) continue;
    const revenue = { merchandiseExVat: a.merchandiseExVat, vat: a.merchandise - a.merchandiseExVat + a.exclusiveVat, other: a.other };
    if (revenue.merchandiseExVat + revenue.vat + revenue.other <= 0) continue;
    salesReturns.push({ returnRequestId: a.returnId, at: a.at, revenue });
    events.push({
      semanticKey: `${base}:sales_return:${a.returnId}`, type: COMMERCE_EVENT_TYPES.salesReturn, at: a.at, entityType: "ReturnRequest", entityId: a.returnId,
      payload: { returnRequestId: a.returnId, value: a.value, exchange, revenue },
    });
  }
  const engineSalesReturns = sum(orderContributions(o, "merchReturns").filter((c) => c.at!.getTime() < cut && c.amount > 0).map((c) => c.amount));
  const projectedSalesReturns = sum(salesReturns.map((r) => r.revenue.merchandiseExVat));
  if (engineSalesReturns !== projectedSalesReturns) {
    exceptions.push({
      kind: "ENGINE_MISMATCH", key: `engine:sales_returns:${o.id}`, at: new Date(), sourceType: "Order", sourceId: o.id, orderId: o.id, orderNumber: o.orderNumber,
      title: `Order ${o.orderNumber}: returned merchandise differs from the dashboard engine`, details: { engine: engineSalesReturns, projected: projectedSalesReturns },
    });
  }

  // Returns into stock — at the recorded cost, counted exactly when the dashboard's cogs counts them.
  const returnsCounted: Array<{ movementId: string; cost: number; status: "KNOWN" | "ESTIMATED" }> = [];
  for (const e of returnEvents(o)) {
    if (!e.movementId || !real || e.at.getTime() >= cut) continue;
    let cost = e.cost;
    let status: "KNOWN" | "ESTIMATED" = "KNOWN";
    if (cost === null) {
      const lines = o.lines.filter((l) => l.variantId === e.variantId);
      const units = lines.map((l) => l.unitCostSnapshot ?? x.estimates.get(l.orderItemId) ?? null);
      if (units.every((u) => u !== null)) {
        const qty = sum(lines.map((l) => l.quantity));
        cost = Math.round((sum(lines.map((l, i) => l.quantity * units[i]!)) * e.units) / qty);
        status = "ESTIMATED";
      } else {
        missingCost(`cost:return:${e.movementId}`, e.at, e.line, e.units, `returned on order ${o.orderNumber}`);
        continue;
      }
    }
    returnsCounted.push({ movementId: e.movementId, cost, status });
    events.push({ semanticKey: `${base}:return:${e.movementId}`, type: COMMERCE_EVENT_TYPES.returned, at: e.at, entityType: "StockMovement", entityId: e.movementId, payload: { movementId: e.movementId, variantId: e.variantId, units: e.units, cost, status } });
  }
  const engineReturns = sum(orderContributions(o, "cogsReturned").filter((c) => c.at!.getTime() < cut && c.amount > 0).map((c) => c.amount));
  const projectedReturns = sum(returnsCounted.filter((r) => r.status === "KNOWN").map((r) => r.cost));
  if (engineReturns !== projectedReturns) {
    exceptions.push({
      kind: "ENGINE_MISMATCH", key: `engine:returns:${o.id}`, at: new Date(), sourceType: "Order", sourceId: o.id, orderId: o.id, orderNumber: o.orderNumber,
      title: `Order ${o.orderNumber}: returned cost differs from the dashboard engine`, details: { engine: engineReturns, projected: projectedReturns },
    });
  }

  // A cancellation after realisation reverses everything the dashboard reverses, at the cancellation instant.
  if (real?.reversedAt && recognition) {
    events.push({
      semanticKey: `${base}:reversal`, type: COMMERCE_EVENT_TYPES.reversed, at: real.reversedAt, entityType: "Order", entityId: o.id,
      // `salesReturns` only when there are any, so reversals recorded before they existed keep their fingerprint.
      payload: { recognition, exchange, refunds: refundRevenue, returns: returnsCounted, ...(salesReturns.length ? { salesReturns: salesReturns.map(({ returnRequestId, revenue }) => ({ returnRequestId, revenue })) } : {}) },
    });
  }

  // Damaged returns written off at the line's recorded cost (the units came back into stock first — RETURN above).
  for (const rr of x.returnRequests) {
    if (!real || rr.at.getTime() >= cut) continue;
    for (const w of rr.lines) {
      const l = lineById.get(w.orderItemId);
      if (!l) continue;
      const unit = l.unitCostSnapshot ?? x.estimates.get(l.orderItemId) ?? null;
      if (unit === null) {
        missingCost(`cost:writeoff:${rr.id}:${l.orderItemId}`, rr.at, l, w.writtenOff, `written off from order ${o.orderNumber}`);
        continue;
      }
      events.push({
        semanticKey: `${base}:writeoff:${rr.id}:${l.orderItemId}`, type: COMMERCE_EVENT_TYPES.writtenOff, at: rr.at, entityType: "ReturnRequest", entityId: rr.id,
        payload: { returnRequestId: rr.id, orderItemId: l.orderItemId, units: w.writtenOff, cost: unit * w.writtenOff, status: l.unitCostSnapshot === null ? "ESTIMATED" : "KNOWN" },
      });
    }
  }

  // Payments into clearing.
  for (const p of o.payments) {
    if (!p.id || p.status !== "SUCCEEDED" || p.amount <= 0) continue;
    events.push({ semanticKey: `${base}:payment:${p.id}`, type: COMMERCE_EVENT_TYPES.payment, at: p.settledAt, entityType: "Payment", entityId: p.id, payload: { paymentId: p.id, provider: p.provider, amount: p.amount, exchange } });
  }
  // A refused parcel's return charge (§5a): courier cost recovered, outside the receivable. Re-marking a payment either
  // way withdraws one event and adds the other (a different semantic key).
  for (const p of o.returnCharges ?? []) {
    if (p.amount <= 0) continue;
    events.push({ semanticKey: `${base}:return_charge:${p.id}`, type: COMMERCE_EVENT_TYPES.returnCharge, at: p.settledAt, entityType: "Payment", entityId: p.id, payload: { paymentId: p.id, provider: p.provider, amount: p.amount, exchange } });
  }

  // Store credit of this order. Issuance first settles what the order owes the customer (its receivable in credit — a
  // cancellation, a price decrease); the rest is a return settled in credit. The split replays the order's own receivable
  // timeline, so it is deterministic. Spends (ORDER_PAYMENT) and releases move the reserved balance.
  type Step = { at: number; rank: number; apply: () => void };
  const steps: Step[] = [];
  // R: the receivable as posted. C: what the order still charges (recognised less every revenue reduction posted).
  let R = 0;
  let C = 0;
  if (recognition) steps.push({ at: real!.at.getTime(), rank: 0, apply: () => { R += recognition!.receivable; C += recognition!.receivable; } });
  for (const p of o.payments) if (p.status === "SUCCEEDED" && p.amount > 0) steps.push({ at: p.settledAt.getTime(), rank: 1, apply: () => (R -= p.amount) });
  for (const a of allocations) {
    const rev = refundRevenue.find((r) => r.refundId === a.refundId)?.revenue;
    const revTotal = rev ? rev.merchandiseExVat + rev.merchandiseVat + rev.other : 0;
    steps.push({ at: a.at.getTime(), rank: 2, apply: () => { R += a.amount - revTotal; C -= revTotal; } });
  }
  const returnTotal = (r: (typeof salesReturns)[number]) => r.revenue.merchandiseExVat + r.revenue.vat + r.revenue.other;
  // A return before a refund at the same instant (the engine's order).
  for (const r of salesReturns) steps.push({ at: r.at.getTime(), rank: 1.5, apply: () => { R -= returnTotal(r); C -= returnTotal(r); } });
  if (real?.reversedAt && recognition) {
    const back = sum(refundRevenue.map((r) => r.revenue.merchandiseExVat + r.revenue.merchandiseVat + r.revenue.other)) + sum(salesReturns.map(returnTotal));
    steps.push({ at: real.reversedAt.getTime(), rank: 3, apply: () => (R += back - recognition!.receivable) });
  }
  // A realised order that ended RETURNED charges nothing more (the payment position: a returned order owes nothing and
  // everything received is owed back). What it still charged — delivery, a refused partial's remainder — is written off
  // at that moment: it never sits in receivables, and money the customer did pay shows as owed back.
  if (recognition && real && !real.reversedAt && x.returnedAt && x.returnedAt.getTime() >= real.at.getTime()) {
    const at = x.returnedAt;
    steps.push({
      at: at.getTime(), rank: 5,
      apply: () => {
        if (C <= 0) return;
        events.push({ semanticKey: `${base}:uncollected`, type: COMMERCE_EVENT_TYPES.uncollected, at, entityType: "Order", entityId: o.id, payload: { amount: C } });
        R -= C;
        C = 0;
      },
    });
  }
  for (const c of x.credits) {
    steps.push({
      at: c.at.getTime(), rank: 4,
      apply: () => {
        if (c.type === "ORDER_PAYMENT" || c.type === "ORDER_PAYMENT_RELEASED") {
          events.push(creditEvent(base, c, exchange, 0, 0));
          return;
        }
        if (!ISSUANCE.has(c.type) || c.amount <= 0) {
          exceptions.push(unsupportedCredit(c, o));
          return;
        }
        const receivablePart = Math.min(c.amount, Math.max(0, -R));
        R += receivablePart;
        C -= c.amount - receivablePart;
        events.push(creditEvent(base, c, exchange, receivablePart, c.amount - receivablePart));
      },
    });
  }
  steps.sort((a, b) => a.at - b.at || a.rank - b.rank);
  for (const s of steps) s.apply();
  return { events, exceptions };
}

function creditEvent(base: string, c: OrderExtras["credits"][number], exchange: boolean, receivablePart: number, returnPart: number): Desired {
  return {
    semanticKey: `${base}:credit:${c.id}`, type: COMMERCE_EVENT_TYPES.credit, at: c.at, entityType: "CustomerCreditEntry", entityId: c.id,
    payload: { entryId: c.id, creditType: c.type, customerId: c.customerId, amount: c.amount, exchange, receivablePart, returnPart },
  };
}

function unsupportedCredit(c: OrderExtras["credits"][number], o: { id: string; orderNumber: string } | null): DatedException {
  return {
    kind: "UNSUPPORTED_CREDIT_ENTRY", key: `credit:${c.id}`, at: c.at, sourceType: "CustomerCreditEntry", sourceId: c.id, orderId: o?.id ?? null, orderNumber: o?.orderNumber ?? null,
    title: `Store credit ${c.type.toLowerCase().replace(/_/g, " ")} with no accounting meaning (${o ? `order ${o.orderNumber}` : "no order"})`,
    details: { entryId: c.id, type: c.type, amount: c.amount, customerId: c.customerId },
    amountMinor: Math.abs(c.amount),
  };
}

/** A store-credit entry that names no order: a reservation / release at checkout moves the reserved balance; anything else
 * has no accounting meaning here and is an exception. */
export function desiredForCustomerCredit(c: OrderExtras["credits"][number]): { events: Desired[]; exceptions: DatedException[] } {
  if (c.type === "ORDER_PAYMENT" || c.type === "ORDER_PAYMENT_RELEASED") return { events: [creditEvent("customer", c, false, 0, 0)], exceptions: [] };
  return { events: [], exceptions: [unsupportedCredit(c, null)] };
}

// ── recording revisions ────────────────────────────────────────────────────────────────────────────────────────────

const revisionOf = (key: string) => Number(/#r(\d+)$/.exec(key)?.[1] ?? 0);

/** Records the revisions that bring the facts under `prefix` to the desired state; returns the recorded event ids. A fact
 * that vanished is withdrawn on the day `withdrawnAt` names for it (an estimate a payout replaced: the payout's day),
 * else now. */
async function applyDesired(tx: AppTransactionClient, ctx: FinanceContext, prefix: string, meta: { orderId: string | null; orderNumber: string | null }, desired: Desired[], exceptions: DatedException[], withdrawnAt: Map<string, Date> = new Map()) {
  const tz = ctx.business.timezone;
  const opening = ctx.business.openingDate!;
  const inBooks = (at: Date) => businessDate(at, tz) >= opening;
  const want = new Map(desired.filter((d) => inBooks(d.at)).map((d) => [d.semanticKey, d]));
  const existing = await tx.financialEvent.findMany({
    where: { businessId: ctx.business.id, sourceInstallId: installId, eventKey: { startsWith: prefix } },
    select: { id: true, eventKey: true, eventType: true, payload: true, sourceEntityType: true, sourceEntityId: true },
  });
  const bySemantic = new Map<string, typeof existing>();
  for (const e of existing) {
    const sk = e.eventKey.split("#")[0]!;
    bySemantic.set(sk, [...(bySemantic.get(sk) ?? []), e]);
  }
  const recorded: string[] = [];
  const keys = new Set([...want.keys(), ...bySemantic.keys()]);
  for (const sk of [...keys].sort()) {
    const revs = (bySemantic.get(sk) ?? []).sort((a, b) => revisionOf(a.eventKey) - revisionOf(b.eventKey));
    const latest = revs[revs.length - 1];
    const latestPayload = (latest?.payload ?? {}) as { fp?: string; void?: boolean };
    const live = latest && !latestPayload.void ? latest : null;
    const d = want.get(sk);
    let record: { d: Desired; isVoid: boolean } | null = null;
    if (d) {
      const fp = fingerprint(d);
      if (!(live && latestPayload.fp === fp)) record = { d, isVoid: false };
    } else if (live) {
      const at = withdrawnAt.get(sk) ?? new Date();
      // A void carries the revision it withdraws (the rule only reverses it).
      record = { d: { semanticKey: sk, type: live.eventType, at, entityType: live.sourceEntityType, entityId: live.sourceEntityId, payload: live.payload as Record<string, unknown> }, isVoid: true };
    }
    if (!record) continue;
    const { d: rec, isVoid } = record;
    const payload = { ...rec.payload, ...meta, semanticKey: sk, fp: isVoid ? "void" : fingerprint(rec), supersedes: live?.id ?? null, void: isVoid };
    const { event } = await recordFinancialEvent(tx, {
      contract: "finance.event",
      contractVersion: 1,
      businessKey: ctx.business.key,
      brandKey: ctx.brand.key,
      source: { installId, system: "commerce", entityType: rec.entityType, entityId: rec.entityId },
      event: { type: rec.type, version: 1, key: `${sk}#r${revs.length}`, occurredAt: rec.at.toISOString() },
      financialDate: businessDate(rec.at, tz),
      currency: ctx.business.baseCurrency,
      payload,
    });
    recorded.push(event.id);
  }
  for (const e of exceptions) if (inBooks(e.at)) await upsertException(tx, ctx.business, ctx.brand.id, e, PROJECTOR_ACTOR);
  return recorded;
}

async function lockScope(tx: AppTransactionClient, scope: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance-commerce:${scope}`}))`;
}

/** Processes recorded events in order (each in its own transaction, retried later by the outbox if one fails). */
async function processAll(ids: string[]) {
  const outcomes: Record<string, string> = {};
  for (const id of ids) {
    try {
      outcomes[id] = await processFinancialEvent(id);
    } catch (err) {
      outcomes[id] = `failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  return outcomes;
}

/** Whether commerce facts reach the books yet: an opening date and posted opening balances. */
async function booksStarted(business: FinanceContext["business"]): Promise<boolean> {
  if (!business.openingDate) return false;
  const batch = await prisma.openingBalanceBatch.findUnique({ where: { businessId: business.id }, select: { status: true } });
  return batch?.status === "POSTED";
}

/** Brings one order's facts into the books (records, then posts). Idempotent. */
export async function projectOrder(orderId: string, opts: { process?: boolean; rates?: Awaited<ReturnType<typeof loadRateCards>> } = {}) {
  const ctx = await getFinanceContext();
  if (!(await booksStarted(ctx.business))) return { recorded: [] as string[], outcomes: {} };
  const [o] = await loadOrderFacts([orderId], ctx.business.baseCurrency);
  if (!o) return { recorded: [] as string[], outcomes: {} };
  let extras = await loadExtras(o, ctx);
  let { events, exceptions } = desiredForOrder(o, extras);
  // Blueprint P0.2 (AUTO_ESTIMATE): a sold line with no cost gets its estimate before anything is posted, so the sale is
  // booked once, at the estimate, labelled ESTIMATED — never posted without cost and then corrected.
  if (await autoEstimateMissingCosts(ctx, exceptions)) {
    extras = await loadExtras(o, ctx);
    ({ events, exceptions } = desiredForOrder(o, extras));
  }
  // Owner's books §3.3 / §4: the courier charge and gateway fee estimates of the order, until their payout replaces them.
  const charges = await chargeEstimatesForOrder(o.id, ctx, opts.rates);
  events.push(...charges.events);
  const recorded = await financeTransaction(async (tx) => {
    await lockScope(tx, `order:${o.id}`);
    return applyDesired(tx, ctx, `order:${o.id}:`, { orderId: o.id, orderNumber: o.orderNumber }, events, exceptions, charges.withdrawnAt);
  });
  return { recorded, outcomes: opts.process === false ? {} : await processAll(recorded) };
}

/**
 * Under the AUTO_ESTIMATE policy (owner decisions Q3 = A, Q-D), resolves each sold line's MISSING_COST with the first cost
 * source that exists (cost-estimate.ts: book average → approved recipe → last posted purchase → catalog), labelled as an
 * automatic estimate and put in the owner's "figures to confirm" list. Lines with no source stay missing. Only sale lines
 * (cost:line:) in the books' period; returns and write-offs then use the same line estimate. True when any was resolved.
 */
async function autoEstimateMissingCosts(ctx: FinanceContext, exceptions: DatedException[]): Promise<boolean> {
  const missing = exceptions.filter((e) => e.kind === "MISSING_COST" && e.key.startsWith("cost:line:") && ctx.business.openingDate && businessDate(e.at, ctx.business.timezone) >= ctx.business.openingDate);
  if (!missing.length) return false;
  const policy = (await prisma.financeBusiness.findUniqueOrThrow({ where: { id: ctx.business.id }, select: { costPolicy: true } })).costPolicy;
  if (policy !== "AUTO_ESTIMATE") return false;
  const variantOf = (e: DatedException) => (e.details as { variantId: string }).variantId;
  const estimates = await estimateUnitCosts(missing.map(variantOf), ctx.business.baseCurrency);
  const resolvable = missing.filter((e) => estimates.has(variantOf(e)));
  if (!resolvable.length) return false;
  await financeTransaction(async (tx) => {
    for (const spec of resolvable) {
      const ex = await upsertException(tx, ctx.business, ctx.brand.id, spec, PROJECTOR_ACTOR);
      if (ex.status === "RESOLVED") continue;
      const est = estimates.get(variantOf(spec))!;
      const note = `Automatic estimate from the ${ESTIMATE_SOURCE_LABEL[est.source]} — confirm or correct it`;
      await markEstimateApproved(tx, ctx.business, ex.id, est.unitCostMinor, note, PROJECTOR_ACTOR);
      const key = { businessId_entityType_entityId: { businessId: ctx.business.id, entityType: "FinanceException", entityId: ex.id } };
      const v = { status: "ESTIMATED" as const, source: `Automatic estimate (${ESTIMATE_SOURCE_LABEL[est.source]})`, note: spec.title };
      await tx.financeVerification.upsert({ where: key, create: { businessId: ctx.business.id, entityType: "FinanceException", entityId: ex.id, ...v }, update: v });
    }
  });
  return true;
}

/** A store-credit entry outside any existing order: one that names no order, or names an order that was permanently
 * deleted (the credit ledger outlives orders). */
export async function projectCustomerCredit(entry: CustomerCreditEntry, opts: { process?: boolean } = {}) {
  const ctx = await getFinanceContext();
  if (!(await booksStarted(ctx.business))) return { recorded: [] as string[], outcomes: {} };
  if (entry.orderId && (await prisma.order.count({ where: { id: entry.orderId } }))) return { recorded: [] as string[], outcomes: {} };
  const c = { id: entry.id, type: entry.type, customerId: entry.customerId, amount: signedMinor(entry.amount, ctx.business.baseCurrency), at: entry.createdAt };
  const { events, exceptions } = desiredForCustomerCredit(c);
  const recorded = await financeTransaction(async (tx) => {
    await lockScope(tx, `credit:${entry.id}`);
    return applyDesired(tx, ctx, `customer:credit:${entry.id}`, { orderId: null, orderNumber: null }, events, exceptions);
  });
  return { recorded, outcomes: opts.process === false ? {} : await processAll(recorded) };
}

// ── stock that moved without a value ───────────────────────────────────────────────────────────────────────────────

/** Stock movements outside orders (restocks, imports, adjustments, damage, loss) change inventory the books can't value
 * yet — purchasing and its costs are a later phase. Each becomes an exception (never a guessed posting); a damaged unit
 * from an item return is not one (its write-off is posted at the line's recorded cost). */
const STOCK_PAGE = 2000;

async function scanStock(tx: AppTransactionClient, ctx: FinanceContext, since: Date | null) {
  const openingStart = new Date(`${ctx.business.openingDate}T00:00:00.000Z`);
  const from = since && since > openingStart ? since : openingStart;
  // Every movement since `from`, page by page: the sweep's cursor moves past all of them, so none may be left unread.
  const page = (after: { id: string; createdAt: Date } | null) =>
    tx.stockMovement.findMany({
      where: {
        orderId: null, reason: { in: ["RESTOCK", "IMPORT", "ADJUSTMENT", "DAMAGED", "LOST", "PACKAGING_USE"] }, createdAt: { gte: from },
        ...(after ? { OR: [{ createdAt: { gt: after.createdAt } }, { createdAt: after.createdAt, id: { gt: after.id } }] } : {}),
      },
      select: { id: true, variantId: true, change: true, reason: true, note: true, createdAt: true, reversesMovementId: true, reversedBy: { select: { id: true } }, valuationEntry: { select: { valuationStatus: true } }, variant: { select: { sku: true, costPrice: true, product: { select: { name: true, costPrice: true } } } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: STOCK_PAGE,
    });
  const moves: Awaited<ReturnType<typeof page>> = [];
  for (let rows = await page(null); ; rows = await page(rows.at(-1)!)) {
    moves.push(...rows);
    if (rows.length < STOCK_PAGE) break;
  }
  let n = 0;
  for (const m of moves) {
    if (m.change === 0 || businessDate(m.createdAt, ctx.business.timezone) < ctx.business.openingDate!) continue;
    if (m.reason === "DAMAGED" && (m.note ?? "").startsWith("Returned damaged — order")) continue;
    // a stock correction and the entry it reversed net to nothing (docs/STOCK_HUB.md §10) — neither is left to decide
    if (m.reversesMovementId || m.reversedBy) continue;
    // Phase 4B: a movement the costing engine valued is booked by its `inventory.valued` posting — only an unvalued one
    // (no cost ever known) is still an exception here.
    if (m.valuationEntry && m.valuationEntry.valuationStatus !== "MISSING") continue;
    const unit = toMinor(m.variant.costPrice ?? m.variant.product.costPrice ?? 0, ctx.business.baseCurrency);
    const receipt = m.change > 0;
    await upsertException(tx, ctx.business, ctx.brand.id, {
      kind: receipt ? "UNVALUED_STOCK_RECEIPT" : "UNVALUED_STOCK_WRITE_OFF",
      key: `stock:${m.id}`, sourceType: "StockMovement", sourceId: m.id,
      title: `${receipt ? "Stock received" : "Stock removed"} without a recorded value — ${m.variant.product.name} (${m.variant.sku}) ${m.change > 0 ? "+" : ""}${m.change} (${m.reason.toLowerCase()})`,
      details: {
        movementId: m.id, variantId: m.variantId, sku: m.variant.sku, change: m.change, reason: m.reason, note: m.note, at: m.createdAt.toISOString(),
        suggestedUnitCost: unit || null, suggestionSource: "the catalog's current cost price — a suggestion, not a recorded cost",
        ...(receipt ? { needs: "purchasing (a later phase) to value received stock" } : {}),
      },
      amountMinor: unit ? unit * Math.abs(m.change) : null,
    }, PROJECTOR_ACTOR);
    n += 1;
  }
  return n;
}

// ── the sweep ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Orders whose commerce facts changed since `since` (any of the rows the projection reads). */
async function changedOrders(since: Date | null): Promise<string[]> {
  if (!since) return (await prisma.order.findMany({ select: { id: true } })).map((o) => o.id);
  const ids = new Set<string>();
  const add = (rows: Array<{ orderId: string | null }>) => rows.forEach((r) => r.orderId && ids.add(r.orderId));
  (await prisma.order.findMany({ where: { updatedAt: { gte: since } }, select: { id: true } })).forEach((o) => ids.add(o.id));
  add(await prisma.orderStatusHistory.findMany({ where: { createdAt: { gte: since } }, select: { orderId: true } }));
  add(await prisma.payment.findMany({ where: { OR: [{ createdAt: { gte: since } }, { settledAt: { gte: since } }] }, select: { orderId: true } }));
  add(await prisma.refund.findMany({ where: { OR: [{ createdAt: { gte: since } }, { completedAt: { gte: since } }] }, select: { orderId: true } }));
  add(await prisma.stockMovement.findMany({ where: { createdAt: { gte: since }, reason: "RETURN" }, select: { orderId: true } }));
  add(await prisma.returnRequest.findMany({ where: { updatedAt: { gte: since } }, select: { orderId: true } }));
  add(await prisma.customerCreditEntry.findMany({ where: { createdAt: { gte: since } }, select: { orderId: true } }));
  add(await prisma.financeException.findMany({ where: { resolvedAt: { gte: since }, kind: "MISSING_COST" }, select: { orderId: true } }));
  // Owner's books: a settlement posted or reversed withdraws or restores the order's charge estimates.
  add(await prisma.clearingSettlementLine.findMany({ where: { settlement: { OR: [{ postedAt: { gte: since } }, { reversedAt: { gte: since } }] } }, select: { orderId: true } }));
  return [...ids];
}

/** Rows changed in the last minutes are looked at again: a row committed late with an earlier timestamp is still seen. */
const OVERLAP_MS = 10 * 60_000;
/** A sweep's lease on its business; renewed while it works, so it lapses only when the process holding it is gone. */
const LEASE_MS = 10 * 60_000;
const RENEW_EVERY = 25;

/**
 * Takes the business's sweep lease, or returns null when another sweep holds a live one. A lease row rather than a
 * session advisory lock: a session lock taken and released through the connection pool can be released on another
 * connection and leak, blocking every later sweep.
 */
async function takeSweepLease(businessId: string): Promise<string | null> {
  const token = randomUUID();
  await prisma.$executeRaw`INSERT INTO "FinanceSyncState" ("businessId", "updatedAt") VALUES (${businessId}, (now() AT TIME ZONE 'UTC')) ON CONFLICT ("businessId") DO NOTHING`;
  const taken = await prisma.$executeRaw`
    UPDATE "FinanceSyncState" SET "leaseToken" = ${token}, "leaseUntil" = (now() AT TIME ZONE 'UTC') + make_interval(secs => ${LEASE_MS / 1000}), "updatedAt" = (now() AT TIME ZONE 'UTC')
    WHERE "businessId" = ${businessId} AND ("leaseUntil" IS NULL OR "leaseUntil" < (now() AT TIME ZONE 'UTC'))`;
  return taken === 1 ? token : null;
}
const renewSweepLease = (businessId: string, token: string) =>
  prisma.$executeRaw`UPDATE "FinanceSyncState" SET "leaseUntil" = (now() AT TIME ZONE 'UTC') + make_interval(secs => ${LEASE_MS / 1000}) WHERE "businessId" = ${businessId} AND "leaseToken" = ${token}`;
const releaseSweepLease = (businessId: string, token: string) =>
  prisma.$executeRaw`UPDATE "FinanceSyncState" SET "leaseToken" = NULL, "leaseUntil" = NULL WHERE "businessId" = ${businessId} AND "leaseToken" = ${token}`;

export interface SyncStats {
  skipped?: string;
  missingMappings?: string[];
  orders: number;
  customerCredits: number;
  stockExceptions: number;
  recorded: number;
  posted: number;
  failed: number;
}

/**
 * One sweep of the projector: provisions the commerce accounts, projects every order whose facts changed since the last
 * sweep (all of them with `full`), every customer-level credit entry, and stock movements outside orders. Serialised per
 * business (a second concurrent sweep returns at once); safe to repeat.
 */
export async function syncCommerce(opts: { full?: boolean; actor?: FinanceActor } = {}): Promise<SyncStats> {
  const ctx = await getFinanceContext();
  const stats: SyncStats = { orders: 0, customerCredits: 0, stockExceptions: 0, recorded: 0, posted: 0, failed: 0 };
  if (!ctx.business.openingDate) return { ...stats, skipped: "OPENING_DATE_NOT_SET" };
  if (!(await booksStarted(ctx.business))) return { ...stats, skipped: "OPENING_BALANCES_NOT_POSTED" };
  const lease = await takeSweepLease(ctx.business.id);
  if (!lease) return { ...stats, skipped: "SWEEP_IN_PROGRESS" };
  try {
    await financeTransaction((tx) => ensureCommerceAccountingInTx(tx, ctx.business, opts.actor));
    const readiness = await commerceReadiness(prisma, ctx.business.id);
    if (!readiness.ready) return { ...stats, skipped: "MAPPINGS_MISSING", missingMappings: readiness.missing };
    const rates = await loadRateCards(ctx.business.id, ctx.business.baseCurrency);
    if (rates.cards.length || rates.fees.size) await financeTransaction((tx) => ensureOwnerBooksSetupInTx(tx, ctx.business, opts.actor));
    const state = await prisma.financeSyncState.findUnique({ where: { businessId: ctx.business.id } });
    const startedAt = new Date();
    const since = opts.full || !state?.cursor ? null : new Date(state.cursor.getTime() - OVERLAP_MS);
    const count = (outcomes: Record<string, string>) => {
      for (const o of Object.values(outcomes)) {
        if (o === "posted") stats.posted += 1;
        else if (o.startsWith("failed") || o === "no_rule") stats.failed += 1;
      }
    };
    for (const id of await changedOrders(since)) {
      const r = await projectOrder(id, { rates });
      stats.orders += 1;
      if (stats.orders % RENEW_EVERY === 0) await renewSweepLease(ctx.business.id, lease);
      stats.recorded += r.recorded.length;
      count(r.outcomes);
    }
    const recentCredits = await prisma.customerCreditEntry.findMany({ where: since ? { createdAt: { gte: since } } : {} });
    const existingOrders = new Set((await prisma.order.findMany({ where: { id: { in: recentCredits.map((c) => c.orderId).filter((x): x is string => Boolean(x)) } }, select: { id: true } })).map((o) => o.id));
    const credits = recentCredits.filter((c) => !c.orderId || !existingOrders.has(c.orderId));
    for (const c of credits) {
      const r = await projectCustomerCredit(c);
      stats.customerCredits += 1;
      stats.recorded += r.recorded.length;
      count(r.outcomes);
    }
    stats.stockExceptions = await financeTransaction((tx) => scanStock(tx, ctx, since));
    const runStats = { ...stats } as unknown as Prisma.InputJsonValue;
    await prisma.financeSyncState.upsert({
      where: { businessId: ctx.business.id },
      create: { businessId: ctx.business.id, cursor: startedAt, lastRunAt: new Date(), lastRunStats: runStats },
      update: { cursor: startedAt, lastRunAt: new Date(), lastRunStats: runStats },
    });
    return stats;
  } finally {
    await releaseSweepLease(ctx.business.id, lease);
  }
}

export async function syncStatus() {
  const ctx = await getFinanceContext();
  const [state, readiness, byStatus, byType] = await Promise.all([
    prisma.financeSyncState.findUnique({ where: { businessId: ctx.business.id } }),
    commerceReadiness(prisma, ctx.business.id),
    prisma.financialEvent.groupBy({ by: ["status"], where: { businessId: ctx.business.id, sourceSystem: "commerce" }, _count: { _all: true } }),
    prisma.financialEvent.groupBy({ by: ["eventType", "status"], where: { businessId: ctx.business.id, sourceSystem: "commerce" }, _count: { _all: true } }),
  ]);
  return {
    openingDate: ctx.business.openingDate,
    cursor: state?.cursor ?? null,
    lastRunAt: state?.lastRunAt ?? null,
    lastRunStats: state?.lastRunStats ?? null,
    readiness,
    events: Object.fromEntries(byStatus.map((g) => [g.status, g._count._all])),
    eventsByType: byType.map((g) => ({ type: g.eventType, status: g.status, count: g._count._all })),
  };
}

/** The accounting trail of one order: its events (every revision) and the journals they posted. */
export async function orderAccounting(orderId: string) {
  const ctx = await getFinanceContext();
  const events = await prisma.financialEvent.findMany({
    where: { businessId: ctx.business.id, sourceInstallId: installId, eventKey: { startsWith: `order:${orderId}:` } },
    orderBy: [{ occurredAt: "asc" }, { receivedAt: "asc" }],
    include: { journalEntry: { select: { id: true, number: true, entryDate: true, totalDebit: true, reversedBy: { select: { id: true, number: true } } } } },
  });
  const exceptions = await prisma.financeException.findMany({ where: { businessId: ctx.business.id, orderId } });
  return { orderId, events: events.map((e: FinancialEvent & { journalEntry: unknown }) => ({ ...e, financialDate: e.financialDate.toISOString().slice(0, 10) })), exceptions };
}


// ── resolving cost exceptions with an approved estimate ────────────────────────────────────────────────────────────

/**
 * Posts an approved ESTIMATED cost for a cost exception — only under the APPROVED_ESTIMATES policy (checked in the
 * exception service). A sale line: the order is projected again, so its recognition is superseded by one that books the
 * line at the estimate (labelled ESTIMATED). A stock write-off: an estimated write-off event is recorded and posted.
 */
export async function approveCostEstimate(exceptionId: string, unitCost: number, note: string, actor: FinanceActor) {
  const ctx = await getFinanceContext();
  const cur = ctx.business.baseCurrency;
  const unitMinor = toMinor(unitCost, cur);
  const ex = await prisma.financeException.findFirst({ where: { id: exceptionId, businessId: ctx.business.id } });
  if (!ex) throw financeError(404, "EXCEPTION_NOT_FOUND", "Exception not found");
  if (ex.kind === "UNVALUED_STOCK_WRITE_OFF") {
    const details = ex.details as { movementId: string; variantId: string; change: number; reason?: string; at: string };
    const units = Math.abs(details.change);
    const eventId = await financeTransaction(async (tx) => {
      // A count correction or loss is first the goods already costed as sold outside the website (outside-stock.ts).
      const outsideReleaseMinor = details.reason && OUTSIDE_RELEASE_REASONS.has(details.reason) ? await outsideReleaseInTx(tx, ctx.business.id, cur, unitMinor * units) : 0;
      const { event } = await recordFinancialEvent(tx, {
        contract: "finance.event",
        contractVersion: 1,
        businessKey: ctx.business.key,
        brandKey: ctx.brand.key,
        source: { installId, system: "finance", entityType: "StockMovement", entityId: details.movementId },
        event: { type: COMMERCE_EVENT_TYPES.stockWriteOff, version: 1, key: `stock:${details.movementId}:writeoff#r0`, occurredAt: new Date(details.at).toISOString() },
        financialDate: businessDate(new Date(details.at), ctx.business.timezone),
        currency: cur,
        payload: {
          semanticKey: `stock:${details.movementId}:writeoff`, fp: "estimate", supersedes: null, void: false, orderId: null, orderNumber: null,
          exceptionId: ex.id, movementId: details.movementId, variantId: details.variantId, units, cost: unitMinor * units, reason: note,
          ...(outsideReleaseMinor > 0 ? { outsideReleaseMinor } : {}),
        },
      });
      await markEstimateApproved(tx, ctx.business, ex.id, unitMinor, note, actor, event.id);
      return event.id;
    });
    return { exceptionId, outcomes: await processAll([eventId]) };
  }
  await financeTransaction((tx) => markEstimateApproved(tx, ctx.business, ex.id, unitMinor, note, actor));
  if (!ex.orderId) return { exceptionId, outcomes: {} };
  const r = await projectOrder(ex.orderId);
  return { exceptionId, outcomes: r.outcomes };
}
