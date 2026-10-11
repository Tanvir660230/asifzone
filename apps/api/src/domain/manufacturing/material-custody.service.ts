/**
 * Materials custody and work in progress (docs/MANUFACTURING.md §6, decision D-M2). Business-supplied material is issued to
 * a production order — it leaves the shelf (inventory.service, PRODUCTION_ISSUE) at its moving-average cost (costing) and
 * its value moves from inventory into work in progress (event manufacturing.material_moved, Dr 1630 / Cr 1610, the order
 * as party). Unused material comes back at the order line's average issued cost. What the producer used or scrapped is
 * declared, not posted: it stays in WIP and becomes the cost of the finished goods (M4/M5).
 *
 * Custody (database CHECK I-6): issued = consumed + returned + scrapped + still at the producer. Issued and returned are
 * derived by the database from the append-only moves.
 */
import type { FinanceValuationStatus } from "@prisma/client";
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { installId } from "../../config/installation";
import { recordDocumentMovements } from "../../modules/inventory/inventory.service";
import { actorCan, recordFinanceAudit, type FinanceActor } from "../finance/finance-audit";
import { businessToday, getFinanceContext } from "../finance/finance-context";
import { financeError, toDecimal, toMajorNumber, toMinor } from "../finance/finance-values";
import { financeTransaction } from "../finance/finance-tx";
import { recordFinancialEvent } from "../finance/events.service";
import { divRound } from "../finance/costing.service";
import { MANUFACTURING_EVENT_TYPES, type MaterialMovedPayload } from "../finance/manufacturing-posting-rules";
import { getProductionOrder, lockProductionOrder, moNumber } from "./production-orders.service";

const OPEN = ["APPROVED", "IN_PRODUCTION", "PARTIALLY_RECEIVED", "RECEIVED"] as const;
const WORST: FinanceValuationStatus[] = ["KNOWN", "ESTIMATED", "MISSING"];
const worst = (s: FinanceValuationStatus[]) => WORST[Math.max(0, ...s.map((x) => WORST.indexOf(x)))]! as "KNOWN" | "ESTIMATED" | "MISSING";
const adminOf = (actor: FinanceActor) => (actor.type === "ADMIN" ? actor.adminId : null);

export interface MoveLineInput { materialLineId: string; quantity: number }

async function lockOpenOrder(tx: AppTransactionClient, businessId: string, id: string) {
  const o = await lockProductionOrder(tx, businessId, id);
  if (!(OPEN as readonly string[]).includes(o.status)) throw financeError(409, "MO_NOT_OPEN", `Materials move only on an approved, open production order (this one is ${o.status.toLowerCase().replace("_", " ")})`);
  const biz = await tx.financeBusiness.findUniqueOrThrow({ where: { id: businessId }, select: { inventoryCostingActivatedAt: true } });
  if (!biz.inventoryCostingActivatedAt) throw financeError(409, "COSTING_NOT_ACTIVE", "Materials are issued once inventory costing is active — run the valuation cutover first");
  return o;
}

function checkLines(o: Awaited<ReturnType<typeof lockProductionOrder>>, lines: MoveLineInput[]) {
  if (!lines.length) throw financeError(400, "MOVE_EMPTY", "Choose at least one material");
  const seen = new Set<string>();
  return lines.map((l, i) => {
    const m = o.materials.find((x) => x.id === l.materialLineId);
    if (!m) throw financeError(400, "MATERIAL_LINE_NOT_FOUND", `Line ${i + 1}: not a material of ${moNumber(o.number)}`);
    if (m.suppliedBy !== "BUSINESS") throw financeError(400, "PRODUCER_SUPPLIED", `Line ${i + 1}: the producer supplies ${m.materialVariant.sku} — it isn't issued`);
    if (!Number.isSafeInteger(l.quantity) || l.quantity <= 0) throw financeError(400, "MOVE_QTY", `Line ${i + 1}: a positive whole number of ${m.materialVariant.product.stockUnit ?? "units"}`);
    if (seen.has(m.id)) throw financeError(400, "MOVE_LINE_TWICE", `Line ${i + 1}: each material once per request`);
    seen.add(m.id);
    return { line: m, quantity: l.quantity };
  });
}

async function replayed(tx: AppTransactionClient, orderId: string, requestKey: string | null | undefined, kind: "ISSUE" | "RETURN") {
  if (!requestKey) return false;
  return (await tx.productionMaterialMove.count({ where: { productionOrderId: orderId, requestKey, kind } })) > 0;
}

/** Issues business-supplied material to an open order. Beyond the plan needs manufacturing.approve and a reason. */
export async function issueMaterials(orderId: string, input: { lines: MoveLineInput[]; note?: string | null; overIssueReason?: string | null }, actor: FinanceActor, opts: { canSeeCost: boolean; requestKey?: string | null }) {
  const { business, brand } = await getFinanceContext();
  const cur = business.baseCurrency;
  const result = await financeTransaction(async (tx) => {
    const o = await lockOpenOrder(tx, business.id, orderId);
    if (await replayed(tx, o.id, opts.requestKey, "ISSUE")) return { replayed: true };
    const lines = checkLines(o, input.lines);
    const over = lines.filter((x) => x.line.issuedQty - x.line.returnedQty + x.quantity > x.line.plannedQty);
    if (over.length && (!actorCan(actor, "manufacturing.approve") || !input.overIssueReason?.trim())) {
      throw financeError(409, "OVER_ISSUE", `${over.map((x) => x.line.materialVariant.sku).join(", ")}: more than planned — an approver must confirm it with a reason`);
    }
    const moved = await recordDocumentMovements(tx, lines.map((x) => ({ variantId: x.line.materialVariantId, change: -x.quantity, reason: "PRODUCTION_ISSUE" as const, basis: { kind: "AVERAGE" as const } })), { adminId: adminOf(actor), note: `Issued to ${moNumber(o.number)}${input.note ? `: ${input.note}` : ""}` });
    const moves = [];
    for (const [i, x] of lines.entries()) {
      const v = moved.lines[i]!;
      const valueMinor = -Number(v.valuation.figures.bookValue);
      const move = await tx.productionMaterialMove.create({
        data: {
          productionOrderId: o.id, materialLineId: x.line.id, kind: "ISSUE", quantity: x.quantity, value: toDecimal(valueMinor, cur),
          valuationStatus: v.valuation.figures.valuationStatus === "OPENING_BALANCE" ? "KNOWN" : v.valuation.figures.valuationStatus, stockMovementId: v.movement.id,
          requestKey: opts.requestKey ?? null, overIssueReason: over.includes(x) ? input.overIssueReason!.trim() : null, note: input.note ?? null, createdByAdminId: adminOf(actor),
        },
      });
      moves.push({ move, valueMinor });
    }
    await bookMoves(tx, business, brand, actor, o.id, moNumber(o.number), "ISSUE", moves);
    if (o.status === "APPROVED") {
      await tx.productionOrder.update({ where: { id: o.id }, data: { status: "IN_PRODUCTION", startedAt: new Date() } });
      await recordFinanceAudit(tx, { businessId: business.id, actor, action: "production_order.start", entityType: "ProductionOrder", entityId: o.id, before: { status: o.status }, after: { status: "IN_PRODUCTION" } });
    }
    return { replayed: false };
  });
  return { ...(await getProductionOrder(orderId, opts)), replayed: result.replayed };
}

/** Returns unused material to stock, at the line's average issued cost. Only what is still at the producer can come back. */
export async function returnMaterials(orderId: string, input: { lines: MoveLineInput[]; note?: string | null }, actor: FinanceActor, opts: { canSeeCost: boolean; requestKey?: string | null }) {
  const { business, brand } = await getFinanceContext();
  const cur = business.baseCurrency;
  const result = await financeTransaction(async (tx) => {
    const o = await lockOpenOrder(tx, business.id, orderId);
    if (await replayed(tx, o.id, opts.requestKey, "RETURN")) return { replayed: true };
    const lines = checkLines(o, input.lines);
    const history = await tx.productionMaterialMove.findMany({ where: { materialLineId: { in: lines.map((x) => x.line.id) } }, select: { materialLineId: true, kind: true, quantity: true, value: true, valuationStatus: true } });
    const plan = lines.map((x) => {
      const atProducer = x.line.issuedQty - x.line.returnedQty - x.line.consumedQty - x.line.scrappedQty;
      if (x.quantity > atProducer) throw financeError(409, "RETURN_EXCEEDS_CUSTODY", `${x.line.materialVariant.sku}: only ${atProducer} ${x.line.materialVariant.product.stockUnit ?? "units"} are still at the producer`);
      const own = history.filter((h) => h.materialLineId === x.line.id);
      const netQty = own.reduce((n, h) => n + (h.kind === "ISSUE" ? h.quantity : -h.quantity), 0);
      const netValue = own.reduce((n, h) => n + (h.kind === "ISSUE" ? 1 : -1) * toMinor(h.value, cur), 0);
      const unvalued = netValue === 0 && own.some((h) => h.kind === "ISSUE" && h.valuationStatus === "MISSING");
      const valueMinor = unvalued ? 0 : x.quantity === netQty ? netValue : Number(divRound(BigInt(netValue) * BigInt(x.quantity), BigInt(netQty)));
      const status = worst(own.filter((h) => h.kind === "ISSUE").map((h) => h.valuationStatus));
      return { ...x, valueMinor, unvalued, status };
    });
    const moved = await recordDocumentMovements(tx, plan.map((x) => ({
      variantId: x.line.materialVariantId, change: x.quantity, reason: "PRODUCTION_RETURN" as const,
      basis: x.unvalued ? { kind: "SNAPSHOT" as const, unitCostMinor: null } : { kind: "DOCUMENT" as const, valueMinor: x.valueMinor, status: x.status === "KNOWN" ? ("KNOWN" as const) : ("ESTIMATED" as const) },
    })), { adminId: adminOf(actor), note: `Returned from ${moNumber(o.number)}${input.note ? `: ${input.note}` : ""}` });
    const moves = [];
    for (const [i, x] of plan.entries()) {
      const v = moved.lines[i]!;
      const move = await tx.productionMaterialMove.create({
        data: { productionOrderId: o.id, materialLineId: x.line.id, kind: "RETURN", quantity: x.quantity, value: toDecimal(x.valueMinor, cur), valuationStatus: x.unvalued ? "MISSING" : x.status, stockMovementId: v.movement.id, requestKey: opts.requestKey ?? null, note: input.note ?? null, createdByAdminId: adminOf(actor) },
      });
      moves.push({ move, valueMinor: x.valueMinor });
    }
    await bookMoves(tx, business, brand, actor, o.id, moNumber(o.number), "RETURN", moves);
    return { replayed: false };
  });
  return { ...(await getProductionOrder(orderId, opts)), replayed: result.replayed };
}

/** The moves' audit entries and their one event (Dr/Cr WIP vs inventory, the order as party). */
async function bookMoves(
  tx: AppTransactionClient,
  business: { id: string; key: string; baseCurrency: string; timezone: string },
  brand: { key: string },
  actor: FinanceActor,
  orderId: string,
  orderNumber: string,
  kind: "ISSUE" | "RETURN",
  moves: Array<{ move: { id: string; materialLineId: string; quantity: number; valuationStatus: FinanceValuationStatus }; valueMinor: number }>,
) {
  for (const { move, valueMinor } of moves) {
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: `production_material.${kind.toLowerCase()}`, entityType: "ProductionMaterialMove", entityId: move.id, after: { orderId, materialLineId: move.materialLineId, quantity: move.quantity, valueMinor, status: move.valuationStatus } });
  }
  await recordFinancialEvent(tx, {
    contract: "finance.event", contractVersion: 1, businessKey: business.key, brandKey: brand.key,
    source: { installId, system: "manufacturing", entityType: "ProductionOrder", entityId: orderId },
    event: { type: MANUFACTURING_EVENT_TYPES.materialMoved, version: 1, key: `mfg-mat:${moves[0]!.move.id}`, occurredAt: new Date().toISOString() },
    financialDate: businessToday(business), currency: business.baseCurrency,
    payload: { productionOrderId: orderId, orderNumber, kind, moveIds: moves.map((m) => m.move.id), valueMinor: moves.reduce((s, m) => s + m.valueMinor, 0), status: worst(moves.map((m) => m.move.valuationStatus)) } satisfies MaterialMovedPayload,
  });
}

/** Declares what the producer consumed and scrapped of the issued material (absolute figures, while the order is open).
 * Nothing posts: the value stays in work in progress and becomes the finished goods' cost. */
export async function declareMaterialUsage(orderId: string, input: { lines: Array<{ materialLineId: string; consumedQty: number; scrappedQty: number }> }, actor: FinanceActor, opts: { canSeeCost: boolean }) {
  const { business } = await getFinanceContext();
  await financeTransaction(async (tx) => {
    const o = await lockProductionOrder(tx, business.id, orderId);
    if (!["IN_PRODUCTION", "PARTIALLY_RECEIVED", "RECEIVED"].includes(o.status)) throw financeError(409, "MO_NOT_IN_PRODUCTION", "Usage is declared once materials are issued and before the order closes");
    const before = [];
    for (const [i, l] of input.lines.entries()) {
      const m = o.materials.find((x) => x.id === l.materialLineId);
      if (!m) throw financeError(400, "MATERIAL_LINE_NOT_FOUND", `Line ${i + 1}: not a material of ${moNumber(o.number)}`);
      if (![l.consumedQty, l.scrappedQty].every((n) => Number.isSafeInteger(n) && n >= 0)) throw financeError(400, "USAGE_QTY", `Line ${i + 1}: whole numbers, zero or more`);
      if (l.consumedQty + l.scrappedQty + m.returnedQty > m.issuedQty) {
        throw financeError(409, "USAGE_EXCEEDS_ISSUED", `${m.materialVariant.sku}: ${m.issuedQty} issued, ${m.returnedQty} returned — consumed + scrapped can't exceed ${m.issuedQty - m.returnedQty}`);
      }
      before.push({ id: m.id, consumedQty: m.consumedQty, scrappedQty: m.scrappedQty });
      await tx.productionMaterialLine.update({ where: { id: m.id }, data: { consumedQty: l.consumedQty, scrappedQty: l.scrappedQty } });
    }
    await tx.productionOrder.update({ where: { id: o.id }, data: { updatedAt: new Date() } });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "production_order.declare_usage", entityType: "ProductionOrder", entityId: o.id, before, after: input.lines });
  });
  return getProductionOrder(orderId, opts);
}

export async function listMaterialMoves(orderId: string) {
  const { business } = await getFinanceContext();
  const o = await prisma.productionOrder.findFirst({ where: { id: orderId, businessId: business.id }, select: { id: true } });
  if (!o) throw financeError(404, "PRODUCTION_ORDER_NOT_FOUND", "Production order not found");
  const rows = await prisma.productionMaterialMove.findMany({ where: { productionOrderId: orderId }, orderBy: { createdAt: "asc" }, include: { materialLine: { select: { materialVariant: { select: { sku: true, product: { select: { name: true, stockUnit: true } } } } } } } });
  return {
    moves: rows.map((m) => ({ id: m.id, kind: m.kind, quantity: m.quantity, value: toMajorNumber(toMinor(m.value, business.baseCurrency), business.baseCurrency), valuationStatus: m.valuationStatus, sku: m.materialLine.materialVariant.sku, name: m.materialLine.materialVariant.product.name, stockUnit: m.materialLine.materialVariant.product.stockUnit, overIssueReason: m.overIssueReason, note: m.note, createdAt: m.createdAt })),
  };
}
