import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { permissionsForRole, type ReceiveParcelInput } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { cleanupFixtures, createStockedProduct, ownerId, placeOrder, stockOf, trackOrder } from "../../test-fixtures";
import { updateOrderStatus } from "../orders/order.service";
import { getParcelView, receiveParcel } from "../parcel-scans/parcel-receive.service";
import { resolveParcelCode } from "../parcel-scans/parcel-resolve.service";
import { createDoorSwap } from "./door-swap.service";
import { reviewDoorSwaps, settleDoorSwap } from "./door-swap-outcome.service";

// Every way a door swap ends (door-swap-outcome.service.ts): what Steadfast tells us, what staff say, what the scan shows.

let admin: string;
let viewer: { adminId: string; permissions: ReturnType<typeof permissionsForRole> };
beforeAll(async () => {
  admin = await ownerId();
  viewer = { adminId: admin, permissions: permissionsForRole("OWNER") };
});
afterAll(async () => {
  await cleanupFixtures();
});

/** A delivered order of variant A swapped to B (fee 60): protected COD 1450, exchange total 60. */
async function swap() {
  const { variants } = await createStockedProduct({ stocks: [5, 5], basePrice: 1390 });
  const order = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
  await updateOrderStatus(order.id, { status: "DELIVERED" }, admin);
  const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
  const r = await createDoorSwap(order.id, { orderItemId: item.id, requestedVariantId: variants[1]!.id, reason: "CUSTOMER_SIZE", fee: 60 }, admin, null);
  trackOrder(r.exchangeOrder!.id);
  return { order, item, a: variants[0]!.id, b: variants[1]!.id, requestId: r.requestId!, replacementId: r.exchangeOrder!.id };
}

/** As the courier leaves it: booked, shipped, then delivered with what Steadfast says it collected. */
async function deliveredByCourier(replacementId: string, codNow: number | null) {
  await prisma.order.update({ where: { id: replacementId }, data: { courierConsignmentId: `9${Date.now().toString().slice(-9)}`, courierBookedAt: new Date(), courierCodBooked: 1450, courierCodNow: codNow } });
  await updateOrderStatus(replacementId, { status: "DELIVERED" }, admin);
}

const returned = async (itemId: string) => (await prisma.orderItem.findUniqueOrThrow({ where: { id: itemId } })).returnedQuantity;
const status = async (id: string) => (await prisma.returnRequest.findUniqueOrThrow({ where: { id } })).swapStatus;

describe("door swap outcomes", () => {
  it("swapped at the door: Steadfast's lowered COD settles it; the replacement's code opens the original on the receive station; the old item scanned in closes it", async () => {
    const s = await swap();
    await deliveredByCourier(s.replacementId, 60);
    await reviewDoorSwaps();
    expect(await status(s.requestId)).toBe("SWAPPED");

    const replacement = await prisma.order.findUniqueOrThrow({ where: { id: s.replacementId } });
    const resolved = await resolveParcelCode(replacement.courierConsignmentId!, "RETURN");
    expect(resolved.orderId).toBe(s.order.id);
    expect(resolved.message).toContain("old item from exchange parcel");

    const stockA = await stockOf(s.a);
    const card = await getParcelView(s.order.id, viewer);
    expect(card.receive.mode).toBe("INSPECT");
    await receiveParcel(
      { orderId: s.order.id, version: card.version, lines: [{ orderItemId: s.item.id, kept: 0, good: 1, damaged: 0, missing: 0, wrong: 0, other: 0 }] } as ReceiveParcelInput,
      viewer,
      `swap-rcv-${Date.now()}`,
    );
    expect(await stockOf(s.a)).toBe(stockA + 1);
    expect(await status(s.requestId)).toBe("OLD_RECEIVED");
  });

  it("delivered at the full protected price: left for a person with a note, then 'kept both' makes the replacement a full-price sale", async () => {
    const s = await swap();
    await deliveredByCourier(s.replacementId, null);
    await reviewDoorSwaps();
    const req = await prisma.returnRequest.findUniqueOrThrow({ where: { id: s.requestId } });
    expect([req.swapStatus, req.swapNote]).toEqual(["AWAITING_SWAP", "Delivered at the full 1450 — check: kept both, or the rider forgot to lower the COD"]);

    await settleDoorSwap(s.requestId, "KEPT_BOTH", { adminId: admin, source: "STAFF" });
    const after = await prisma.returnRequest.findUniqueOrThrow({ where: { id: s.requestId } });
    expect([after.swapStatus, after.exchangeOrderId, after.keptOrderId]).toEqual(["KEPT_BOTH", null, s.replacementId]);
    expect(Number((await prisma.order.findUniqueOrThrow({ where: { id: s.replacementId } })).total)).toBe(1450);
    expect(await returned(s.item.id)).toBe(0); // the old item stays sold
  });

  it("refused: Steadfast returns the new item — the old item stays sold", async () => {
    const s = await swap();
    await prisma.order.update({ where: { id: s.replacementId }, data: { courierConsignmentId: `9${Date.now().toString().slice(-9)}`, courierBookedAt: new Date() } });
    await updateOrderStatus(s.replacementId, { status: "SHIPPED" }, admin);
    await updateOrderStatus(s.replacementId, { status: "CANCELLED" }, admin);
    await reviewDoorSwaps();
    expect(await status(s.requestId)).toBe("REFUSED");
    expect(await returned(s.item.id)).toBe(0);
  });

  it("called off before it left: the replacement is cancelled and its stock is back; not once it is booked", async () => {
    const s = await swap();
    const stockB = await stockOf(s.b);
    await settleDoorSwap(s.requestId, "CANCELLED", { adminId: admin, source: "STAFF" }, "Customer changed their mind");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: s.replacementId } })).status).toBe("CANCELLED");
    expect(await stockOf(s.b)).toBe(stockB + 1);
    expect(await returned(s.item.id)).toBe(0);

    const booked = await swap();
    await prisma.order.update({ where: { id: booked.replacementId }, data: { courierConsignmentId: `9${Date.now().toString().slice(-9)}` } });
    await expect(settleDoorSwap(booked.requestId, "CANCELLED", { adminId: admin, source: "STAFF" })).rejects.toMatchObject({ statusCode: 409 });
  });

  it("old item late: flagged after 5 days; a late scan still closes it; finished outcomes can't be changed", async () => {
    const s = await swap();
    await settleDoorSwap(s.requestId, "SWAPPED", { adminId: admin, source: "STAFF" });
    await prisma.returnRequest.update({ where: { id: s.requestId }, data: { swapSettledAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000) } });
    await reviewDoorSwaps();
    expect(await status(s.requestId)).toBe("OLD_MISSING");
    await expect(settleDoorSwap(s.requestId, "REFUSED", { adminId: admin, source: "STAFF" })).rejects.toMatchObject({ statusCode: 409, details: { code: "SWAP_OUTCOME_NOT_ALLOWED" } });

    const card = await getParcelView(s.order.id, viewer);
    await receiveParcel(
      { orderId: s.order.id, version: card.version, lines: [{ orderItemId: s.item.id, kept: 0, good: 0, damaged: 1, missing: 0, wrong: 0, other: 0 }] } as ReceiveParcelInput,
      viewer,
      `swap-late-${Date.now()}`,
    );
    expect(await status(s.requestId)).toBe("OLD_RECEIVED");
  });
});
