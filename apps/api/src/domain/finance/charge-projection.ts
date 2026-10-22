/**
 * The courier-charge and gateway-fee estimates of one order as desired accounting facts (docs/FINANCE_OWNER_BOOKS.md §3.3,
 * §4) — read by the commerce projector next to the order's own facts, recorded and revised the same way:
 *
 *   order:<id>:courier_charge          while the parcel is delivered / partly delivered / returned and NO posted courier
 *                                      settlement names the order (the settlement then books the actual charge, and this
 *                                      estimate is withdrawn by a void revision dated on the payout's day).
 *   order:<id>:gateway_fee:<payment>   while no posted gateway settlement line settles that payment.
 *
 * Only reads commerce. No rate card / fee rate in force → no estimate.
 */
import { prisma } from "../../config/prisma";
import type { FinanceContext } from "./finance-context";
import type { Desired } from "./commerce-accounting.service";
import { businessDate } from "@clothing-brand/shared";
import { toMinor } from "./finance-values";
import { courierChargeEstimate, courierOutcome, gatewayFeeEstimate, type FeeRate, type RateCard, type RateCardZone } from "./charge-estimates";
import { OWNER_BOOKS_EVENT_TYPES } from "./owner-books-posting-rules";
import { businessDateOf } from "./finance-values";

const OUTCOME_STATUSES: Record<string, string[]> = { DELIVERED: ["DELIVERED"], PARTIAL: ["PARTIALLY_DELIVERED"], RETURNED: ["RETURNED", "CANCELLED"] };
const GATEWAYS = new Set(["EPS_PG", "SSLCOMMERZ"]);

export async function loadRateCards(businessId: string, cur: string): Promise<{ cards: RateCard[]; fees: Map<string, FeeRate[]> }> {
  const [cards, rates] = await Promise.all([
    prisma.courierRateCard.findMany({ where: { businessId, courier: "STEADFAST" } }),
    prisma.gatewayFeeRate.findMany({ where: { businessId } }),
  ]);
  const fees = new Map<string, FeeRate[]>();
  for (const r of rates) fees.set(r.provider, [...(fees.get(r.provider) ?? []), { id: r.id, effectiveFrom: businessDateOf(r.effectiveFrom), percent: Number(r.percent), fixed: toMinor(r.fixed, cur) }]);
  return {
    cards: cards.map((c) => ({
      id: c.id,
      effectiveFrom: businessDateOf(c.effectiveFrom),
      zones: (c.zones as unknown as Array<Omit<RateCardZone, "charge"> & { charge: number }>).map((z) => ({ name: z.name, districts: z.districts ?? [], areas: z.areas ?? [], charge: toMinor(z.charge, cur) })),
      defaultCharge: toMinor(c.defaultCharge, cur),
      codPercent: Number(c.codPercent),
      returnChargePercent: Number(c.returnChargePercent),
    })),
    fees,
  };
}

export async function chargeEstimatesForOrder(orderId: string, ctx: FinanceContext, rates?: Awaited<ReturnType<typeof loadRateCards>>): Promise<{ events: Desired[]; withdrawnAt: Map<string, Date> }> {
  const cur = ctx.business.baseCurrency;
  const { cards, fees } = rates ?? (await loadRateCards(ctx.business.id, cur));
  if (!cards.length && !fees.size) return { events: [], withdrawnAt: new Map() };
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true, orderNumber: true, status: true, courierConsignmentId: true, courierStatus: true, courierBookedAt: true, courierStatusSyncedAt: true, updatedAt: true,
      shippingDistrict: true, shippingArea: true,
      statusHistory: { select: { status: true, createdAt: true }, orderBy: { createdAt: "asc" } },
      payments: { where: { status: "SUCCEEDED" }, select: { id: true, provider: true, purpose: true, amount: true, settledAt: true, providerTransactionId: true } },
    },
  });
  if (!order) return { events: [], withdrawnAt: new Map() };
  const settled = await prisma.clearingSettlementLine.findMany({
    where: { orderId, settlement: { status: "POSTED", businessId: ctx.business.id } },
    select: { externalRef: true, settlement: { select: { settlementDate: true, clearingAccount: { select: { kind: true } } } } },
  });
  const out: Desired[] = [];
  const tz = ctx.business.timezone;
  // An estimate a payout replaced is withdrawn on the payout's day (where the actual charge is booked), never on the day
  // the books happened to notice — so a payout entered late doesn't count the charge twice in its month.
  const withdrawnAt = new Map<string, Date>();
  const payoutDay = (lines: typeof settled) => new Date(`${businessDateOf(lines.map((l) => l.settlement.settlementDate).sort((a, b) => a.getTime() - b.getTime())[0]!)}T12:00:00.000Z`);
  const courierLines = settled.filter((l) => l.settlement.clearingAccount.kind === "COURIER");
  if (courierLines.length) withdrawnAt.set(`order:${order.id}:courier_charge`, payoutDay(courierLines));

  if (cards.length && order.courierConsignmentId && !courierLines.length) {
    const outcome = courierOutcome(order.courierStatus, order.status);
    if (outcome) {
      const booked = order.courierBookedAt?.getTime() ?? 0;
      const hit = order.statusHistory.find((h) => OUTCOME_STATUSES[outcome]!.includes(h.status) && h.createdAt.getTime() >= booked);
      const at = hit?.createdAt ?? order.courierStatusSyncedAt ?? order.updatedAt;
      // What the rider collected for the order (a return charge is not order money and carries no COD charge).
      const collected = order.payments.filter((p) => p.provider === "COD" && p.purpose === "ORDER").reduce((s, p) => s + toMinor(p.amount, cur), 0);
      const e = courierChargeEstimate({ outcome, collected: outcome === "RETURNED" ? 0 : collected, district: order.shippingDistrict, area: order.shippingArea, date: businessDate(at, tz), cards });
      if (e && e.total > 0) {
        out.push({
          semanticKey: `order:${order.id}:courier_charge`, type: OWNER_BOOKS_EVENT_TYPES.courierCharge, at, entityType: "Order", entityId: order.id,
          payload: { consignmentId: order.courierConsignmentId, outcome, zone: e.zone, delivery: e.delivery, cod: e.cod, returnCharge: e.returnCharge, total: e.total, cardId: e.cardId },
        });
      }
    }
  }

  // A gateway payout settles the payments it names (by transaction id); a line naming none of the order's payments
  // settles one payment it doesn't name — all of them when there are at least as many such lines.
  const gatewayLines = settled.filter((l) => l.settlement.clearingAccount.kind === "PAYMENT_GATEWAY");
  const gatewayPayments = order.payments.filter((x) => GATEWAYS.has(x.provider));
  const byRef = (p: (typeof gatewayPayments)[number]) => gatewayLines.filter((l) => p.providerTransactionId && l.externalRef?.trim() === p.providerTransactionId);
  const unnamed = gatewayLines.filter((l) => !gatewayPayments.some((p) => byRef(p).includes(l)));
  const unmatchedPayments = gatewayPayments.filter((p) => !byRef(p).length);
  for (const p of gatewayPayments) {
    const lines = byRef(p).length ? byRef(p) : unnamed.length >= unmatchedPayments.length ? unnamed : [];
    if (lines.length) withdrawnAt.set(`order:${order.id}:gateway_fee:${p.id}`, payoutDay(lines));
  }

  if (fees.size) {
    for (const p of gatewayPayments) {
      if (withdrawnAt.has(`order:${order.id}:gateway_fee:${p.id}`)) continue;
      const amount = toMinor(p.amount, cur);
      const e = gatewayFeeEstimate(amount, fees.get(p.provider) ?? [], businessDate(p.settledAt, tz));
      if (!e || e.fee <= 0) continue;
      out.push({
        semanticKey: `order:${order.id}:gateway_fee:${p.id}`, type: OWNER_BOOKS_EVENT_TYPES.gatewayFee, at: p.settledAt, entityType: "Payment", entityId: p.id,
        payload: { paymentId: p.id, provider: p.provider, amount, fee: e.fee, rateId: e.rateId },
      });
    }
  }
  return { events: out, withdrawnAt };
}
