import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma";
import { asOwner, cleanupFixtures, createStockedProduct, ownerId, placeOrder } from "../../test-fixtures";
import { updateOrderStatus } from "./order.service";

// Pack scan (Orders audit 2026-11-20): at the packing table a label scan marks its order Packed. Only a confirmed or
// processing order moves; every other code gets a plain answer and nothing changes.

afterAll(async () => {
  await cleanupFixtures();
});

async function orderAt(statuses: Array<"CONFIRMED" | "PROCESSING" | "PACKED" | "SHIPPED">) {
  const { variants } = await createStockedProduct({ stocks: [5] });
  const order = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
  const admin = await ownerId();
  for (const s of statuses) await updateOrderStatus(order.id, { status: s }, admin);
  return order;
}

const statusOf = async (id: string) => (await prisma.order.findUniqueOrThrow({ where: { id } })).status;

describe("POST /api/orders/pack-scan", () => {
  it("a processing order's code marks it Packed, once", async () => {
    const owner = await asOwner();
    const order = await orderAt(["CONFIRMED", "PROCESSING"]);

    const first = await owner.post("/api/orders/pack-scan", { code: order.orderNumber });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ result: "ACCEPTED", orderId: order.id, orderNumber: order.orderNumber, previousStatus: "PROCESSING" });
    expect(await statusOf(order.id)).toBe("PACKED");
    const history = await prisma.orderStatusHistory.findMany({ where: { orderId: order.id, status: "PACKED" } });
    expect(history).toHaveLength(1);
    expect(history[0]!.note).toMatch(/scan/i);

    const again = await owner.post("/api/orders/pack-scan", { code: order.orderNumber.toLowerCase() });
    expect(again.body.result).toBe("ALREADY_PROCESSED");
    expect(await prisma.orderStatusHistory.count({ where: { orderId: order.id, status: "PACKED" } })).toBe(1);
  });

  it("a confirmed order is packed too", async () => {
    const owner = await asOwner();
    const order = await orderAt(["CONFIRMED"]);
    const res = await owner.post("/api/orders/pack-scan", { code: order.orderNumber });
    expect(res.body).toMatchObject({ result: "ACCEPTED", previousStatus: "CONFIRMED" });
    expect(await statusOf(order.id)).toBe("PACKED");
  });

  it("pending, shipped, trashed and unknown codes change nothing", async () => {
    const owner = await asOwner();
    const pending = await orderAt([]);
    const shipped = await orderAt(["CONFIRMED", "SHIPPED"]);
    const trashed = await orderAt(["CONFIRMED", "PROCESSING"]);
    await prisma.order.update({ where: { id: trashed.id }, data: { deletedAt: new Date() } });

    const p = await owner.post("/api/orders/pack-scan", { code: pending.orderNumber });
    expect(p.body.result).toBe("INELIGIBLE");
    expect(p.body.message).toMatch(/confirm/i);
    expect(await statusOf(pending.id)).toBe("PENDING");

    const s = await owner.post("/api/orders/pack-scan", { code: shipped.orderNumber });
    expect(s.body.result).toBe("INELIGIBLE");
    expect(await statusOf(shipped.id)).toBe("SHIPPED");

    const t = await owner.post("/api/orders/pack-scan", { code: trashed.orderNumber });
    expect(t.body.result).toBe("INELIGIBLE");
    expect(await statusOf(trashed.id)).toBe("PROCESSING");

    const u = await owner.post("/api/orders/pack-scan", { code: "NOT-A-REAL-CODE-123" });
    expect(u.body.result).toBe("INVALID");
  });

  it("rejects an empty code", async () => {
    const owner = await asOwner();
    expect((await owner.post("/api/orders/pack-scan", { code: "" })).status).toBe(400);
  });
});
