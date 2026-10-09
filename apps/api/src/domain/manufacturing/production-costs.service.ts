/**
 * Production costs (docs/MANUFACTURING.md §7). Every actual cost of an order — contract manufacturing per piece, sewing,
 * embroidery, freight, samples, setup… — is an entry in a configurable category, entered as an amount or quantity × rate
 * (exact, half-even), with its payee, reference and evidence.
 *
 *   DRAFT ──approve (manufacturing.approve, never the person who entered it)──► APPROVED: event manufacturing.cost_accrued
 *          Dr 1630 WIP (the order) / Cr 2116 production costs accrued (the supplier) — incurred and approved, not yet invoiced
 *   DRAFT / APPROVED ──void (reason)──► VOID: an approved cost's accrual is reversed by a superseding revision
 *
 * A supplier reference is captured once per category while live (unique index), so the same bill can't be costed twice;
 * the supplier's invoice clears the accrual in Phase 4E rather than adding a second cost.
 *
 * Late costs: a cost entered on a CLOSED order is approved (or an approved one voided) the same way, and its effect leaves
 * work in progress at once — the finished goods are revalued, the sold share goes to 5150 (production-close.service).
 */
import type { Prisma, ProductionCostEntry } from "@prisma/client";
import { minorDigits } from "@clothing-brand/shared";
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { installId } from "../../config/installation";
import { actorCan, recordFinanceAudit, type FinanceActor } from "../finance/finance-audit";
import { businessToday, getFinanceContext } from "../finance/finance-context";
import { businessDateOf, dateColumn, financeError, toDecimal, toMajorNumber, toMinor } from "../finance/finance-values";
import { financeTransaction } from "../finance/finance-tx";
import { recordFinancialEvent } from "../finance/events.service";
import { divRound } from "../finance/costing.service";
import { MANUFACTURING_EVENT_TYPES, type CostAccruedPayload } from "../finance/manufacturing-posting-rules";
import { moNumber } from "./production-orders.service";
import { scaleDecimal } from "./requirements";
import { settleLateCostInTx } from "./production-close.service";

const OPEN = ["APPROVED", "IN_PRODUCTION", "PARTIALLY_RECEIVED", "RECEIVED"];
const adminOf = (actor: FinanceActor) => (actor.type === "ADMIN" ? actor.adminId : null);

export interface CostEntryInput {
  categoryId: string;
  supplierId?: string | null;
  reference?: string | null;
  description: string;
  costDate?: string;
  /** Either quantity × unitRate (decimal strings), or amount (major units). */
  quantity?: string | null;
  unitRate?: string | null;
  amount?: number | null;
  evidence?: string | null;
}

/** quantity (≤ 4 dp) × rate (≤ 6 dp) in minor units, half-even — no float touches it. */
export function amountOf(quantity: string, unitRate: string, currency: string): number {
  const q = scaleDecimal(quantity, 4);
  const r = scaleDecimal(unitRate, 6);
  return Number(divRound(q * r, 10n ** BigInt(10 - minorDigits(currency))));
}

const COST_INCLUDE = {
  category: { select: { id: true, code: true, name: true, group: true } },
  supplier: { select: { id: true, code: true, displayName: true } },
  productionOrder: { select: { id: true, number: true, status: true, businessId: true } },
} satisfies Prisma.ProductionCostEntryInclude;
type CostRow = Prisma.ProductionCostEntryGetPayload<{ include: typeof COST_INCLUDE }>;

export function costEntryDto(c: Pick<CostRow, "id" | "status" | "category" | "supplier" | "reference" | "description" | "costDate" | "quantity" | "unitRate" | "amount" | "evidence" | "createdByAdminId" | "approvedByAdminId" | "approvedAt" | "voidedAt" | "voidReason" | "createdAt">, cur: string) {
  return {
    id: c.id,
    status: c.status,
    category: c.category,
    supplier: c.supplier,
    reference: c.reference,
    description: c.description,
    costDate: businessDateOf(c.costDate),
    quantity: c.quantity?.toString() ?? null,
    unitRate: c.unitRate?.toString() ?? null,
    amount: toMajorNumber(toMinor(c.amount, cur), cur),
    evidence: c.evidence,
    createdByAdminId: c.createdByAdminId,
    approvedByAdminId: c.approvedByAdminId,
    approvedAt: c.approvedAt,
    voidedAt: c.voidedAt,
    voidReason: c.voidReason,
    createdAt: c.createdAt,
  };
}

async function lockEntry(tx: AppTransactionClient, businessId: string, id: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT c.id FROM "ProductionCostEntry" c JOIN "ProductionOrder" o ON o.id = c."productionOrderId"
    WHERE c.id = ${id} AND o."businessId" = ${businessId} FOR UPDATE OF c`;
  if (!rows.length) throw financeError(404, "PRODUCTION_COST_NOT_FOUND", "Production cost not found");
  return tx.productionCostEntry.findUniqueOrThrow({ where: { id }, include: COST_INCLUDE });
}

/** Locks the cost's order and reads its status now — so a close and an approval / void of its costs never interleave. */
async function lockedOrderStatus(tx: AppTransactionClient, orderId: string) {
  const [o] = await tx.$queryRaw<Array<{ status: string }>>`SELECT status::text AS status FROM "ProductionOrder" WHERE id = ${orderId} FOR UPDATE`;
  return o!.status;
}

async function validated(tx: AppTransactionClient, businessId: string, cur: string, input: CostEntryInput) {
  const category = await tx.productionCostCategory.findFirst({ where: { id: input.categoryId, businessId } });
  if (!category) throw financeError(400, "COST_CATEGORY_NOT_FOUND", "Cost category not found");
  if (!category.isActive) throw financeError(400, "COST_CATEGORY_INACTIVE", `${category.name} is inactive`);
  if (input.supplierId) {
    const s = await tx.supplier.findFirst({ where: { id: input.supplierId, businessId } });
    if (!s) throw financeError(404, "SUPPLIER_NOT_FOUND", "Supplier not found");
  }
  const hasRate = input.quantity != null && input.unitRate != null;
  if (hasRate === (input.amount != null)) throw financeError(400, "COST_AMOUNT", "Give either an amount or a quantity × rate");
  let amountMinor: number;
  try {
    amountMinor = hasRate ? amountOf(input.quantity!, input.unitRate!, cur) : toMinor(input.amount!, cur);
  } catch {
    throw financeError(400, "COST_AMOUNT", "Quantity has at most 4 decimals and rate at most 6");
  }
  if (amountMinor <= 0) throw financeError(400, "COST_AMOUNT", "A production cost is more than zero");
  return { amountMinor, hasRate };
}

function duplicateError(err: unknown): never {
  if (err instanceof Error && /ProductionCostEntry_live_reference_key|Unique constraint/.test(err.message)) {
    throw financeError(409, "COST_REFERENCE_TAKEN", "This supplier reference is already captured in this category — the same bill can't be costed twice");
  }
  throw err;
}

export async function createCostEntry(orderId: string, input: CostEntryInput, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const costDate = input.costDate ?? businessToday(business);
  if (business.openingDate && costDate < business.openingDate) throw financeError(400, "BEFORE_OPENING_DATE", `The books start on ${business.openingDate}`);
  return financeTransaction(async (tx) => {
    const o = await tx.productionOrder.findFirst({ where: { id: orderId, businessId: business.id }, select: { id: true, number: true, status: true } });
    if (!o) throw financeError(404, "PRODUCTION_ORDER_NOT_FOUND", "Production order not found");
    if (![...OPEN, "CLOSED"].includes(o.status)) throw financeError(409, "MO_NOT_OPEN", `Costs are entered on an approved order (this one is ${o.status.toLowerCase().replace("_", " ")})`);
    const { amountMinor, hasRate } = await validated(tx, business.id, cur, input);
    const created = await tx.productionCostEntry
      .create({
        data: {
          productionOrderId: o.id, categoryId: input.categoryId, supplierId: input.supplierId ?? null, reference: input.reference?.trim() || null,
          description: input.description, costDate: dateColumn(costDate), quantity: hasRate ? input.quantity! : null, unitRate: hasRate ? input.unitRate! : null,
          amount: toDecimal(amountMinor, cur), evidence: input.evidence ?? null, createdByAdminId: adminOf(actor),
        },
        include: COST_INCLUDE,
      })
      .catch(duplicateError);
    const dto = costEntryDto(created, cur);
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "production_cost.create", entityType: "ProductionCostEntry", entityId: created.id, after: dto, sourceRef: moNumber(o.number) });
    return dto;
  });
}

export async function updateCostEntry(id: string, input: Partial<CostEntryInput>, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  return financeTransaction(async (tx) => {
    const before = await lockEntry(tx, business.id, id);
    if (before.status !== "DRAFT") throw financeError(409, "COST_NOT_DRAFT", "Only a draft cost is edited — void an approved one and enter it again");
    const merged: CostEntryInput = {
      categoryId: input.categoryId ?? before.categoryId,
      supplierId: input.supplierId !== undefined ? input.supplierId : before.supplierId,
      reference: input.reference !== undefined ? input.reference : before.reference,
      description: input.description ?? before.description,
      costDate: input.costDate ?? businessDateOf(before.costDate),
      ...(input.amount !== undefined || input.quantity !== undefined
        ? { quantity: input.quantity ?? null, unitRate: input.unitRate ?? null, amount: input.amount ?? null }
        : before.quantity !== null
          ? { quantity: before.quantity.toString(), unitRate: before.unitRate!.toString(), amount: null }
          : { quantity: null, unitRate: null, amount: toMajorNumber(toMinor(before.amount, cur), cur) }),
      evidence: input.evidence !== undefined ? input.evidence : before.evidence,
    };
    const { amountMinor, hasRate } = await validated(tx, business.id, cur, merged);
    const after = await tx.productionCostEntry
      .update({
        where: { id },
        data: {
          categoryId: merged.categoryId, supplierId: merged.supplierId ?? null, reference: merged.reference?.trim() || null, description: merged.description,
          costDate: dateColumn(merged.costDate!), quantity: hasRate ? merged.quantity! : null, unitRate: hasRate ? merged.unitRate! : null, amount: toDecimal(amountMinor, cur), evidence: merged.evidence ?? null,
        },
        include: COST_INCLUDE,
      })
      .catch(duplicateError);
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "production_cost.update", entityType: "ProductionCostEntry", entityId: id, before: costEntryDto(before, cur), after: costEntryDto(after, cur) });
    return costEntryDto(after, cur);
  });
}

export async function deleteDraftCostEntry(id: string, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  return financeTransaction(async (tx) => {
    const c = await lockEntry(tx, business.id, id);
    if (c.status !== "DRAFT") throw financeError(409, "COST_NOT_DRAFT", "An approved cost is never deleted — void it");
    await tx.productionCostEntry.delete({ where: { id } });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "production_cost.delete_draft", entityType: "ProductionCostEntry", entityId: id, before: costEntryDto(c, business.baseCurrency) });
  });
}

function event(business: { key: string; baseCurrency: string; timezone: string }, brandKey: string, c: ProductionCostEntry & { productionOrder: { number: number } ; category: { code: string } }, payload: Omit<CostAccruedPayload, "entryId" | "productionOrderId" | "orderNumber" | "category" | "supplierId">, revision: number) {
  return {
    contract: "finance.event" as const, contractVersion: 1 as const, businessKey: business.key, brandKey,
    source: { installId, system: "manufacturing", entityType: "ProductionCostEntry", entityId: c.id },
    event: { type: MANUFACTURING_EVENT_TYPES.costAccrued, version: 1, key: `mfg-cost:${c.id}#r${revision}`, occurredAt: new Date().toISOString() },
    financialDate: revision === 0 ? businessDateOf(c.costDate) : businessToday(business), currency: business.baseCurrency,
    payload: { entryId: c.id, productionOrderId: c.productionOrderId, orderNumber: moNumber(c.productionOrder.number), category: c.category.code, supplierId: c.supplierId, ...payload } satisfies CostAccruedPayload,
  };
}

/** Approves a draft cost: it accrues into work in progress. Idempotent (an approved cost is returned as it is). */
export async function approveCostEntry(id: string, actor: FinanceActor) {
  const { business, brand } = await getFinanceContext();
  const cur = business.baseCurrency;
  return financeTransaction(async (tx) => {
    const c = await lockEntry(tx, business.id, id);
    if (c.status === "APPROVED") return costEntryDto(c, cur);
    if (c.status !== "DRAFT") throw financeError(409, "COST_STATUS", "A void cost can't be approved");
    if (!actorCan(actor, "manufacturing.approve")) throw financeError(403, "FORBIDDEN", "Approving production costs needs manufacturing.approve");
    if (adminOf(actor) && adminOf(actor) === c.createdByAdminId) throw financeError(409, "COST_SELF_APPROVAL", "A production cost is approved by someone other than who entered it");
    const orderStatus = await lockedOrderStatus(tx, c.productionOrderId);
    if (![...OPEN, "CLOSED"].includes(orderStatus)) throw financeError(409, "MO_NOT_OPEN", "The order was cancelled — its costs can't be approved");
    await recordFinancialEvent(tx, event(business, brand.key, c, { amountMinor: toMinor(c.amount, cur), void: false, supersedes: null }, 0));
    const after = await tx.productionCostEntry.update({ where: { id }, data: { status: "APPROVED", approvedAt: new Date(), approvedByAdminId: adminOf(actor) }, include: COST_INCLUDE });
    if (orderStatus === "CLOSED") await settleLateCostInTx(tx, business, brand.key, c.productionOrderId, c.id, actor);
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "production_cost.approve", entityType: "ProductionCostEntry", entityId: id, before: { status: c.status }, after: { status: after.status, amount: costEntryDto(after, cur).amount } });
    return costEntryDto(after, cur);
  });
}

/** Voids a cost. An approved cost's accrual is reversed (a void revision supersedes it). */
export async function voidCostEntry(id: string, reason: string, actor: FinanceActor) {
  const { business, brand } = await getFinanceContext();
  const cur = business.baseCurrency;
  return financeTransaction(async (tx) => {
    const c = await lockEntry(tx, business.id, id);
    if (c.status === "VOID") return costEntryDto(c, cur);
    if (!actorCan(actor, "manufacturing.approve")) throw financeError(403, "FORBIDDEN", "Voiding production costs needs manufacturing.approve");
    const orderStatus = await lockedOrderStatus(tx, c.productionOrderId);
    if (c.status === "APPROVED") {
      const original = await tx.financialEvent.findUnique({ where: { sourceInstallId_eventKey: { sourceInstallId: installId, eventKey: `mfg-cost:${c.id}#r0` } } });
      await recordFinancialEvent(tx, event(business, brand.key, c, { amountMinor: 0, void: true, supersedes: original?.id ?? null }, 1));
    }
    const after = await tx.productionCostEntry.update({ where: { id }, data: { status: "VOID", voidedAt: new Date(), voidedByAdminId: adminOf(actor), voidReason: reason }, include: COST_INCLUDE });
    if (c.status === "APPROVED" && orderStatus === "CLOSED") await settleLateCostInTx(tx, business, brand.key, c.productionOrderId, c.id, actor);
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "production_cost.void", entityType: "ProductionCostEntry", entityId: id, reason, before: { status: c.status }, after: { status: "VOID" } });
    return costEntryDto(after, cur);
  });
}

export async function listCostEntries(orderId: string) {
  const { business } = await getFinanceContext();
  const rows = await prisma.productionCostEntry.findMany({ where: { productionOrderId: orderId, productionOrder: { businessId: business.id } }, include: COST_INCLUDE, orderBy: { createdAt: "asc" } });
  return { costs: rows.map((r) => costEntryDto(r, business.baseCurrency)) };
}
