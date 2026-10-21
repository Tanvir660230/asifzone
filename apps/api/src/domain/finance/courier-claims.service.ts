/**
 * Courier claims (docs/FINANCE_OWNER_BOOKS.md §3.5): a parcel Steadfast lost (or damaged beyond selling) and the money
 * claimed back for it.
 *
 *   open        Dr 1540 courier claims receivable / Cr 5200 — the recovery of the goods written off as lost
 *   received    money into a bank / wallet / cash account: a Treasury deposit against 1540
 *   in a payout Steadfast added it to a COD payout (posted with that extra as a settlement adjustment): the extra is
 *               moved from 6950 settlement adjustments into the claim
 *   write off   whatever is never paid goes back to 5200
 *
 * The goods themselves leave the books through the inventory: cancel the order (the units come back) and record them as
 * lost in Inventory (5200 at their average cost) — the claim is only the money side. A claim settles when nothing is left.
 */
import type { Prisma } from "@prisma/client";
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { installId } from "../../config/installation";
import { recordFinanceAudit, type FinanceActor } from "./finance-audit";
import { businessToday, getFinanceContext, type FinanceContext } from "./finance-context";
import { financeTransaction } from "./finance-tx";
import { businessDateOf, dateColumn, financeError, toDecimal, toMajorNumber, toMinor } from "./finance-values";
import { resolveMappedAccount } from "./chart.service";
import { movementDto, requestMovementInTx } from "./treasury.service";
import { nextFinanceSequence } from "./suppliers.service";
import { processFinancialEvent, recordFinancialEvent } from "./events.service";
import { COURIER_CLAIM_EVENTS } from "./owner-books-posting-rules";
import { ensureOwnerBooksSetupInTx } from "./owner-books-setup.service";

const adminOf = (actor: FinanceActor) => (actor.type === "ADMIN" ? actor.adminId : null);
export const claimNumber = (n: number) => `CLM-${String(n).padStart(6, "0")}`;
const PAYING_KINDS = new Set(["CASH", "BANK", "MOBILE_WALLET"]);

type Settlement = { kind: "MONEY" | "PAYOUT" | "WRITE_OFF"; amount: number; date: string; movementId?: string | null; eventId?: string | null; note?: string | null };
type Row = Prisma.CourierClaimGetPayload<object>;

function dto(c: Row, cur: string) {
  const settlements = (c.settlements as unknown as Settlement[]) ?? [];
  const amount = toMinor(c.amount, cur);
  const settled = settlements.reduce((s, x) => s + toMinor(x.amount, cur), 0);
  const received = settlements.filter((x) => x.kind !== "WRITE_OFF").reduce((s, x) => s + toMinor(x.amount, cur), 0);
  return {
    id: c.id, number: claimNumber(c.number), orderId: c.orderId, orderNumber: c.orderNumber, consignmentId: c.consignmentId, claimDate: businessDateOf(c.claimDate),
    amount: toMajorNumber(amount, cur), received: toMajorNumber(received, cur), outstanding: toMajorNumber(amount - settled, cur), reason: c.reason, status: c.status, settlements, createdAt: c.createdAt,
  };
}

async function postEvent(tx: AppTransactionClient, ctx: FinanceContext, type: string, key: string, date: string, c: Row, amountMinor: number) {
  const { event } = await recordFinancialEvent(tx, {
    contract: "finance.event", contractVersion: 1, businessKey: ctx.business.key, brandKey: ctx.brand.key,
    source: { installId, system: "finance", entityType: "CourierClaim", entityId: c.id },
    event: { type, version: 1, key, occurredAt: new Date().toISOString() },
    financialDate: date, currency: ctx.business.baseCurrency,
    payload: { claimId: c.id, number: claimNumber(c.number), orderId: c.orderId, orderNumber: c.orderNumber, amount: amountMinor },
  });
  return event.id;
}

export async function openClaim(input: { orderId: string; amount: number; reason: string; claimDate?: string }, actor: FinanceActor) {
  const ctx = await getFinanceContext();
  const { business } = ctx;
  const cur = business.baseCurrency;
  const date = input.claimDate ?? businessToday(business);
  if (business.openingDate && date < business.openingDate) throw financeError(400, "BEFORE_OPENING_DATE", `The books start on ${business.openingDate}`);
  const order = await prisma.order.findUnique({ where: { id: input.orderId }, select: { id: true, orderNumber: true, courierConsignmentId: true } });
  if (!order) throw financeError(404, "ORDER_NOT_FOUND", "Order not found");
  const open = await prisma.courierClaim.count({ where: { businessId: business.id, orderId: order.id, status: "OPEN" } });
  if (open) throw financeError(409, "CLAIM_EXISTS", `${order.orderNumber} already has an open claim`);
  const { row, eventId } = await financeTransaction(async (tx) => {
    await ensureOwnerBooksSetupInTx(tx, business, actor);
    const row = await tx.courierClaim.create({
      data: {
        businessId: business.id, number: await nextFinanceSequence(tx, business.id, "courier-claim"), orderId: order.id, orderNumber: order.orderNumber, consignmentId: order.courierConsignmentId,
        claimDate: dateColumn(date), amount: toDecimal(toMinor(input.amount, cur), cur), reason: input.reason.trim(), createdByAdminId: adminOf(actor),
      },
    });
    const eventId = await postEvent(tx, ctx, COURIER_CLAIM_EVENTS.opened, `claim:${row.id}:opened`, date, row, toMinor(input.amount, cur));
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "courier_claim.open", entityType: "CourierClaim", entityId: row.id, after: dto(row, cur) });
    return { row, eventId };
  });
  await processFinancialEvent(eventId);
  return dto(row, cur);
}

/** Settles part or all of a claim: MONEY into an account, PAYOUT (it came inside a Steadfast payout), or WRITE_OFF. */
export async function settleClaim(id: string, input: { kind: "MONEY" | "PAYOUT" | "WRITE_OFF"; amount: number; date?: string; financialAccountId?: string | null; note?: string | null }, actor: FinanceActor, idempotencyKey: string | null) {
  if (!idempotencyKey) throw financeError(400, "IDEMPOTENCY_KEY_REQUIRED", "Send an Idempotency-Key header");
  const ctx = await getFinanceContext();
  const { business } = ctx;
  const cur = business.baseCurrency;
  const date = input.date ?? businessToday(business);
  const amountMinor = toMinor(input.amount, cur);
  if (!(amountMinor > 0)) throw financeError(400, "CLAIM_AMOUNT", "Give the amount");
  const { row, eventId } = await financeTransaction(async (tx) => {
    const [locked] = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "CourierClaim" WHERE id = ${id} AND "businessId" = ${business.id} FOR UPDATE`;
    if (!locked) throw financeError(404, "CLAIM_NOT_FOUND", "Claim not found");
    const c = await tx.courierClaim.findUniqueOrThrow({ where: { id } });
    const settlements = (c.settlements as unknown as Settlement[]) ?? [];
    const replay = settlements.find((s) => (s as Settlement & { key?: string }).key === idempotencyKey);
    if (replay) return { row: c, eventId: null as string | null };
    if (c.status !== "OPEN") throw financeError(409, "CLAIM_SETTLED", "This claim is already settled");
    const left = toMinor(c.amount, cur) - settlements.reduce((s, x) => s + toMinor(x.amount, cur), 0);
    if (amountMinor > left) throw financeError(400, "CLAIM_TOO_MUCH", `Only ${toMajorNumber(left, cur)} is still open on this claim`);
    let movementId: string | null = null;
    let eventId: string | null = null;
    if (input.kind === "MONEY") {
      const fa = input.financialAccountId ? await tx.financialAccount.findFirst({ where: { id: input.financialAccountId, businessId: business.id } }) : null;
      if (!fa || !PAYING_KINDS.has(fa.kind)) throw financeError(400, "CLAIM_ACCOUNT", "Choose the bank, wallet or cash account the money came into");
      const claims = await resolveMappedAccount(tx, business.id, "asset.courier_claims");
      const { movement } = await requestMovementInTx(tx, business, {
        kind: "DEPOSIT", movementDate: date, amount: toMajorNumber(amountMinor, cur), toFinancialAccountId: fa.id, counterAccountId: claims.id, reference: claimNumber(c.number),
        description: `Courier claim ${claimNumber(c.number)} paid — order ${c.orderNumber}`,
      }, actor, `claim:${idempotencyKey}`);
      movementId = movementDto(movement).id;
    } else {
      eventId = await postEvent(tx, ctx, input.kind === "PAYOUT" ? COURIER_CLAIM_EVENTS.viaPayout : COURIER_CLAIM_EVENTS.writtenOff, `claim:${c.id}:${input.kind.toLowerCase()}:${settlements.length}`, date, c, amountMinor);
    }
    const next = [...settlements, { kind: input.kind, amount: toMajorNumber(amountMinor, cur), date, movementId, eventId, note: input.note ?? null, key: idempotencyKey }];
    const row = await tx.courierClaim.update({ where: { id }, data: { settlements: next as unknown as Prisma.InputJsonValue, status: amountMinor === left ? "SETTLED" : "OPEN" } });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: `courier_claim.${input.kind.toLowerCase()}`, entityType: "CourierClaim", entityId: id, before: dto(c, cur), after: dto(row, cur) });
    return { row, eventId };
  });
  if (eventId) await processFinancialEvent(eventId);
  return dto(row, cur);
}

export async function listClaims() {
  const { business } = await getFinanceContext();
  const rows = await prisma.courierClaim.findMany({ where: { businessId: business.id }, orderBy: [{ status: "asc" }, { number: "desc" }], take: 200 });
  const claims = rows.map((r) => dto(r, business.baseCurrency));
  return { claims, totals: { outstanding: Math.round(claims.reduce((s, c) => s + c.outstanding, 0) * 100) / 100 } };
}
