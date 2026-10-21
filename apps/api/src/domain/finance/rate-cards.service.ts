/**
 * Courier rate cards and gateway fee rates (docs/FINANCE_OWNER_BOOKS.md §3.1, §4): what the courier and the gateways
 * charge, by date. Saving one for a date replaces that date's card; the estimates change when the sales sync next runs
 * (Re-check everything recomputes every order).
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { recordFinanceAudit, type FinanceActor } from "./finance-audit";
import { getFinanceContext } from "./finance-context";
import { financeTransaction } from "./finance-tx";
import { businessDateOf, dateColumn, financeError, toDecimal, toMajorNumber, toMinor } from "./finance-values";
import { ensureOwnerBooksSetupInTx } from "./owner-books-setup.service";

const adminOf = (actor: FinanceActor) => (actor.type === "ADMIN" ? actor.adminId : null);

export interface RateCardInput {
  effectiveFrom: string;
  zones: Array<{ name: string; districts: string[]; areas: string[]; charge: number }>;
  defaultCharge: number;
  codPercent: number;
  returnChargePercent: number;
  notes?: string | null;
}

function cardDto(c: { id: string; courier: string; effectiveFrom: Date; zones: Prisma.JsonValue; defaultCharge: Prisma.Decimal; codPercent: Prisma.Decimal; returnChargePercent: Prisma.Decimal; notes: string | null; updatedAt: Date }) {
  return {
    id: c.id, courier: c.courier, effectiveFrom: businessDateOf(c.effectiveFrom), zones: c.zones as unknown as RateCardInput["zones"],
    defaultCharge: Number(c.defaultCharge), codPercent: Number(c.codPercent), returnChargePercent: Number(c.returnChargePercent), notes: c.notes, updatedAt: c.updatedAt,
  };
}

export async function listRateCards() {
  const { business } = await getFinanceContext();
  const [cards, fees] = await Promise.all([
    prisma.courierRateCard.findMany({ where: { businessId: business.id }, orderBy: { effectiveFrom: "desc" } }),
    prisma.gatewayFeeRate.findMany({ where: { businessId: business.id }, orderBy: [{ provider: "asc" }, { effectiveFrom: "desc" }] }),
  ]);
  const cur = business.baseCurrency;
  return {
    courierCards: cards.map(cardDto),
    gatewayRates: fees.map((f) => ({ id: f.id, provider: f.provider, effectiveFrom: businessDateOf(f.effectiveFrom), percent: Number(f.percent), fixed: toMajorNumber(toMinor(f.fixed, cur), cur), notes: f.notes, updatedAt: f.updatedAt })),
  };
}

/** Saves the Steadfast card in force from `effectiveFrom` (replacing that date's card). */
export async function saveRateCard(input: RateCardInput, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const names = new Set<string>();
  for (const z of input.zones) {
    const n = z.name.trim().toLowerCase();
    if (names.has(n)) throw financeError(400, "RATE_CARD_ZONES", `Zone "${z.name}" appears twice`);
    names.add(n);
    if (!z.districts.length && !z.areas.length) throw financeError(400, "RATE_CARD_ZONES", `Zone "${z.name}" names no district or area`);
  }
  return financeTransaction(async (tx) => {
    await ensureOwnerBooksSetupInTx(tx, business, actor);
    const data = {
      zones: input.zones.map((z) => ({ name: z.name.trim(), districts: z.districts, areas: z.areas, charge: toMajorNumber(toMinor(z.charge, cur), cur) })) as unknown as Prisma.InputJsonValue,
      defaultCharge: toDecimal(toMinor(input.defaultCharge, cur), cur), codPercent: input.codPercent, returnChargePercent: input.returnChargePercent, notes: input.notes ?? null,
    };
    const where = { businessId_courier_effectiveFrom: { businessId: business.id, courier: "STEADFAST", effectiveFrom: dateColumn(input.effectiveFrom) } };
    const before = await tx.courierRateCard.findUnique({ where });
    const card = await tx.courierRateCard.upsert({ where, create: { businessId: business.id, courier: "STEADFAST", effectiveFrom: dateColumn(input.effectiveFrom), createdByAdminId: adminOf(actor), ...data }, update: data });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: before ? "courier_rate_card.update" : "courier_rate_card.create", entityType: "CourierRateCard", entityId: card.id, before: before ? cardDto(before) : null, after: cardDto(card) });
    return cardDto(card);
  });
}

export async function deleteRateCard(id: string, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  return financeTransaction(async (tx) => {
    const card = await tx.courierRateCard.findFirst({ where: { id, businessId: business.id } });
    if (!card) throw financeError(404, "RATE_CARD_NOT_FOUND", "Rate card not found");
    await tx.courierRateCard.delete({ where: { id } });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "courier_rate_card.delete", entityType: "CourierRateCard", entityId: id, before: cardDto(card) });
  });
}

export async function saveGatewayRate(input: { provider: string; effectiveFrom: string; percent: number; fixed: number; notes?: string | null }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  return financeTransaction(async (tx) => {
    await ensureOwnerBooksSetupInTx(tx, business, actor);
    const where = { businessId_provider_effectiveFrom: { businessId: business.id, provider: input.provider, effectiveFrom: dateColumn(input.effectiveFrom) } };
    const before = await tx.gatewayFeeRate.findUnique({ where });
    const data = { percent: input.percent, fixed: toDecimal(toMinor(input.fixed, cur), cur), notes: input.notes ?? null };
    const rate = await tx.gatewayFeeRate.upsert({ where, create: { businessId: business.id, provider: input.provider, effectiveFrom: dateColumn(input.effectiveFrom), createdByAdminId: adminOf(actor), ...data }, update: data });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: before ? "gateway_fee_rate.update" : "gateway_fee_rate.create", entityType: "GatewayFeeRate", entityId: rate.id, before, after: rate });
    return { id: rate.id, provider: rate.provider, effectiveFrom: businessDateOf(rate.effectiveFrom), percent: Number(rate.percent), fixed: toMajorNumber(toMinor(rate.fixed, cur), cur), notes: rate.notes };
  });
}

export async function deleteGatewayRate(id: string, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  return financeTransaction(async (tx) => {
    const rate = await tx.gatewayFeeRate.findFirst({ where: { id, businessId: business.id } });
    if (!rate) throw financeError(404, "FEE_RATE_NOT_FOUND", "Fee rate not found");
    await tx.gatewayFeeRate.delete({ where: { id } });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "gateway_fee_rate.delete", entityType: "GatewayFeeRate", entityId: id, before: rate });
  });
}
