/**
 * Which waiting orders' attar bottles are filled (inventory recovery phase 3). Derived, never stored: a fill-to-order
 * variant's stock is filled bottles less the units on orders still on the shelf (count.service), so
 *
 *   on the shelf (filled)  = max(0, stock + waiting)          waiting = units on orders not yet given to the courier
 *   owed (to fill)         = max(0, −stock)
 *
 * and the filled bottles go to the waiting orders oldest first. Each waiting line reads READY (all its bottles filled),
 * PARTLY_FILLED (some) or AWAITING_FILL (none) — so a bottle that is owed is never shown as ready to ship, and an order of
 * 3 with 1 bottle filled reads 1 of 3. Nothing is reserved by this: it is how the shop would pack today, oldest first.
 */
import { prisma, type Db } from "../../config/prisma";
import { ON_SHELF_STATUSES } from "./count.service";

export type FillReadiness = "READY" | "PARTLY_FILLED" | "AWAITING_FILL";

export interface WaitingLine {
  orderId: string;
  orderNumber: string;
  orderItemId: string;
  variantId: string;
  placedAt: Date;
  /** Units of the line still to go out (quantity − already put back). */
  units: number;
  filled: number;
  toFill: number;
  status: FillReadiness;
}

/** Pure: the filled bottles on the shelf given to the waiting lines oldest first (lines already in that order). */
export function allocateFilled(onShelf: number, lines: Array<{ units: number }>): Array<{ filled: number; toFill: number; status: FillReadiness }> {
  let left = Math.max(0, onShelf);
  return lines.map((l) => {
    const filled = Math.min(l.units, left);
    left -= filled;
    return { filled, toFill: l.units - filled, status: filled === l.units ? "READY" : filled > 0 ? "PARTLY_FILLED" : "AWAITING_FILL" };
  });
}

/** Every waiting line of these fill-to-order variants (all of them when omitted), with its readiness. */
export async function waitingLines(db: Db = prisma, variantIds?: string[]): Promise<WaitingLine[]> {
  const fillIds = (await db.productVariant.findMany({ where: { ...(variantIds ? { id: { in: variantIds } } : {}), product: { fillToOrder: true } }, select: { id: true } })).map((v) => v.id);
  if (!fillIds.length) return [];
  const items = await db.orderItem.findMany({
    where: { variantId: { in: fillIds }, order: { deletedAt: null, courierConsignmentId: null, status: { in: [...ON_SHELF_STATUSES] } } },
    select: { id: true, variantId: true, quantity: true, restockedQuantity: true, order: { select: { id: true, orderNumber: true, createdAt: true } } },
    orderBy: [{ order: { createdAt: "asc" } }, { id: "asc" }],
  });
  const open = items.filter((i) => i.variantId && i.quantity - i.restockedQuantity > 0);
  const ids = [...new Set(open.map((i) => i.variantId!))];
  const stock = new Map((await db.productVariant.findMany({ where: { id: { in: ids } }, select: { id: true, stock: true } })).map((v) => [v.id, v.stock]));
  const out: WaitingLine[] = [];
  for (const id of ids) {
    const lines = open.filter((i) => i.variantId === id);
    const waiting = lines.reduce((s, l) => s + l.quantity - l.restockedQuantity, 0);
    const given = allocateFilled((stock.get(id) ?? 0) + waiting, lines.map((l) => ({ units: l.quantity - l.restockedQuantity })));
    lines.forEach((l, i) => out.push({ orderId: l.order.id, orderNumber: l.order.orderNumber, orderItemId: l.id, variantId: id, placedAt: l.order.createdAt, units: l.quantity - l.restockedQuantity, ...given[i]! }));
  }
  return out.sort((a, b) => a.placedAt.getTime() - b.placedAt.getTime());
}

/** One order's attar lines: READY / PARTLY_FILLED / AWAITING_FILL each (none when it has no attar waiting on the shelf). */
export async function orderFillStatus(orderId: string) {
  const own = await prisma.orderItem.findMany({ where: { orderId }, select: { variantId: true } });
  const ids = [...new Set(own.map((o) => o.variantId).filter((v): v is string => Boolean(v)))];
  const lines = ids.length ? (await waitingLines(prisma, ids)).filter((l) => l.orderId === orderId) : [];
  return { lines: lines.map(({ orderItemId, units, filled, toFill, status }) => ({ orderItemId, units, filled, toFill, status })) };
}
