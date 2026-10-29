import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import {
  RUN,
  asOwner,
  assertInventoryInvariants,
  cleanupFixtures,
  createStockedProduct,
  historyStatuses,
  ownerId,
  placeOrder,
  stockOf,
} from "../../test-fixtures";
import { bulkUpdateOrderStatus, deleteOrder, receiveReturnedParcel, reconcilePartialDelivery, restoreOrder, updateOrderStatus } from "./order.service";
import { refundOrderPayment, settlePaymentSession } from "../payments/payment.service";
import { reviewReturnRequest } from "../return-requests/return-request.service";
import { recordItemReturn } from "./order-adjustments.service";

// docs/ORDER_STATE_MACHINE.md — every status change goes through one transactional matrix. Each test here would
// have passed a wrong state (or double-counted stock) under the pre-Phase-1 "any status → any status" code.

async function expectRefused(promise: Promise<unknown>, status = 400) {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err, "the transition should have been refused").toBeInstanceOf(AppError);
  expect((err as AppError).statusCode).toBe(status);
  return err as AppError;
}

let admin: string;
beforeAll(async () => {
  admin = await ownerId();
});
afterAll(async () => {
  await cleanupFixtures();
  await prisma.$disconnect();
});

describe("order state machine", () => {
  describe("valid transitions", () => {
    it("walks the happy path; stock is taken once at placement and not touched by fulfilment", async () => {
      const { variants } = await createStockedProduct({ stocks: [10] });
      const v = variants[0]!;
      const order = await placeOrder([{ variantId: v.id, quantity: 2 }]);
      expect(await stockOf(v.id)).toBe(8);

      for (const status of ["CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "DELIVERED"] as const) {
        const updated = await updateOrderStatus(order.id, { status }, admin);
        expect(updated.status).toBe(status);
      }
      expect(await stockOf(v.id)).toBe(8);
      expect(await historyStatuses(order.id)).toEqual(["PENDING", "CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "DELIVERED"]);
      await assertInventoryInvariants(v.id);
    });

    it("lets pre-shipment statuses move freely among themselves (corrections), and SHIPPED back to PACKED", async () => {
      const { variants } = await createStockedProduct({ stocks: [5] });
      const order = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
      await updateOrderStatus(order.id, { status: "PACKED" }, admin);
      await updateOrderStatus(order.id, { status: "CONFIRMED" }, admin);
      await updateOrderStatus(order.id, { status: "SHIPPED" }, admin);
      // DR-8: the T3 correction needs a reason.
      await expect(updateOrderStatus(order.id, { status: "PACKED" }, admin)).rejects.toMatchObject({ statusCode: 400 });
      const back = await updateOrderStatus(order.id, { status: "PACKED", note: "Marked shipped before pickup" }, admin);
      expect(back.status).toBe("PACKED");
      expect(await stockOf(variants[0]!.id)).toBe(4);
    });
  });

  describe("invalid transitions", () => {
    it.each([
      ["CANCELLED", "CONFIRMED"],
      ["CANCELLED", "SHIPPED"],
      ["CANCELLED", "DELIVERED"],
      ["DELIVERED", "CANCELLED"],
      ["DELIVERED", "PENDING"],
      ["SHIPPED", "PENDING"],
      ["RETURNED", "DELIVERED"],
    ] as const)("refuses %s → %s and changes nothing", async (from, to) => {
      const { variants } = await createStockedProduct({ stocks: [5] });
      const v = variants[0]!;
      const order = await placeOrder([{ variantId: v.id, quantity: 2 }]);
      // Reach `from` through legal moves.
      const path: Record<string, Array<"SHIPPED" | "DELIVERED" | "CANCELLED" | "RETURNED">> = {
        CANCELLED: ["CANCELLED"],
        DELIVERED: ["SHIPPED", "DELIVERED"],
        SHIPPED: ["SHIPPED"],
        RETURNED: ["SHIPPED", "DELIVERED", "RETURNED"],
      };
      for (const step of path[from]!) await updateOrderStatus(order.id, { status: step }, admin);
      const stockBefore = await stockOf(v.id);
      const historyBefore = await historyStatuses(order.id);

      const err = await expectRefused(updateOrderStatus(order.id, { status: to }, admin));
      expect(err.message.toLowerCase()).toContain(to.toLowerCase().replace(/_/g, " "));

      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(from);
      expect(await stockOf(v.id)).toBe(stockBefore);
      expect(await historyStatuses(order.id)).toEqual(historyBefore);
      await assertInventoryInvariants(v.id);
    });

    it("the HTTP route returns 400 for CANCELLED → CONFIRMED", async () => {
      const { variants } = await createStockedProduct({ stocks: [3] });
      const order = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
      await updateOrderStatus(order.id, { status: "CANCELLED" }, admin);
      const res = await (await asOwner()).patch(`/api/orders/${order.id}/status`, { status: "CONFIRMED" });
      expect(res.status).toBe(400);
      expect(await stockOf(variants[0]!.id)).toBe(3);
    });

    it("bulk status reports refused orders instead of failing (or half-applying) the batch", async () => {
      const { variants } = await createStockedProduct({ stocks: [10] });
      const a = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
      const b = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
      await updateOrderStatus(b.id, { status: "CANCELLED" }, admin);
      const result = await bulkUpdateOrderStatus([a.id, b.id], "CONFIRMED", admin);
      expect(result.updated).toEqual([a.id]);
      expect(result.failed.map((f) => f.id)).toEqual([b.id]);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("CANCELLED");
    });
  });

  describe("repeated and concurrent transitions", () => {
    it("a repeated cancel restocks once and writes one timeline row", async () => {
      const { variants } = await createStockedProduct({ stocks: [10] });
      const v = variants[0]!;
      const order = await placeOrder([{ variantId: v.id, quantity: 3 }]);
      await updateOrderStatus(order.id, { status: "CANCELLED" }, admin);
      await updateOrderStatus(order.id, { status: "CANCELLED" }, admin);
      await updateOrderStatus(order.id, { status: "CANCELLED", note: "called the customer again" }, admin);
      expect(await stockOf(v.id)).toBe(10);
      const history = await prisma.orderStatusHistory.findMany({ where: { orderId: order.id, status: "CANCELLED" } });
      expect(history).toHaveLength(2); // the transition + the explicit note; the bare repeat is a no-op
      expect(await prisma.courierLossEvent.count({ where: { orderId: order.id } })).toBe(0);
      await assertInventoryInvariants(v.id);
    });

    it("concurrent cancellations of one order restock exactly once", async () => {
      const { variants } = await createStockedProduct({ stocks: [10] });
      const v = variants[0]!;
      const order = await placeOrder([{ variantId: v.id, quantity: 4 }]);
      const results = await Promise.allSettled(Array.from({ length: 5 }, () => updateOrderStatus(order.id, { status: "CANCELLED" }, admin)));
      expect(results.every((r) => r.status === "fulfilled")).toBe(true);
      expect(await stockOf(v.id)).toBe(10);
      expect(await prisma.stockMovement.count({ where: { orderId: order.id, reason: "CANCELLATION" } })).toBe(1);
      await assertInventoryInvariants(v.id);
    });

    it("racing CANCELLED against SHIPPED serialises: whichever wins, stock and ledger agree", async () => {
      const { variants } = await createStockedProduct({ stocks: [10] });
      const v = variants[0]!;
      const order = await placeOrder([{ variantId: v.id, quantity: 2 }]);
      await Promise.allSettled([
        updateOrderStatus(order.id, { status: "SHIPPED" }, admin),
        updateOrderStatus(order.id, { status: "CANCELLED" }, admin),
      ]);
      const final = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      // SHIPPED → CANCELLED is legal (returned to origin) and CANCELLED → SHIPPED is not, so either order of
      // commits ends CANCELLED. Cancelled before it shipped, the stock is back at once; cancelled after, it stays out until
      // the parcel is received (inventory recovery F-d) — either way it comes back exactly once.
      expect(final.status).toBe("CANCELLED");
      const shippedFirst = (await prisma.orderStatusHistory.count({ where: { orderId: order.id, status: "SHIPPED" } })) > 0;
      expect(await stockOf(v.id)).toBe(shippedFirst ? 8 : 10);
      if (shippedFirst) await receiveReturnedParcel(order.id, admin, {});
      expect(await stockOf(v.id)).toBe(10);
      await assertInventoryInvariants(v.id);
    });
  });

  describe("payment and refund side effects", () => {
    it("COD becomes PAID on delivery, not on placement, confirmation or shipment (D1)", async () => {
      const { variants } = await createStockedProduct({ stocks: [5] });
      const order = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
      for (const status of ["CONFIRMED", "SHIPPED"] as const) {
        await updateOrderStatus(order.id, { status }, admin);
        expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).toBe("UNPAID");
      }
      await updateOrderStatus(order.id, { status: "DELIVERED" }, admin);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).toBe("PAID");
    });

    it("REFUNDED requires a recorded refund, and never touches stock", async () => {
      const { variants } = await createStockedProduct({ stocks: [5] });
      const v = variants[0]!;
      const order = await placeOrder([{ variantId: v.id, quantity: 2 }]);
      await updateOrderStatus(order.id, { status: "DELIVERED" }, admin);
      await expectRefused(updateOrderStatus(order.id, { status: "REFUNDED" }, admin));

      await refundOrderPayment(order.id, { amount: Number(order.total) }, admin);
      await updateOrderStatus(order.id, { status: "REFUNDED" }, admin);
      // The customer kept the goods (refund without return): the old code restocked 2 here.
      expect(await stockOf(v.id)).toBe(3);
      await assertInventoryInvariants(v.id);
    });

    it("a late gateway success on a cancelled order keeps it cancelled (paid → refund queue), stock untouched", async () => {
      const { variants } = await createStockedProduct({ stocks: [5] });
      const v = variants[0]!;
      const order = await placeOrder([{ variantId: v.id, quantity: 1 }], { paymentMethod: "SSLCOMMERZ" });
      await updateOrderStatus(order.id, { status: "CANCELLED" }, admin);
      const ref = `vt${RUN}late`.slice(0, 30);
      await prisma.paymentSession.create({
        data: { orderId: order.id, provider: "SSLCOMMERZ", status: "ACTIVE", gatewayTransactionRef: ref, expiresAt: new Date(Date.now() + 3600_000) },
      });
      await settlePaymentSession(ref, "bank-tx-1", Number(order.total));
      const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(after.status).toBe("CANCELLED"); // the old code flipped it to CONFIRMED with its stock already released
      expect(after.paymentStatus).toBe("PAID");
      expect(await stockOf(v.id)).toBe(5);
    });

    it("a gateway success on a PENDING order confirms it through the state machine", async () => {
      const { variants } = await createStockedProduct({ stocks: [5] });
      const order = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }], { paymentMethod: "SSLCOMMERZ" });
      const ref = `vt${RUN}ok`.slice(0, 30);
      await prisma.paymentSession.create({
        data: { orderId: order.id, provider: "SSLCOMMERZ", status: "ACTIVE", gatewayTransactionRef: ref, expiresAt: new Date(Date.now() + 3600_000) },
      });
      await settlePaymentSession(ref, "bank-tx-2", Number(order.total));
      const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect([after.status, after.paymentStatus]).toEqual(["CONFIRMED", "PAID"]);
      expect(await historyStatuses(order.id)).toEqual(["PENDING", "CONFIRMED"]);
    });
  });

  describe("returns", () => {
    it("RETURNED records the return; receiving the parcel restocks once — a later REFUNDED and moving to Trash restock nothing more", async () => {
      const { variants } = await createStockedProduct({ stocks: [10] });
      const v = variants[0]!;
      const order = await placeOrder([{ variantId: v.id, quantity: 3 }]);
      await updateOrderStatus(order.id, { status: "DELIVERED" }, admin);
      await updateOrderStatus(order.id, { status: "RETURNED" }, admin);
      expect(await stockOf(v.id)).toBe(7); // owner decision M2: nothing is sellable until the parcel is back
      let line = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
      expect([line.returnedQuantity, line.restockedQuantity]).toEqual([3, 0]);
      await receiveReturnedParcel(order.id, admin, {});
      expect(await stockOf(v.id)).toBe(10);
      line = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
      expect([line.returnedQuantity, line.restockedQuantity]).toEqual([3, 3]);

      await refundOrderPayment(order.id, { amount: Number(order.total) }, admin);
      await updateOrderStatus(order.id, { status: "REFUNDED" }, admin);
      await deleteOrder(order.id, admin);
      expect(await stockOf(v.id)).toBe(10); // old code: 13 after REFUNDED, 16 after Trash
      await assertInventoryInvariants(v.id);
    });

    it("approving a return request moves the order to RETURNED; the stock waits for the parcel", async () => {
      const { variants } = await createStockedProduct({ stocks: [10] });
      const v = variants[0]!;
      const order = await placeOrder([{ variantId: v.id, quantity: 2 }]);
      await updateOrderStatus(order.id, { status: "DELIVERED" }, admin);
      const request = await prisma.returnRequest.create({ data: { orderId: order.id, customerId: order.customerId!, reason: "Too small" } });

      await reviewReturnRequest(request.id, { status: "APPROVED" }, admin);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("RETURNED");
      expect(await stockOf(v.id)).toBe(8);
      await receiveReturnedParcel(order.id, admin, {});
      expect(await stockOf(v.id)).toBe(10);
      await assertInventoryInvariants(v.id);
    });

    it("approving a return for an order that isn't delivered rolls everything back (request stays PENDING)", async () => {
      const { variants } = await createStockedProduct({ stocks: [10] });
      const v = variants[0]!;
      const order = await placeOrder([{ variantId: v.id, quantity: 2 }]);
      await updateOrderStatus(order.id, { status: "CANCELLED" }, admin);
      const request = await prisma.returnRequest.create({ data: { orderId: order.id, customerId: order.customerId!, reason: "Changed mind" } });

      await expectRefused(reviewReturnRequest(request.id, { status: "APPROVED" }, admin));
      expect((await prisma.returnRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("PENDING");
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("CANCELLED");
      expect(await stockOf(v.id)).toBe(10);
    });

    it("partial delivery: reconciling some units, then RETURNED, then receiving the parcel restocks each unit once", async () => {
      const { variants } = await createStockedProduct({ stocks: [10] });
      const v = variants[0]!;
      const order = await placeOrder([{ variantId: v.id, quantity: 3 }]);
      await updateOrderStatus(order.id, { status: "SHIPPED" }, admin);
      await updateOrderStatus(order.id, { status: "PARTIALLY_DELIVERED" }, admin);
      const line = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
      await reconcilePartialDelivery(order.id, { items: [{ orderItemId: line.id, returnedQuantity: 1 }] }, admin);
      expect(await stockOf(v.id)).toBe(7);

      await updateOrderStatus(order.id, { status: "RETURNED" }, admin);
      expect((await prisma.orderItem.findUniqueOrThrow({ where: { id: line.id } })).returnedQuantity).toBe(3); // the remaining 2, not 3 more
      await receiveReturnedParcel(order.id, admin, {});
      expect(await stockOf(v.id)).toBe(10);
      await assertInventoryInvariants(v.id);
    });
  });

  describe("parcel received back: good, damaged, lost", () => {
    const shipThenCancel = async (orderId: string) => {
      await updateOrderStatus(orderId, { status: "SHIPPED" }, admin);
      await updateOrderStatus(orderId, { status: "CANCELLED" }, admin);
    };

    it("puts the good units back, writes the damaged one off (outside the order), and leaves the rest outstanding", async () => {
      const { variants } = await createStockedProduct({ stocks: [10] });
      const v = variants[0]!;
      const order = await placeOrder([{ variantId: v.id, quantity: 3 }]);
      await shipThenCancel(order.id);
      expect(await stockOf(v.id)).toBe(7);
      const [line] = await prisma.orderItem.findMany({ where: { orderId: order.id } });

      await receiveReturnedParcel(order.id, admin, { lines: [{ orderItemId: line!.id, quantity: 2, damaged: 1 }], damageNote: "box crushed" });
      expect(await stockOf(v.id)).toBe(8); // 1 good back; the damaged one came back and went straight out
      const written = await prisma.stockMovement.findMany({ where: { sourceType: "OrderParcelReceipt", sourceId: order.id } });
      expect(written.map((m) => [m.reason, m.change, m.orderId])).toEqual([["DAMAGED", -1, null]]);
      expect(written[0]!.note).toContain(order.orderNumber);
      expect(written[0]!.note).toContain("box crushed");
      const history = await prisma.orderStatusHistory.findFirstOrThrow({ where: { orderId: order.id }, orderBy: { createdAt: "desc" } });
      expect(history.note).toContain("1 good, 1 damaged");
      expect(history.note).toContain("1 still out");
      await assertInventoryInvariants(v.id);

      // The last unit never comes back: the courier lost it. It closes the parcel without touching sellable stock.
      await receiveReturnedParcel(order.id, admin, { lines: [{ orderItemId: line!.id, quantity: 0, lost: 1 }] });
      expect(await stockOf(v.id)).toBe(8);
      const lost = await prisma.stockMovement.findMany({ where: { sourceType: "OrderParcelReceipt", sourceId: order.id, reason: "LOST" } });
      expect(lost.map((m) => m.change)).toEqual([-1]);
      await expect(receiveReturnedParcel(order.id, admin, {})).rejects.toMatchObject({ details: { code: "NOTHING_TO_RECEIVE" } });
      await assertInventoryInvariants(v.id);
    });

    it("refuses more damaged or lost units than are still outstanding, and changes nothing", async () => {
      const { variants } = await createStockedProduct({ stocks: [5] });
      const v = variants[0]!;
      const order = await placeOrder([{ variantId: v.id, quantity: 2 }]);
      await shipThenCancel(order.id);
      const [line] = await prisma.orderItem.findMany({ where: { orderId: order.id } });
      await expectRefused(receiveReturnedParcel(order.id, admin, { lines: [{ orderItemId: line!.id, quantity: 2, lost: 1 }] }));
      await expectRefused(receiveReturnedParcel(order.id, admin, { lines: [{ orderItemId: line!.id, quantity: 1, damaged: 2 }] }));
      expect(await stockOf(v.id)).toBe(3);
      expect((await prisma.orderItem.findUniqueOrThrow({ where: { id: line!.id } })).restockedQuantity).toBe(0);
    });

    it("a partial delivery's damaged unit is judged at receipt: refused at reconciliation, written off when the parcel arrives", async () => {
      const { variants } = await createStockedProduct({ stocks: [10] });
      const v = variants[0]!;
      const order = await placeOrder([{ variantId: v.id, quantity: 3 }]);
      await updateOrderStatus(order.id, { status: "SHIPPED" }, admin);
      await updateOrderStatus(order.id, { status: "PARTIALLY_DELIVERED" }, admin);
      const line = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
      await expectRefused(reconcilePartialDelivery(order.id, { items: [{ orderItemId: line.id, returnedQuantity: 1, damaged: 2 }] }, admin));
      await expectRefused(reconcilePartialDelivery(order.id, { items: [{ orderItemId: line.id, returnedQuantity: 2, damaged: 1 }] }, admin));
      await reconcilePartialDelivery(order.id, { items: [{ orderItemId: line.id, returnedQuantity: 2 }] }, admin);
      expect(await stockOf(v.id)).toBe(7);
      const rr = await prisma.returnRequest.findFirstOrThrow({ where: { orderId: order.id } });
      expect(rr.lines).toMatchObject([{ orderItemId: line.id, quantity: 2, restocked: 0, writtenOff: 0 }]);
      await receiveReturnedParcel(order.id, admin, { lines: [{ orderItemId: line.id, quantity: 2, damaged: 1 }] });
      expect(await stockOf(v.id)).toBe(8); // 7 + 2 back − 1 damaged
      expect(await prisma.stockMovement.count({ where: { sourceType: "OrderParcelReceipt", sourceId: order.id, reason: "DAMAGED" } })).toBe(1);
      await assertInventoryInvariants(v.id);
    });

    it("a customer return's damaged unit is written off at receipt, not at approval", async () => {
      const { variants } = await createStockedProduct({ stocks: [10] });
      const v = variants[0]!;
      const order = await placeOrder([{ variantId: v.id, quantity: 2 }]);
      await updateOrderStatus(order.id, { status: "DELIVERED" }, admin);
      const line = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
      const request = await prisma.returnRequest.create({ data: { orderId: order.id, customerId: order.customerId!, reason: "Torn" } });
      await expectRefused(reviewReturnRequest(request.id, { status: "APPROVED", damaged: [{ orderItemId: line.id, quantity: 1 }] }, admin));
      expect((await prisma.returnRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("PENDING");

      await reviewReturnRequest(request.id, { status: "APPROVED" }, admin);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("RETURNED");
      expect(await stockOf(v.id)).toBe(8);
      await expectRefused(receiveReturnedParcel(order.id, admin, { lines: [{ orderItemId: line.id, quantity: 3, damaged: 1 }] }));
      await receiveReturnedParcel(order.id, admin, { lines: [{ orderItemId: line.id, quantity: 2, damaged: 1 }] });
      expect(await stockOf(v.id)).toBe(9);
      const out = await prisma.stockMovement.findMany({ where: { sourceType: "OrderParcelReceipt", sourceId: order.id } });
      expect(out.map((m) => [m.reason, m.change])).toEqual([["DAMAGED", -1]]);
      await assertInventoryInvariants(v.id);
    });

    it("damaged units at receipt are capped at what is still waiting to come back", async () => {
      const { variants } = await createStockedProduct({ stocks: [10] });
      const v = variants[0]!;
      const order = await placeOrder([{ variantId: v.id, quantity: 3 }]);
      await updateOrderStatus(order.id, { status: "DELIVERED" }, admin);
      const line = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
      // 2 of 3 already came back through an item return; the customer return brings back the last one.
      await recordItemReturn(order.id, { items: [{ orderItemId: line.id, quantity: 2, restock: true }], reason: "size", compensation: "NONE" }, admin, `dmg-cap-${order.id}`);
      expect(await stockOf(v.id)).toBe(7);
      await receiveReturnedParcel(order.id, admin, {});
      expect(await stockOf(v.id)).toBe(9);
      const request = await prisma.returnRequest.create({ data: { orderId: order.id, customerId: order.customerId!, reason: "Torn" } });
      await reviewReturnRequest(request.id, { status: "APPROVED" }, admin);
      expect(await stockOf(v.id)).toBe(9);
      await expectRefused(receiveReturnedParcel(order.id, admin, { lines: [{ orderItemId: line.id, quantity: 2, damaged: 2 }] }));
      await receiveReturnedParcel(order.id, admin, { lines: [{ orderItemId: line.id, quantity: 1, damaged: 1 }] });
      expect(await stockOf(v.id)).toBe(9); // the last unit came back and was written off; the 2 earlier ones stay
      await assertInventoryInvariants(v.id);
    });

    it("refuses the same item listed twice when a parcel is received", async () => {
      const { variants } = await createStockedProduct({ stocks: [5] });
      const order = await placeOrder([{ variantId: variants[0]!.id, quantity: 2 }]);
      await shipThenCancel(order.id);
      const [line] = await prisma.orderItem.findMany({ where: { orderId: order.id } });
      await expectRefused(receiveReturnedParcel(order.id, admin, { lines: [{ orderItemId: line!.id, quantity: 1, damaged: 1 }, { orderItemId: line!.id, quantity: 1 }] }));
      const res = await (await asOwner()).post(`/api/orders/${order.id}/receive-return`, { lines: [{ orderItemId: line!.id, quantity: 1, damaged: 1 }, { orderItemId: line!.id, quantity: 1 }] });
      expect(res.status).toBe(400);
      expect(await stockOf(variants[0]!.id)).toBe(3);
    });

    it("the HTTP route takes damaged counts", async () => {
      const { variants } = await createStockedProduct({ stocks: [5] });
      const order = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
      await shipThenCancel(order.id);
      const [line] = await prisma.orderItem.findMany({ where: { orderId: order.id } });
      const res = await (await asOwner()).post(`/api/orders/${order.id}/receive-return`, { lines: [{ orderItemId: line!.id, quantity: 1, damaged: 1 }] });
      expect(res.status).toBe(200);
      expect(await stockOf(variants[0]!.id)).toBe(4);
    });
  });

  describe("trash and restore", () => {
    it("trashing a pending order releases its stock; restoring re-reserves it", async () => {
      const { variants } = await createStockedProduct({ stocks: [10] });
      const v = variants[0]!;
      const order = await placeOrder([{ variantId: v.id, quantity: 4 }]);
      await deleteOrder(order.id, admin);
      expect(await stockOf(v.id)).toBe(10);
      await restoreOrder(order.id, admin);
      expect(await stockOf(v.id)).toBe(6);
      // …and a cancel afterwards releases exactly the re-reserved units.
      await updateOrderStatus(order.id, { status: "CANCELLED" }, admin);
      expect(await stockOf(v.id)).toBe(10);
      await assertInventoryInvariants(v.id);
    });

    it("restore is refused (and changes nothing) when the released stock has been sold since", async () => {
      const { variants } = await createStockedProduct({ stocks: [4] });
      const v = variants[0]!;
      const order = await placeOrder([{ variantId: v.id, quantity: 4 }]);
      await deleteOrder(order.id, admin);
      await placeOrder([{ variantId: v.id, quantity: 3 }]);
      await expectRefused(restoreOrder(order.id, admin), 409);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).deletedAt).not.toBeNull();
      expect(await stockOf(v.id)).toBe(1);
      await assertInventoryInvariants(v.id);
    });

    it("trashing a delivered order changes no stock (the goods are with the customer)", async () => {
      const { variants } = await createStockedProduct({ stocks: [10] });
      const v = variants[0]!;
      const order = await placeOrder([{ variantId: v.id, quantity: 2 }]);
      await updateOrderStatus(order.id, { status: "DELIVERED" }, admin);
      await deleteOrder(order.id, admin);
      expect(await stockOf(v.id)).toBe(8); // old code put these 2 back
      await expectRefused(updateOrderStatus(order.id, { status: "RETURNED" }, admin)); // trashed orders are frozen
    });
  });
});
