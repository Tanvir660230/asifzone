import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { overrideIntegrationsForTests } from "../../config/integration-overrides";
import { prisma } from "../../config/prisma";
import { cleanupFixtures, createStockedProduct, ownerId, placeOrder } from "../../test-fixtures";
import { updateOrderStatus } from "../orders/order.service";
import { BOOKED_NOT_SHIPPED_REPAIR_WINDOW_MS, bookOrderWithSteadfast, bookOrdersWithSteadfastBulk, syncPendingCourierStatuses } from "./courier.service";

// Owner, 2026-10-25 (admin audit): booking a parcel with Steadfast means it's leaving — the order becomes SHIPPED at
// booking. Before, it stopped at PACKED and nothing ever moved it on (Steadfast reports no pickup), so 124 live orders sat
// in "Packed" while "Shipped" stayed at 0.

const realFetch = globalThis.fetch;
let restoreSteadfast: () => void = () => {};
let seq = Math.floor(Date.now() / 1000) * 1000 + 700;

function stubSteadfast() {
  globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
    const url = String(input);
    if (!url.includes("steadfast.invalid")) return realFetch(input as string, init as RequestInit);
    if (!url.includes("/create_order")) return new Response("{}", { status: 404 });
    const body = JSON.parse(String(init?.body));
    if (url.endsWith("/create_order/bulk-order")) {
      const payload = JSON.parse(body.data) as Array<{ invoice: string }>;
      return new Response(JSON.stringify({ status: 200, data: payload.map((p) => ({ invoice: p.invoice, consignment_id: ++seq, tracking_code: `TRK${seq}`, status: "success" })) }), { status: 200 });
    }
    seq++;
    return new Response(JSON.stringify({ status: 200, consignment: { consignment_id: seq, tracking_code: `TRK-S${seq}`, status: "in_review", tracking_link: "https://t.invalid" } }), { status: 200 });
  }) as typeof fetch;
}

async function newOrder() {
  const { variants } = await createStockedProduct({ stocks: [10] });
  return placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
}
const history = async (orderId: string) =>
  (await prisma.orderStatusHistory.findMany({ where: { orderId }, orderBy: { createdAt: "asc" }, select: { status: true } })).map((h) => h.status);

beforeAll(() => {
  restoreSteadfast = overrideIntegrationsForTests({ STEADFAST_API_KEY: "test-key", STEADFAST_SECRET_KEY: "test-secret", STEADFAST_BASE_URL: "https://steadfast.invalid/api/v1" });
  stubSteadfast();
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  restoreSteadfast();
  await cleanupFixtures();
});

describe("booking with Steadfast ships the order", () => {
  it("a pending order goes through Packed to Shipped when it is booked", async () => {
    const order = await newOrder();
    const booked = await bookOrderWithSteadfast(order.id);
    expect(booked.status).toBe("SHIPPED");
    const steps = await history(order.id);
    expect(steps.slice(-2)).toEqual(["PACKED", "SHIPPED"]);
  });

  it("an order already marked Packed moves on to Shipped", async () => {
    const order = await newOrder();
    const admin = await ownerId();
    for (const s of ["CONFIRMED", "PROCESSING", "PACKED"] as const) await updateOrderStatus(order.id, { status: s }, admin);
    expect((await bookOrderWithSteadfast(order.id)).status).toBe("SHIPPED");
  });

  it("bulk booking ships every booked order", async () => {
    const a = await newOrder();
    const b = await newOrder();
    const res = await bookOrdersWithSteadfastBulk([a.id, b.id]);
    expect(res.booked.map((x) => x.orderId).sort()).toEqual([a.id, b.id].sort());
    const rows = await prisma.order.findMany({ where: { id: { in: [a.id, b.id] } }, select: { status: true } });
    expect(rows.map((r) => r.status)).toEqual(["SHIPPED", "SHIPPED"]);
  });
});

describe("the courier sweep repairs a booked parcel that never shipped (P0.5)", () => {
  async function bookedButStuck(bookedAt: Date) {
    const order = await newOrder();
    seq++;
    await prisma.order.update({
      where: { id: order.id },
      data: { carrier: "Steadfast", courierConsignmentId: String(seq), trackingNumber: `TRK-R${seq}`, courierStatus: "in_review", courierBookedAt: bookedAt },
    });
    return order;
  }

  it("ships a recent booking left at Pending, through Packed", async () => {
    const order = await bookedButStuck(new Date());
    await syncPendingCourierStatuses();
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("SHIPPED");
    expect((await history(order.id)).slice(-2)).toEqual(["PACKED", "SHIPPED"]);
  });

  it("leaves a booking older than the repair window alone", async () => {
    const order = await bookedButStuck(new Date(Date.now() - BOOKED_NOT_SHIPPED_REPAIR_WINDOW_MS - 60_000));
    await syncPendingCourierStatuses();
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PENDING");
  });
});
