/**
 * A cash-on-delivery parcel delivered for less than the order says (docs/PAYMENT_LEDGER.md §5d).
 *
 * The COD is often cut on the way: a price agreed at the door, an exchange, a refused item. What Steadfast says it is
 * (§5c, `Order.courierCodNow`) decides what is booked when the parcel is delivered, never the order's total by itself. The
 * rest waits for a person — less money is not always a discount — who says once what it was:
 *   AGREED_PRICE       the price was lowered: the total comes down by the shortfall (price adjustment), so the sale is
 *                      what was collected;
 *   STILL_OWED         the customer still owes it: the total stays and the balance is due;
 *   COLLECTED_IN_FULL  Steadfast's figure is wrong: the rest is recorded as courier cash by that person.
 * Only the system's own payment row is ever replaced (voided, kept for the record); money a person recorded never is.
 */
import { Prisma } from "@prisma/client";
import type { DoorShortfallInput } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { getCurrency } from "../config/commerce-settings";
import { courierPaidOutFor, markDoorShortfall, recordCourierCashByStaff, refreshPaymentStatus, setSystemCourierCash } from "./payment-ledger.service";

type Tx = Prisma.TransactionClient;
const D = Prisma.Decimal;

interface Locked {
  id: string;
  status: string;
  paymentMethod: string;
  total: Prisma.Decimal;
  deletedAt: Date | null;
  courierCodNow: Prisma.Decimal | null;
  doorShortfallAt: Date | null;
  doorDecision: string | null;
}

async function lock(tx: Tx, orderId: string): Promise<Locked> {
  const [row] = await tx.$queryRaw<Locked[]>`
    SELECT id, status::text AS status, "paymentMethod"::text AS "paymentMethod", total, "deletedAt", "courierCodNow", "doorShortfallAt", "doorDecision"
    FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
  if (!row) throw AppError.notFound("Order not found");
  return row;
}

/** What the courier was to collect: the order's total less what was paid other than through the courier. */
async function expectedCod(tx: Tx | typeof prisma, order: { id: string; total: Prisma.Decimal }) {
  const other = await tx.payment.aggregate({ where: { orderId: order.id, status: "SUCCEEDED", purpose: "ORDER", provider: { not: "COD" } }, _sum: { amount: true } });
  return Prisma.Decimal.max(new D(0), order.total.minus(other._sum.amount ?? 0));
}

/** What the courier collected, as far as Steadfast says: below the expected cash → that figure, else null (nothing short). */
export async function knownCollection(tx: Tx, order: { id: string; total: Prisma.Decimal; courierCodNow: Prisma.Decimal | null }): Promise<Prisma.Decimal | null> {
  if (order.courierCodNow === null) return null;
  return order.courierCodNow.lt(await expectedCod(tx, order)) ? order.courierCodNow : null;
}

/** Steadfast says less was collected on a DELIVERED order than was booked for it: books what was collected and marks the
 * order as waiting for a decision. Nothing on an order already decided, in Trash, or whose cash a person recorded. Safe to
 * call any number of times. */
export async function applyDoorCollection(orderId: string): Promise<boolean> {
  const currency = await getCurrency();
  return prisma.$transaction(async (tx) => {
    const order = await lock(tx, orderId);
    if (order.status !== "DELIVERED" || order.paymentMethod !== "COD" || order.deletedAt || order.doorDecision) return false;
    const expected = await expectedCod(tx, order);
    const collected = await knownCollection(tx, order);
    if (collected === null) {
      // Steadfast put the amount back up: what was booked short is booked in full again, nothing to decide.
      if (!order.doorShortfallAt || !(await setSystemCourierCash(tx, orderId, expected, `Steadfast changed it back to ${currency} ${expected.toFixed(2)}`))) return false;
      await tx.order.update({
        where: { id: orderId },
        data: { doorShortfallAt: null, statusHistory: { create: { status: "DELIVERED", note: `Steadfast now says ${currency} ${expected.toFixed(2)} was collected — booked in full` } } },
      });
      await refreshPaymentStatus(tx, orderId, currency);
      return true;
    }
    const changed = await setSystemCourierCash(tx, orderId, collected, `Steadfast collected ${currency} ${collected.toFixed(2)}, not ${currency} ${expected.toFixed(2)}`);
    if (!changed) return false;
    await markDoorShortfall(tx, order, expected, collected, currency);
    await refreshPaymentStatus(tx, orderId, currency);
    return true;
  });
}

export interface DoorShortfall {
  orderId: string;
  orderNumber: string;
  customerName: string;
  deliveredAt: Date;
  expected: number;
  collected: number;
  shortfall: number;
  /** Whether the order already books what was collected (false: an older order, still booked in full). */
  recorded: boolean;
  /** What a posted payout paid for it, when one names it. */
  paidOut: number | null;
}

/** Delivered orders whose courier collected less than the order says, not decided yet: those marked when they were
 * delivered, and older ones whose delivery push in the webhook log carried a lower amount. Read-only. */
export async function doorShortfalls(limit = 200): Promise<DoorShortfall[]> {
  const rows = await prisma.$queryRaw<
    Array<{ id: string; orderNumber: string; customerName: string; statusChangedAt: Date; total: Prisma.Decimal; other: Prisma.Decimal; collected: Prisma.Decimal; waiting: boolean; paidOut: Prisma.Decimal | null }>
  >`
    SELECT o.id, o."orderNumber", o."customerName", o."statusChangedAt", o.total,
      COALESCE((SELECT sum(p.amount) FROM "Payment" p WHERE p."orderId" = o.id AND p.status = 'SUCCEEDED' AND p.purpose = 'ORDER' AND p.provider <> 'COD'), 0) AS other,
      COALESCE(o."courierCodNow", e."codAmount") AS collected,
      o."doorShortfallAt" IS NOT NULL AS waiting,
      (SELECT sum(l.amount) FROM "ClearingSettlementLine" l JOIN "ClearingSettlement" s ON s.id = l."settlementId" WHERE l."orderId" = o.id AND s.status = 'POSTED' AND NOT l."outsideSale") AS "paidOut"
    FROM "Order" o
    LEFT JOIN LATERAL (
      SELECT w."codAmount" FROM "CourierWebhookEvent" w
      WHERE w."consignmentId" = o."courierConsignmentId" AND w.status = 'delivered' AND w."codAmount" IS NOT NULL
      ORDER BY w."receivedAt" DESC LIMIT 1
    ) e ON true
    WHERE o.status = 'DELIVERED' AND o."paymentMethod" = 'COD' AND o."deletedAt" IS NULL AND o."doorDecision" IS NULL
      AND COALESCE(o."courierCodNow", e."codAmount") IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "Payment" p WHERE p."orderId" = o.id AND p.provider = 'COD' AND p.status = 'SUCCEEDED' AND p.purpose = 'ORDER' AND p."recordedByAdminId" IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM "Refund" r JOIN "Payment" p ON p.id = r."paymentId" WHERE p."orderId" = o.id)
    ORDER BY o."statusChangedAt" DESC`;
  return rows
    .map((r) => {
      const expected = Prisma.Decimal.max(new D(0), new D(r.total).minus(r.other));
      const collected = new D(r.collected);
      return {
        orderId: r.id, orderNumber: r.orderNumber, customerName: r.customerName, deliveredAt: r.statusChangedAt,
        expected: Number(expected), collected: Number(collected), shortfall: Number(expected.minus(collected)), recorded: r.waiting,
        paidOut: r.paidOut === null ? null : Number(r.paidOut),
      };
    })
    .filter((r) => r.shortfall > 0)
    .slice(0, limit);
}

/** What was collected on an order being decided: the known fact, else the delivery push in the log, else what staff say. */
async function collectedFor(tx: Tx, order: Locked, said: number | null | undefined): Promise<Prisma.Decimal | null> {
  if (order.courierCodNow !== null) return order.courierCodNow;
  const [push] = await tx.$queryRaw<Array<{ codAmount: Prisma.Decimal }>>`
    SELECT w."codAmount" FROM "CourierWebhookEvent" w JOIN "Order" o ON o."courierConsignmentId" = w."consignmentId"
    WHERE o.id = ${order.id} AND w.status = 'delivered' AND w."codAmount" IS NOT NULL ORDER BY w."receivedAt" DESC LIMIT 1`;
  const expected = await expectedCod(tx, order);
  if (push && new D(push.codAmount).lt(expected)) return new D(push.codAmount);
  return said === null || said === undefined ? null : new D(said);
}

export async function decideDoorShortfall(orderId: string, input: DoorShortfallInput, adminId: string) {
  const note = input.note.trim();
  if (note.length < 3) throw AppError.badRequest("Say why, in a few words");
  const currency = await getCurrency();
  await prisma.$transaction(async (tx) => {
    const order = await lock(tx, orderId);
    if (order.deletedAt) throw AppError.conflict("Restore this order first");
    if (order.doorDecision) throw new AppError(409, "This was already decided", { code: "ALREADY_DECIDED" });
    if (order.status !== "DELIVERED" || order.paymentMethod !== "COD") throw new AppError(409, "Only a delivered cash-on-delivery order can be short", { code: "NOT_DELIVERED_COD" });
    const expected = await expectedCod(tx, order);
    const collected = await collectedFor(tx, order, input.collected);
    if (collected === null || collected.gte(expected)) throw new AppError(409, "Nothing says the courier collected less on this order", { code: "NOT_SHORT" });
    const shortfall = expected.minus(collected);
    const t = (v: Prisma.Decimal) => `${currency} ${v.toFixed(2)}`;

    // The courier's posted payout is what really came in: a decision against it needs looking at first.
    const paidOut = await courierPaidOutFor(tx, orderId);
    const claimed = input.decision === "COLLECTED_IN_FULL" ? expected : collected;
    if (paidOut && !paidOut.equals(claimed)) {
      throw new AppError(409, `Steadfast's payout paid ${t(paidOut)} for this parcel, not ${t(claimed)}`, { code: "PAYOUT_DISAGREES", paidOut: Number(paidOut), claimed: Number(claimed) });
    }

    let said: string;
    if (input.decision === "COLLECTED_IN_FULL") {
      const have = await tx.payment.aggregate({ where: { orderId, provider: "COD", status: "SUCCEEDED", purpose: "ORDER" }, _sum: { amount: true } });
      const rest = expected.minus(have._sum.amount ?? 0);
      if (rest.gt(0)) await recordCourierCashByStaff(tx, orderId, rest, adminId);
      said = `the courier collected the full ${t(expected)}`;
    } else {
      await setSystemCourierCash(tx, orderId, collected, `Steadfast collected ${t(collected)}, not ${t(expected)}`);
      if (input.decision === "AGREED_PRICE") {
        await tx.order.update({ where: { id: orderId }, data: { priceAdjustment: { decrement: shortfall }, total: { decrement: shortfall } } });
        said = `price agreed at the door, ${t(shortfall)} less (collected ${t(collected)})`;
      } else {
        said = `${t(shortfall)} is still owed by the customer (collected ${t(collected)})`;
      }
    }
    await tx.order.update({
      where: { id: orderId },
      data: {
        doorShortfallAt: null, doorDecision: input.decision, doorDecidedAt: new Date(), doorDecidedByAdminId: adminId,
        statusHistory: { create: { status: "DELIVERED", note: `Collected less: ${said} — ${note}`, changedByAdminId: adminId } },
      },
    });
    await refreshPaymentStatus(tx, orderId, currency);
  });
}
