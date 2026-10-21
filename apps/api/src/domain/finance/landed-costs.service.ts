/**
 * Landed costs (docs/FINANCE_OWNER_BOOKS.md §7.1): 500 caps arrive and the van, the porter and the customs agent are paid
 * separately — the caps really cost what the supplier billed PLUS those. A landed cost is paid through Treasury (Dr 2117
 * landed costs to allocate / Cr the money account) and spread over the lines of one or more posted goods receipts, by
 * quantity or by value. The costing engine revalues the units still held (their average rises) and sends the share of
 * units already sold to 5150; the landed-cost event books the whole amount into inventory against 2117 — so 2117 clears
 * and inventory equals the valuation. Needs inventory costing (the valuation cutover).
 */
import type { LandedCostMethod, Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { installId } from "../../config/installation";
import { recordFinanceAudit, type FinanceActor } from "./finance-audit";
import { businessToday, getFinanceContext } from "./finance-context";
import { financeTransaction } from "./finance-tx";
import { businessDateOf, dateColumn, financeError, toDecimal, toMajorNumber, toMinor } from "./finance-values";
import { resolveMappedAccount } from "./chart.service";
import { movementDto, requestMovementInTx, reverseMovementInTx } from "./treasury.service";
import { nextFinanceSequence } from "./suppliers.service";
import { activeCostingInTx, revalueForDocumentInTx } from "./costing.service";
import { processFinancialEvent, recordFinancialEvent } from "./events.service";
import { LANDED_COST_EVENT, LANDED_COST_REVERSED_EVENT } from "./owner-books-posting-rules";
import { ensureOwnerBooksSetupInTx } from "./owner-books-setup.service";

const adminOf = (actor: FinanceActor) => (actor.type === "ADMIN" ? actor.adminId : null);
export const landedNumber = (n: number) => `LC-${String(n).padStart(6, "0")}`;
const PAYING_KINDS = new Set(["CASH", "BANK", "MOBILE_WALLET"]);

/** Spreads `amount` (minor) over lines by quantity or by value; the last line takes the rounding, so it adds up exactly. */
export function allocateLanded(amount: number, lines: Array<{ qty: number; value: number }>, method: LandedCostMethod): number[] {
  const weights = lines.map((l) => (method === "QUANTITY" ? l.qty : l.value));
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) throw financeError(400, "LANDED_NOTHING_TO_SPREAD", method === "VALUE" ? "These receipts have no value to spread over — spread by quantity" : "These receipts received nothing");
  let given = 0;
  return weights.map((w, i) => {
    if (i === weights.length - 1) return amount - given;
    const share = Math.round((amount * w) / total);
    given += share;
    return share;
  });
}

export interface LandedCostInput {
  costDate?: string;
  description: string;
  payee?: string | null;
  amount: number;
  method: LandedCostMethod;
  goodsReceiptIds: string[];
  fromFinancialAccountId: string;
  reference?: string | null;
}

const INCLUDE = { movement: { select: { id: true, status: true, fromAccount: { select: { id: true, name: true } } } } } satisfies Prisma.LandedCostInclude;
type Row = Prisma.LandedCostGetPayload<{ include: typeof INCLUDE }>;
function dto(r: Row, cur: string) {
  return {
    id: r.id, number: landedNumber(r.number), costDate: businessDateOf(r.costDate), description: r.description, payee: r.payee, method: r.method,
    amount: toMajorNumber(toMinor(r.amount, cur), cur), goodsReceiptIds: r.goodsReceiptIds, allocations: r.allocations, paidFrom: r.movement.fromAccount, paymentStatus: r.movement.status, createdAt: r.createdAt,
    reversedAt: r.reversedAt, reversalReason: r.reversalReason,
  };
}

export async function createLandedCost(input: LandedCostInput, actor: FinanceActor, idempotencyKey: string | null) {
  if (!idempotencyKey) throw financeError(400, "IDEMPOTENCY_KEY_REQUIRED", "Send an Idempotency-Key header with every landed cost");
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const costDate = input.costDate ?? businessToday(business);
  if (business.openingDate && costDate < business.openingDate) throw financeError(400, "BEFORE_OPENING_DATE", `The books start on ${business.openingDate}`);
  const result = await financeTransaction(async (tx) => {
    const prior = await tx.treasuryMovement.findUnique({ where: { businessId_idempotencyKey: { businessId: business.id, idempotencyKey: `landed:${idempotencyKey}` } }, select: { id: true } });
    if (prior) {
      const existing = await tx.landedCost.findUnique({ where: { movementId: prior.id }, include: INCLUDE });
      if (existing) return { row: existing, eventId: null as string | null, replayed: true };
    }
    const scope = await activeCostingInTx(tx);
    if (!scope) throw financeError(409, "COSTING_NOT_ACTIVE", "Landed costs need inventory costing — run the valuation cutover first (Finance › Setup › Valuation cutover)");
    await ensureOwnerBooksSetupInTx(tx, business, actor);
    const from = await tx.financialAccount.findFirst({ where: { id: input.fromFinancialAccountId, businessId: business.id } });
    if (!from || !PAYING_KINDS.has(from.kind)) throw financeError(400, "PAYMENT_SOURCE_KIND", "Pay from cash, a bank or a wallet");
    const ids = [...new Set(input.goodsReceiptIds)];
    const receipts = await tx.goodsReceipt.findMany({ where: { id: { in: ids }, businessId: business.id }, include: { lines: { include: { variant: { select: { sku: true } } } } } });
    if (receipts.length !== ids.length) throw financeError(404, "GOODS_RECEIPT_NOT_FOUND", "A goods receipt wasn't found");
    const notPosted = receipts.find((g) => g.status !== "POSTED");
    if (notPosted) throw financeError(409, "GOODS_RECEIPT_NOT_POSTED", "Add landed costs to posted goods receipts only");
    const lines = receipts.flatMap((g) => g.lines.filter((l) => l.qtyAccepted > 0).map((l) => ({ variantId: l.variantId, sku: l.variant.sku, qty: l.qtyAccepted, value: toMinor(l.value, cur) })));
    if (!lines.length) throw financeError(400, "LANDED_NOTHING_TO_SPREAD", "These receipts accepted nothing");
    const amount = toMinor(input.amount, cur);
    const shares = allocateLanded(amount, lines, input.method);
    const byVariant = new Map<string, { variantId: string; sku: string; qty: number; amount: number }>();
    lines.forEach((l, i) => {
      const x = byVariant.get(l.variantId) ?? { variantId: l.variantId, sku: l.sku, qty: 0, amount: 0 };
      x.qty += l.qty;
      x.amount += shares[i]!;
      byVariant.set(l.variantId, x);
    });
    const clearing = await resolveMappedAccount(tx, business.id, "liability.landed_cost_clearing");
    const number = await nextFinanceSequence(tx, business.id, "landed");
    const { movement } = await requestMovementInTx(tx, business, {
      kind: "WITHDRAWAL", movementDate: costDate, amount: input.amount, fromFinancialAccountId: from.id, counterAccountId: clearing.id, reference: input.reference ?? landedNumber(number),
      description: `Landed cost ${landedNumber(number)}: ${input.description}${input.payee ? ` · ${input.payee}` : ""}`.slice(0, 300),
    }, actor, `landed:${idempotencyKey}`);
    const row = await tx.landedCost.create({
      data: {
        businessId: business.id, number, costDate: dateColumn(costDate), description: input.description.trim(), payee: input.payee ?? null, method: input.method, amount: toDecimal(amount, cur),
        goodsReceiptIds: ids, allocations: [...byVariant.values()].map((v) => ({ ...v, amount: toMajorNumber(v.amount, cur) })) as unknown as Prisma.InputJsonValue,
        movementId: movement.id, createdByAdminId: adminOf(actor),
      },
      include: INCLUDE,
    });
    await revalueForDocumentInTx(tx, { scope, sourceType: "LandedCost", sourceId: row.id, financialDate: costDate, note: `Landed cost ${landedNumber(number)}`, items: [...byVariant.values()].map((v) => ({ variantId: v.variantId, deltaMinor: v.amount, qty: v.qty })) });
    const { event } = await recordFinancialEvent(tx, {
      contract: "finance.event", contractVersion: 1, businessKey: scope.business.key, brandKey: scope.brand.key,
      source: { installId, system: "finance", entityType: "LandedCost", entityId: row.id },
      event: { type: LANDED_COST_EVENT, version: 1, key: `landed:${row.id}#r0`, occurredAt: new Date().toISOString() },
      financialDate: costDate, currency: cur,
      payload: { landedCostId: row.id, number: landedNumber(number), amount },
    });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "landed_cost.create", entityType: "LandedCost", entityId: row.id, after: { ...dto(row, cur), payment: movementDto(movement).status } });
    return { row, eventId: event.id, replayed: false };
  });
  if (result.eventId) await processFinancialEvent(result.eventId);
  return { landedCost: dto(result.row, cur), replayed: result.replayed };
}

export async function listLandedCosts() {
  const { business } = await getFinanceContext();
  const rows = await prisma.landedCost.findMany({ where: { businessId: business.id }, include: INCLUDE, orderBy: { number: "desc" }, take: 200 });
  return { landedCosts: rows.map((r) => dto(r, business.baseCurrency)) };
}

/** Posted goods receipts to choose from, newest first, with what each received. */
export async function receiptsForLandedCost() {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const rows = await prisma.goodsReceipt.findMany({
    where: { businessId: business.id, status: "POSTED" },
    include: { supplier: { select: { displayName: true } }, lines: { include: { variant: { select: { sku: true, product: { select: { name: true } } } } } } },
    orderBy: { receiptDate: "desc" }, take: 100,
  });
  return {
    receipts: rows.map((g) => ({
      id: g.id, number: `GRN-${String(g.number).padStart(6, "0")}`, receiptDate: businessDateOf(g.receiptDate), supplier: g.supplier?.displayName ?? null,
      units: g.lines.reduce((s, l) => s + l.qtyAccepted, 0), value: toMajorNumber(g.lines.reduce((s, l) => s + toMinor(l.value, cur), 0), cur),
      lines: g.lines.map((l) => ({ sku: l.variant.sku, name: l.variant.product.name, qty: l.qtyAccepted, unitCost: toMajorNumber(toMinor(l.unitCost, cur), cur) })),
    })),
  };
}

/**
 * Cancels a landed cost entered by mistake — in one transaction: its payment is reversed (the money is back in the
 * account), the value it added is taken back off the goods (the units still held, the sold share back out of 5150), and
 * its posting is reversed. A landed cost is cancelled once; enter a new one if the right figure is different.
 */
export async function cancelLandedCost(id: string, reason: string, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const result = await financeTransaction(async (tx) => {
    const [locked] = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "LandedCost" WHERE id = ${id} AND "businessId" = ${business.id} FOR UPDATE`;
    if (!locked) throw financeError(404, "LANDED_COST_NOT_FOUND", "Landed cost not found");
    const row = await tx.landedCost.findUniqueOrThrow({ where: { id }, include: INCLUDE });
    if (row.reversedAt) return { row, eventId: null as string | null };
    if (row.movement.status === "PENDING_APPROVAL") throw financeError(409, "PAYMENT_PENDING", "Its payment still waits for approval — reject it in Money accounts first");
    const scope = await activeCostingInTx(tx);
    if (!scope) throw financeError(409, "COSTING_NOT_ACTIVE", "Inventory costing isn't active");
    const today = businessToday(business);
    if (row.movement.status === "POSTED") {
      await reverseMovementInTx(tx, business, row.movementId, { reason: `Landed cost ${landedNumber(row.number)} cancelled: ${reason}` }, actor);
    }
    const allocations = row.allocations as unknown as Array<{ variantId: string; qty: number; amount: number }>;
    await revalueForDocumentInTx(tx, { scope, sourceType: "LandedCostReversal", sourceId: row.id, financialDate: today, note: `Landed cost ${landedNumber(row.number)} cancelled`, items: allocations.map((a) => ({ variantId: a.variantId, deltaMinor: -toMinor(a.amount, cur), qty: a.qty })) });
    const { event } = await recordFinancialEvent(tx, {
      contract: "finance.event", contractVersion: 1, businessKey: scope.business.key, brandKey: scope.brand.key,
      source: { installId, system: "finance", entityType: "LandedCost", entityId: row.id },
      event: { type: LANDED_COST_REVERSED_EVENT, version: 1, key: `landed:${row.id}#reversed`, occurredAt: new Date().toISOString() },
      financialDate: today, currency: cur,
      payload: { landedCostId: row.id, number: landedNumber(row.number), amount: toMinor(row.amount, cur) },
    });
    const after = await tx.landedCost.update({ where: { id }, data: { reversedAt: new Date(), reversalReason: reason, reversedByAdminId: adminOf(actor) }, include: INCLUDE });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "landed_cost.cancel", entityType: "LandedCost", entityId: id, before: dto(row, cur), after: dto(after, cur), reason });
    return { row: after, eventId: event.id };
  });
  if (result.eventId) await processFinancialEvent(result.eventId);
  return dto(result.row, cur);
}
