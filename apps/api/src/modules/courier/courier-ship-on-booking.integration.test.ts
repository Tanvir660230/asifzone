import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { overrideIntegrationsForTests } from "../../config/integration-overrides";
import { prisma } from "../../config/prisma";
import { cleanupFixtures, createStockedProduct, ownerId, placeOrder } from "../../test-fixtures";
import { updateOrderStatus } from "../orders/order.service";
import { BOOKED_NOT_PROCESSING_REPAIR_WINDOW_MS, bookOrderWithSteadfast, bookOrdersWithSteadfastBulk, syncPendingCourierStatuses } from "./courier.service";

// Owner, 2026-11-19 (replaces D-AA3 of 2026-10-25): a booking only proves Steadfast has a record — the parcel is still
// here. Booking moves a pending or confirmed order to PROCESSING (being packed); it never ships it. The order becomes
// SHIPPED when the parcel is handed to the rider (dispatch scan, parcel-scan.integration.test.ts).

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

describe("booking with Steadfast puts the order in Processing", () => {
  it("a pending order goes through Confirmed to Processing when it is booked — not Shipped", async () => {
    const order = await newOrder();
    const booked = await bookOrderWithSteadfast(order.id);
    expect(booked.status).toBe("PROCESSING");
    expect((await history(order.id)).slice(-2)).toEqual(["CONFIRMED", "PROCESSING"]);
  });

  it("a confirmed order moves to Processing; one already Packed stays Packed", async () => {
    const admin = await ownerId();
    const confirmed = await newOrder();
    await updateOrderStatus(confirmed.id, { status: "CONFIRMED" }, admin);
    expect((await bookOrderWithSteadfast(confirmed.id)).status).toBe("PROCESSING");

    const packed = await newOrder();
    for (const s of ["CONFIRMED", "PROCESSING", "PACKED"] as const) await updateOrderStatus(packed.id, { status: s }, admin);
    expect((await bookOrderWithSteadfast(packed.id)).status).toBe("PACKED");
  });

  it("bulk booking moves every booked order to Processing", async () => {
    const a = await newOrder();
    const b = await newOrder();
    const res = await bookOrdersWithSteadfastBulk([a.id, b.id]);
    expect(res.booked.map((x) => x.orderId).sort()).toEqual([a.id, b.id].sort());
    const rows = await prisma.order.findMany({ where: { id: { in: [a.id, b.id] } }, select: { status: true } });
    expect(rows.map((r) => r.status)).toEqual(["PROCESSING", "PROCESSING"]);
  });
});

describe("the courier sweep moves on a booking left at Pending (P0.5)", () => {
  async function bookedButStuck(bookedAt: Date) {
    const order = await newOrder();
    seq++;
    await prisma.order.update({
      where: { id: order.id },
      data: { carrier: "Steadfast", courierConsignmentId: String(seq), trackingNumber: `TRK-R${seq}`, courierStatus: "in_review", courierBookedAt: bookedAt },
    });
    return order;
  }

  it("moves a recent booking left at Pending to Processing, through Confirmed", async () => {
    const order = await bookedButStuck(new Date());
    await syncPendingCourierStatuses();
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PROCESSING");
    expect((await history(order.id)).slice(-2)).toEqual(["CONFIRMED", "PROCESSING"]);
  });

  it("leaves a booking older than the repair window alone", async () => {
    const order = await bookedButStuck(new Date(Date.now() - BOOKED_NOT_PROCESSING_REPAIR_WINDOW_MS - 60_000));
    await syncPendingCourierStatuses();
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PENDING");
  });
});
