import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { overrideIntegrationsForTests } from "../../config/integration-overrides";
import { prisma } from "../../config/prisma";
import { cleanupFixtures, createStockedProduct, placeOrder } from "../../test-fixtures";
import { bookOrderWithSteadfast, shipOnBooking, syncPendingCourierStatuses } from "./courier.service";

// Blueprint P0.5 failure injection: the SHIPPED step fails after PACKED was applied. Both steps share one transaction,
// so nothing commits — the order is never left half-way at PACKED — and the courier sweep then ships it.
const failShipped = { on: false };
vi.mock("../orders/order.service", async (importOriginal) => {
  const real = await importOriginal<typeof import("../orders/order.service")>();
  return {
    ...real,
    applyOrderTransition: async (...args: Parameters<typeof real.applyOrderTransition>) => {
      if (failShipped.on && args[2].status === "SHIPPED") throw new Error("injected failure between PACKED and SHIPPED");
      return real.applyOrderTransition(...args);
    },
  };
});

const realFetch = globalThis.fetch;
let restoreSteadfast: () => void = () => {};
let seq = Math.floor(Date.now() / 1000) * 1000 + 900;

beforeAll(() => {
  restoreSteadfast = overrideIntegrationsForTests({ STEADFAST_API_KEY: "test-key", STEADFAST_SECRET_KEY: "test-secret", STEADFAST_BASE_URL: "https://steadfast.invalid/api/v1" });
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (!url.includes("steadfast.invalid")) return realFetch(input as string, init);
    if (url.includes("/status_by_cid/")) return new Response(JSON.stringify({ status: 200, delivery_status: "in_review" }), { status: 200 });
    if (!url.includes("/create_order")) return new Response("{}", { status: 404 });
    seq++;
    return new Response(JSON.stringify({ status: 200, consignment: { consignment_id: seq, tracking_code: `TRK-A${seq}`, status: "in_review", tracking_link: "https://t.invalid" } }), { status: 200 });
  }) as typeof fetch;
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  restoreSteadfast();
  await cleanupFixtures();
});

describe("booking ships in one transaction", () => {
  it("a failure between Packed and Shipped commits neither, and the sweep repairs it", async () => {
    const { variants } = await createStockedProduct({ stocks: [10] });
    const order = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);

    failShipped.on = true;
    await expect(bookOrderWithSteadfast(order.id)).rejects.toThrow(/injected failure/);
    const stuck = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stuck.courierConsignmentId).not.toBeNull();
    expect(stuck.status).toBe("PENDING");
    expect(await prisma.orderStatusHistory.count({ where: { orderId: order.id, status: { in: ["PACKED", "SHIPPED"] } } })).toBe(0);

    failShipped.on = false;
    expect(await syncPendingCourierStatuses()).toBeGreaterThanOrEqual(1);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("SHIPPED");
    // already shipped (a stale status read): nothing moves, and it isn't counted as a repair
    expect(await shipOnBooking(order.id, "PACKED")).toBe(false);
    expect(await prisma.orderStatusHistory.count({ where: { orderId: order.id, status: "SHIPPED" } })).toBe(1);
  });
});
