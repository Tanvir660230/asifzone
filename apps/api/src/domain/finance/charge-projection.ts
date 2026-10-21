/**
 * The courier-charge and gateway-fee estimates of one order as desired accounting facts (docs/FINANCE_OWNER_BOOKS.md §3.3,
 * §4) — read by the commerce projector next to the order's own facts, recorded and revised the same way:
 *
 *   order:<id>:courier_charge          while the parcel is delivered / partly delivered / returned and NO posted courier
 *                                      settlement names the order (the settlement then books the actual charge, and this
 *                                      estimate is withdrawn by a void revision).
 *   order:<id>:gateway_fee:<payment>   while the gateway payment has no posted gateway settlement line.
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

export async function chargeEstimatesForOrder(orderId: string, ctx: FinanceContext, rates?: Awaited<ReturnType<typeof loadRateCards>>): Promise<Desired[]> {
  const cur = ctx.business.baseCurrency;
  const { cards, fees } = rates ?? (await loadRateCards(ctx.business.id, cur));
  if (!cards.length && !fees.size) return [];
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true, orderNumber: true, status: true, courierConsignmentId: true, courierStatus: true, courierBookedAt: true, courierStatusSyncedAt: true, updatedAt: true,
      shippingDistrict: true, shippingArea: true,
      statusHistory: { select: { status: true, createdAt: true }, orderBy: { createdAt: "asc" } },
      payments: { where: { status: "SUCCEEDED" }, select: { id: true, provider: true, amount: true, settledAt: true } },
    },
  });
  if (!order) return [];
  const settled = await prisma.clearingSettlementLine.findMany({
    where: { orderId, settlement: { status: "POSTED", businessId: ctx.business.id } },
    select: { externalRef: true, settlement: { select: { clearingAccount: { select: { kind: true } } } } },
  });
  const settledBy = (kind: string) => settled.some((l) => l.settlement.clearingAccount.kind === kind);
  const out: Desired[] = [];
  const tz = ctx.business.timezone;

  if (cards.length && order.courierConsignmentId && !settledBy("COURIER")) {
    const outcome = courierOutcome(order.courierStatus, order.status);
    if (outcome) {
      const booked = order.courierBookedAt?.getTime() ?? 0;
      const hit = order.statusHistory.find((h) => OUTCOME_STATUSES[outcome]!.includes(h.status) && h.createdAt.getTime() >= booked);
      const at = hit?.createdAt ?? order.courierStatusSyncedAt ?? order.updatedAt;
      const collected = order.payments.filter((p) => p.provider === "COD").reduce((s, p) => s + toMinor(p.amount, cur), 0);
      const e = courierChargeEstimate({ outcome, collected: outcome === "RETURNED" ? 0 : collected, district: order.shippingDistrict, area: order.shippingArea, date: businessDate(at, tz), cards });
      if (e && e.total > 0) {
        out.push({
          semanticKey: `order:${order.id}:courier_charge`, type: OWNER_BOOKS_EVENT_TYPES.courierCharge, at, entityType: "Order", entityId: order.id,
          payload: { consignmentId: order.courierConsignmentId, outcome, zone: e.zone, delivery: e.delivery, cod: e.cod, returnCharge: e.returnCharge, total: e.total, cardId: e.cardId },
        });
      }
    }
  }

  if (fees.size && !settledBy("PAYMENT_GATEWAY")) {
    for (const p of order.payments.filter((x) => GATEWAYS.has(x.provider))) {
      const amount = toMinor(p.amount, cur);
      const e = gatewayFeeEstimate(amount, fees.get(p.provider) ?? [], businessDate(p.settledAt, tz));
      if (!e || e.fee <= 0) continue;
      out.push({
        semanticKey: `order:${order.id}:gateway_fee:${p.id}`, type: OWNER_BOOKS_EVENT_TYPES.gatewayFee, at: p.settledAt, entityType: "Payment", entityId: p.id,
        payload: { paymentId: p.id, provider: p.provider, amount, fee: e.fee, rateId: e.rateId },
      });
    }
  }
  return out;
}
