import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma";
import { asOwner, cleanupFixtures, createStockedProduct, ownerId, placeOrder } from "../../test-fixtures";
import { updateOrderStatus } from "./order.service";

// Possible duplicates (2026-11-20): the same phone placing another open order within 48 hours is flagged on both orders
// (list and detail) until they ship — "Duplicate order" was a common cancel reason, found only after a call.

afterAll(async () => {
  await cleanupFixtures();
});

const phone = (n: number) => `0171${String(Date.now() % 1_000_000).padStart(6, "0")}${n}`.slice(0, 11);

describe("possible duplicate orders", () => {
  it("two open orders from one phone within 48 hours point at each other; a third phone, a cancelled one and an old one don't", async () => {
    const owner = await asOwner();
    const admin = await ownerId();
    const { variants } = await createStockedProduct({ stocks: [20] });
    const item = [{ variantId: variants[0]!.id, quantity: 1 }];
    const p = phone(1);
    const first = await placeOrder(item, { customerPhone: p } as never);
    const second = await placeOrder(item, { customerPhone: `+88${p}` } as never); // same number, another spelling
    const other = await placeOrder(item, { customerPhone: phone(2) } as never);
    const cancelled = await placeOrder(item, { customerPhone: phone(3) } as never);
    const lone = await placeOrder(item, { customerPhone: phone(3) } as never);
    await updateOrderStatus(cancelled.id, { status: "CANCELLED", note: "test", cancelReason: "OTHER" } as never, admin);
    const old = await placeOrder(item, { customerPhone: phone(4) } as never);
    const recent = await placeOrder(item, { customerPhone: phone(4) } as never);
    await prisma.order.update({ where: { id: old.id }, data: { createdAt: new Date(Date.now() - 4 * 86_400_000) } });

    const res = await owner.get(`/api/orders?pageSize=200&search=${encodeURIComponent(p.slice(-8))}`);
    const byId = new Map(res.body.items.map((o: { id: string; possibleDuplicateOf: unknown }) => [o.id, o.possibleDuplicateOf]));
    expect(byId.get(first.id)).toEqual({ id: second.id, orderNumber: second.orderNumber });
    expect(byId.get(second.id)).toEqual({ id: first.id, orderNumber: first.orderNumber });

    const list = await owner.get(`/api/orders?pageSize=200&sortBy=createdAt&sortDir=desc`);
    const all = new Map(list.body.items.map((o: { id: string; possibleDuplicateOf: unknown }) => [o.id, o.possibleDuplicateOf]));
    expect(all.get(other.id)).toBeNull();
    expect(all.get(lone.id)).toBeNull(); // its twin was cancelled
    expect(all.get(recent.id)).toBeNull(); // its twin is 4 days old

    const detail = await owner.get(`/api/orders/${first.id}`);
    expect(detail.body.order.possibleDuplicateOf).toEqual({ id: second.id, orderNumber: second.orderNumber });

    // Once it ships, the flag is gone (the parcel already left).
    for (const s of ["CONFIRMED", "SHIPPED"] as const) await updateOrderStatus(second.id, { status: s }, admin);
    const after = await owner.get(`/api/orders/${second.id}`);
    expect(after.body.order.possibleDuplicateOf).toBeNull();
  });
});
