/**
 * After-placement commands that are not modifications (docs/ORDER_ADJUSTMENTS.md §5, §8, §11):
 *   - a customer cancelling their own (possibly prepaid) order → the money held becomes store credit
 *   - staff recording exactly which items of a delivered order came back → restock / write-off, allocated value, credit
 * Each runs in one transaction under the order row lock and leaves the original order, its lines and its payments intact.
 */
import { Prisma } from "@prisma/client";
import {
  customerCancelBlocker,
  formatMoney,
  formatVariantSuffix,
  fromMajor,
  itemReturnBlocker,
  min,
  toMajor,
  type CancelOwnOrderInput,
  type OrderStatus,
  type RecordItemReturnInput,
} from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { getCurrency } from "../../domain/config/commerce-settings";
import { issueStoreCreditFromOrder, lockedPosition, projectedPosition, requestRefund } from "../../domain/payments/payment-ledger.service";
import { notifyReplenished, releaseOrderLines, writeOffReturnedUnits } from "../inventory/inventory.service";
import { closeOpenPaymentRequests } from "../payments/payment-requests";
import { loyaltyBase, reverseDeliveryPoints } from "../customers/customer.service";
import { cancelAwaitingModifications } from "./order-modification.service";
import { applyOrderTransition, runTransitionSideEffects, type OrderTransitionOutcome } from "./order.service";

/**
 * The customer cancels their own order (PENDING / CONFIRMED, not yet with a courier). Stock and coupon usage come back
 * through the state machine (T6); a change waiting for payment and every open payment link/session are closed; and
 * whatever the store holds for the order goes to the customer's store balance (policy: store-use credit, §16) — the
 * original Payment is untouched and no refund is recorded. Repeating it changes nothing and credits nothing twice.
 */
export async function cancelOwnOrder(customerId: string, orderId: string, input: CancelOwnOrderInput) {
  const existing = await prisma.order.findUnique({ where: { id: orderId } });
  if (!existing || existing.customerId !== customerId || existing.deletedAt) throw AppError.notFound("Order not found");
  const blocker = customerCancelBlocker(existing);
  if (blocker) throw new AppError(409, blocker, { code: "ORDER_NOT_CANCELLABLE" });

  const currency = await getCurrency();
  let outcome: OrderTransitionOutcome | null = null;
  const credited = await prisma.$transaction(async (tx) => {
    const { order: locked } = await lockedPosition(tx, orderId);
    const lockedBlocker = customerCancelBlocker({ ...existing, status: locked.status as OrderStatus, courierConsignmentId: locked.courierConsignmentId });
    if (lockedBlocker) throw new AppError(409, lockedBlocker, { code: "ORDER_NOT_CANCELLABLE" });
    if (locked.status !== "CANCELLED") {
      outcome = await applyOrderTransition(tx, orderId, { status: "CANCELLED", note: `Cancelled by the customer${input.reason ? ` — ${input.reason}` : ""}` });
      await cancelAwaitingModifications(tx, orderId, "The order was cancelled");
      await closeOpenPaymentRequests(tx, orderId, "Order cancelled");
    }
    const { position } = await lockedPosition(tx, orderId);
    if (position.refundDue.amount > 0) {
      await issueStoreCreditFromOrder(tx, {
        orderId,
        type: "CANCELLATION",
        reason: `Order ${existing.orderNumber} cancelled — payment kept as store balance`,
        sourceType: "ORDER",
        sourceId: orderId,
        idempotencyKey: `credit:order:${orderId}:cancellation`,
      });
    }
    const entry = await tx.customerCreditEntry.findUnique({ where: { idempotencyKey: `credit:order:${orderId}:cancellation` } });
    return entry ? Number(entry.amount) : 0;
  });
  if (outcome) {
    const o = outcome as OrderTransitionOutcome;
    // The money is with the customer as store balance now — the "cancelled but paid, refund may be owed" alert would be
    // wrong. Side effects see the order's payment status after the credit (CREDITED is not "money held").
    const after = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { paymentStatus: true } });
    await runTransitionSideEffects({ ...o, previousPaymentStatus: credited > 0 ? after.paymentStatus : o.previousPaymentStatus });
  }
  return { orderId, status: "CANCELLED" as const, storeCredit: credited, currency, message: credited > 0 ? `Store Balance: +${formatMoney(credited, currency)}` : null };
}

interface ReturnLineRecord {
  orderItemId: string;
  productName: string;
  size: string;
  color: string;
  quantity: number;
  restocked: number;
  writtenOff: number;
  /** Allocated value of these units: their snapshot price net of the bundle/coupon discount allocated to them (+ their share
   * of merchandise VAT when the order was priced tax-exclusive). Never today's price. */
  value: number;
}

/**
 * Staff record an item-level return on a delivered order (the "kept 1 of 3" parcel): which lines, how many units, which
 * go back on the shelf, and what the customer gets back — store credit (default), a refund owed, or nothing. The value is
 * the order's own allocated pricing (§8), the original lines and total are never rewritten (the payment position nets the
 * returned value out), and when every unit has come back the order moves to RETURNED through the state machine.
 * Idempotent per Idempotency-Key; and a line's units can't be returned twice (conditional release).
 */
export async function recordItemReturn(orderId: string, input: RecordItemReturnInput, adminId: string, idempotencyKey?: string | null) {
  if (idempotencyKey) {
    const existing = await prisma.returnRequest.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (existing.orderId !== orderId) throw AppError.conflict("This Idempotency-Key was already used for a different order");
      return existing;
    }
  }
  const currency = await getCurrency();
  const m = (v: unknown) => fromMajor(String(v ?? 0), currency);
  let replenished: string[] = [];
  let transition: OrderTransitionOutcome | null = null;
  try {
    const request = await prisma.$transaction(async (tx) => {
      await lockedPosition(tx, orderId);
      const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
      if (!order) throw AppError.notFound("Order not found");
      const blocker = itemReturnBlocker(order);
      if (blocker) throw new AppError(409, blocker, { code: "RETURN_NOT_ALLOWED" });
      // A return record belongs to a customer; the rare pre-identity order with none is never matched by phone (Phase 11).
      if (!order.customerId) throw new AppError(409, "This order isn't linked to a customer — link it before recording a return", { code: "RETURN_NOT_ALLOWED" });
      const customerId = order.customerId;

      const byId = new Map(order.items.map((i) => [i.id, i]));
      const lines = valueItemReturn(order, input, currency);

      // Stock: every returned unit comes back (RETURN, counted in returnedQuantity); the unsellable ones are then written off.
      const released = await releaseOrderLines(tx, orderId, "return", {
        adminId,
        note: `Item return: ${input.reason}`,
        lines: lines.map((l) => ({ orderItemId: l.orderItemId, quantity: l.quantity })),
      });
      for (const l of lines) {
        const got = released.released.filter((r) => r.orderItemId === l.orderItemId).reduce((n, r) => n + r.quantity, 0);
        if (got !== l.quantity) throw AppError.conflict("These items were returned by another request just now — reload the order");
      }
      replenished = released.replenished;
      const writeOffs = lines.filter((l) => l.writtenOff > 0).map((l) => ({ variantId: byId.get(l.orderItemId)!.variantId, quantity: l.writtenOff }));
      await writeOffReturnedUnits(tx, order.orderNumber, writeOffs, { adminId, note: input.reason });

      const value = lines.reduce((n, l) => n + m(l.value).amount, 0);
      const valueMoney = { amount: value, currency };
      const request = await tx.returnRequest.create({
        data: {
          orderId,
          customerId,
          type: "RETURN",
          reason: input.reason,
          note: input.note ?? null,
          status: "APPROVED",
          reviewedAt: new Date(),
          reviewedByAdminId: adminId,
          lines: lines as unknown as Prisma.InputJsonValue,
          compensation: input.compensation,
          idempotencyKey: idempotencyKey ?? null,
        },
      });

      // What the customer gets back — never more than the order still owes back after the returned value is netted out.
      const { position } = await lockedPosition(tx, orderId);
      let compensated = 0;
      if (input.compensation === "STORE_CREDIT" && value > 0 && position.refundDue.amount > 0) {
        const amount = min(valueMoney, position.refundDue);
        await issueStoreCreditFromOrder(tx, {
          orderId,
          type: "RETURN",
          amount,
          reason: `Returned from order ${order.orderNumber}: ${lines.map((l) => `${l.productName} ×${l.quantity}`).join(", ")}`,
          sourceType: "RETURN_REQUEST",
          sourceId: request.id,
          idempotencyKey: `credit:return:${request.id}`,
          adminId,
        });
        compensated = toMajor(amount);
      } else if (input.compensation === "REFUND" && value > 0 && position.refundable.amount > 0) {
        const amount = min(valueMoney, position.refundable);
        await requestRefund(tx, orderId, { amount: toMajor(amount), reason: `Item return — ${input.reason}` }, adminId);
        compensated = toMajor(amount);
      } else if (value > 0) {
        // No money goes back now (or nothing was received): the points the returned merchandise earned still go (D8).
        const base = loyaltyBase(order, currency);
        if (base > 0) await reverseDeliveryPoints(tx, customerId, orderId, toMajor(valueMoney) / base);
      }
      await tx.returnRequest.update({ where: { id: request.id }, data: { compensationAmount: compensated } });
      await tx.orderStatusHistory.create({
        data: {
          orderId,
          status: order.status,
          changedByAdminId: adminId,
          note:
            `Items returned: ${lines.map((l) => `${l.productName}${formatVariantSuffix(l.size, l.color)} ×${l.quantity}${l.writtenOff ? ` (${l.writtenOff} written off)` : ""}`).join(", ")}` +
            ` — value ${formatMoney(toMajor(valueMoney), currency)}` +
            (compensated ? `, ${input.compensation === "STORE_CREDIT" ? "credited to store balance" : "refund owed"}: ${formatMoney(compensated, currency)}` : ""),
        },
      });

      // Everything came back: the order is RETURNED (T7 — nothing left to restock; points fully reversed).
      const after = await tx.orderItem.findMany({ where: { orderId }, select: { quantity: true, restockedQuantity: true } });
      if (order.status === "DELIVERED" && after.every((i) => i.restockedQuantity >= i.quantity)) {
        transition = await applyOrderTransition(tx, orderId, { status: "RETURNED", note: "Every item has been returned" }, { adminId });
      }
      return tx.returnRequest.findUniqueOrThrow({ where: { id: request.id } });
    });
    if (transition) await runTransitionSideEffects(transition);
    notifyReplenished(replenished);
    return request;
  } catch (err) {
    if (idempotencyKey && err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const winner = await prisma.returnRequest.findUnique({ where: { idempotencyKey } });
      if (winner) return winner;
    }
    throw err;
  }
}

type OrderWithItems = Prisma.OrderGetPayload<{ include: { items: true } }>;
type ValuedLine = Pick<
  OrderWithItems["items"][number],
  "id" | "quantity" | "restockedQuantity" | "priceSnapshot" | "bundleDiscountAllocated" | "couponDiscountAllocated" | "productNameSnapshot" | "sizeSnapshot" | "colorSnapshot"
>;

/** THE valuation of an item-level return (§8) — shared by the preview and the command, so what staff see before
 * confirming is exactly what is recorded. Per line: the snapshot price × quantity net of its allocated bundle/coupon
 * discount, prorated by units, plus its share of merchandise VAT on a tax-exclusive order. Never today's price.
 * Refuses a line from another order, or more units than are still outstanding on the line (409 RETURN_EXCEEDS_OUTSTANDING). */
export function valueItemReturn(order: Pick<OrderWithItems, "subtotal" | "discount" | "taxMode" | "taxAmount" | "shippingTaxAmount"> & { items: ValuedLine[] }, input: Pick<RecordItemReturnInput, "items">, currency: string): ReturnLineRecord[] {
  const m = (v: unknown) => fromMajor(String(v ?? 0), currency);
  const byId = new Map(order.items.map((i) => [i.id, i]));
  const merged = new Map<string, { quantity: number; restock: number }>();
  for (const e of input.items) {
    const prev = merged.get(e.orderItemId) ?? { quantity: 0, restock: 0 };
    merged.set(e.orderItemId, { quantity: prev.quantity + e.quantity, restock: prev.restock + (e.restock === false ? 0 : e.quantity) });
  }
  // Merchandise VAT added on top (tax-exclusive orders only) is part of what the customer paid for the units.
  const merchandiseTotal = m(order.subtotal).amount - m(order.discount).amount;
  const exclusiveMerchTax = order.taxMode === "EXCLUSIVE" ? m(order.taxAmount).amount - m(order.shippingTaxAmount).amount : 0;
  const lines: ReturnLineRecord[] = [];
  for (const [orderItemId, want] of merged) {
    const item = byId.get(orderItemId);
    if (!item) throw AppError.badRequest(`Order item ${orderItemId} does not belong to this order`);
    const outstanding = item.quantity - item.restockedQuantity;
    if (want.quantity > outstanding) {
      throw new AppError(409, `Only ${outstanding} unit(s) of ${item.productNameSnapshot}${formatVariantSuffix(item.sizeSnapshot, item.colorSnapshot)} can still be returned`, {
        code: "RETURN_EXCEEDS_OUTSTANDING",
      });
    }
    const lineNet = m(item.priceSnapshot).amount * item.quantity - m(item.bundleDiscountAllocated).amount - m(item.couponDiscountAllocated).amount;
    let value = Math.round((Math.max(0, lineNet) * want.quantity) / item.quantity);
    if (exclusiveMerchTax > 0 && merchandiseTotal > 0) value += Math.round((exclusiveMerchTax * value) / merchandiseTotal);
    lines.push({
      orderItemId,
      productName: item.productNameSnapshot,
      size: item.sizeSnapshot,
      color: item.colorSnapshot,
      quantity: want.quantity,
      restocked: want.restock,
      writtenOff: want.quantity - want.restock,
      value: toMajor({ amount: value, currency }),
    });
  }
  return lines;
}

/**
 * What recording this item return WOULD do — nothing is written. The same valuation and the same caps the command applies:
 * store credit up to what the order would then owe back, a refund up to what is still refundable. Lines carry the
 * quantities staff need to see (ordered, already back, still returnable, kept after this return).
 */
export async function previewItemReturn(orderId: string, input: Pick<RecordItemReturnInput, "items">) {
  const currency = await getCurrency();
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: { orderBy: { id: "asc" } } } });
  if (!order) throw AppError.notFound("Order not found");
  const blocker = itemReturnBlocker(order);
  if (blocker) throw new AppError(409, blocker, { code: "RETURN_NOT_ALLOWED" });
  if (!order.customerId) throw new AppError(409, "This order isn't linked to a customer — link it before recording a return", { code: "RETURN_NOT_ALLOWED" });
  const lines = valueItemReturn(order, input, currency);
  const value = lines.reduce((n, l) => n + fromMajor(String(l.value), currency).amount, 0);
  const position = await projectedPosition(prisma, orderId, { extraReturned: { amount: value, currency } });
  const returning = new Map(lines.map((l) => [l.orderItemId, l.quantity]));
  return {
    currency,
    value: toMajor({ amount: value, currency }),
    lines,
    items: order.items.map((i) => ({
      orderItemId: i.id,
      productName: i.productNameSnapshot,
      size: i.sizeSnapshot,
      color: i.colorSnapshot,
      ordered: i.quantity,
      alreadyReturned: i.restockedQuantity,
      returnable: i.quantity - i.restockedQuantity,
      returning: returning.get(i.id) ?? 0,
      keptAfter: i.quantity - i.restockedQuantity - (returning.get(i.id) ?? 0),
    })),
    compensation: {
      /** Max store credit this return would add to the customer's balance. */
      storeCredit: toMajor(min({ amount: value, currency }, position.refundDue)),
      /** Max refund that could be recorded as owed for it. */
      refund: toMajor(min({ amount: value, currency }, position.refundable)),
    },
    /** Every unit is back after this return: the order would move to Returned. */
    returnsEverything: order.status === "DELIVERED" && order.items.every((i) => i.quantity - i.restockedQuantity - (returning.get(i.id) ?? 0) <= 0),
  };
}

/** Item-level returns recorded on an order (admin order detail "Return history"). */
export async function listItemReturns(orderId: string) {
  const rows = await prisma.returnRequest.findMany({
    where: { orderId },
    orderBy: { createdAt: "desc" },
    include: { reviewedByAdmin: { select: { name: true } }, exchangeOrder: { select: { id: true, orderNumber: true, status: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    status: r.status,
    reason: r.reason,
    note: r.note,
    lines: (r.lines as unknown as ReturnLineRecord[] | null) ?? null,
    compensation: r.compensation,
    compensationAmount: r.compensationAmount === null ? null : Number(r.compensationAmount),
    exchangeOrder: r.exchangeOrder,
    recordedBy: r.reviewedByAdmin?.name ?? null,
    createdAt: r.createdAt.toISOString(),
    reviewedAt: r.reviewedAt?.toISOString() ?? null,
  }));
}
