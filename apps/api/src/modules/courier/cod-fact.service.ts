/**
 * Keeps Steadfast's changed cash-on-delivery amount on the order (docs/PAYMENT_LEDGER.md §5c): the last figure by
 * Steadfast's own time, with one timeline line per real change. A fact only — the order's total, its payments and its
 * status are never touched here.
 */
import { prisma } from "../../config/prisma";
import { getCurrency } from "../../domain/config/commerce-settings";
import type { CodChange } from "./cod-fact";

/** Steadfast writes its times in Dhaka time (UTC+6, no daylight saving) without saying so. */
const changeTime = (at: string | null, now: Date) => (at ? new Date(`${at.replace(" ", "T")}+06:00`) : now);

/** Returns whether the amount on the order changed. An older change, or the amount already known, changes nothing. */
export async function recordCodChange(orderId: string, change: CodChange, now: Date = new Date()): Promise<boolean> {
  const currency = await getCurrency();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { status: true, total: true, courierCodNow: true, courierCodBooked: true, courierCodAt: true },
    });
    if (!order) return false;
    const at = changeTime(change.at, now);
    if (order.courierCodAt && at < order.courierCodAt) return false;
    const same = order.courierCodNow !== null && order.courierCodNow.equals(change.to);
    if (same) {
      // Told twice (the panel's edit comes as data and as text): the time moves on, no second line.
      if (!order.courierCodAt || at > order.courierCodAt) await tx.order.update({ where: { id: orderId }, data: { courierCodAt: at } });
      return false;
    }
    const before = order.courierCodNow ?? order.courierCodBooked;
    const from = before ? Number(before) : change.from;
    const who = change.source === "MERCHANT" ? "in the Steadfast panel" : "by the courier";
    await tx.order.update({
      where: { id: orderId },
      data: {
        courierCodNow: change.to,
        courierCodSource: change.source,
        courierCodAt: at,
        statusHistory: {
          create: {
            status: order.status,
            note: `Steadfast: cash on delivery changed ${from === null ? "" : `from ${currency} ${from.toFixed(2)} `}to ${currency} ${change.to.toFixed(2)} ${who}`,
          },
        },
      },
    });
    return true;
  });
}
