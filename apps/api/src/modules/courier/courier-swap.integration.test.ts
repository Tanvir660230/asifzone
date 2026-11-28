import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The courier client is replaced so booking never reaches Steadfast; it records what it was asked to book.
const booked = vi.hoisted(() => [] as Array<{ invoice: string; codAmount: number; note?: string }>);
vi.mock("../../providers/courier/steadfast", () => ({
  createSteadfastConsignment: vi.fn(async (input: { invoice: string; codAmount: number; note?: string }) => {
    booked.push({ invoice: input.invoice, codAmount: input.codAmount, note: input.note });
    return { consignment_id: Date.now(), tracking_code: `T${Date.now()}`, status: "in_review", tracking_link: null };
  }),
  createBulkSteadfastConsignments: vi.fn(async (inputs: Array<{ invoice: string; codAmount: number; note?: string }>) =>
    inputs.map((input, i) => {
      booked.push({ invoice: input.invoice, codAmount: input.codAmount, note: input.note });
      return { invoice: input.invoice, consignment_id: Date.now() + i, tracking_code: `TB${i}`, status: "in_review", tracking_link: null };
    }),
  ),
  getSteadfastBalance: vi.fn(async () => 0),
  getSteadfastFraudCheck: vi.fn(async () => {
    throw new Error("no courier in tests");
  }),
  getSteadfastStatusByConsignmentId: vi.fn(async () => "in_review"),
}));
import { prisma } from "../../config/prisma";
import { cleanupFixtures, createStockedProduct, ownerId, placeOrder, trackOrder } from "../../test-fixtures";
import { updateOrderStatus } from "../orders/order.service";
import { createDoorSwap } from "../return-requests/door-swap.service";
import { bookOrderWithSteadfast, bookOrdersWithSteadfastBulk } from "./courier.service";

let admin: string;
beforeAll(async () => {
  admin = await ownerId();
});
afterAll(async () => {
  await cleanupFixtures();
});

async function swap() {
  const { variants } = await createStockedProduct({ stocks: [5, 5], basePrice: 1390 });
  const order = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
  await updateOrderStatus(order.id, { status: "DELIVERED" }, admin);
  const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
  const r = await createDoorSwap(order.id, { orderItemId: item.id, requestedVariantId: variants[1]!.id, reason: "CUSTOMER_SIZE", fee: 60 }, admin, null);
  trackOrder(r.exchangeOrder!.id);
  return { exchange: r.exchangeOrder!, plainVariant: variants[0]!.id };
}

describe("courier booking of a door swap", () => {
  it("single booking sends the protected COD and the Bangla rider note; a normal order is unchanged", async () => {
    const { exchange, plainVariant } = await swap();
    await bookOrderWithSteadfast(exchange.id);
    const sent = booked.find((b) => b.invoice === exchange.orderNumber)!;
    expect(sent.codAmount).toBe(1450);
    expect(sent.note).toMatch(/^এক্সচেঞ্জ: পুরনো .+ শুধু ৳60 নিন। পুরনোটা না দিলে ৳1,450 নিন/);
    expect(Number((await prisma.order.findUniqueOrThrow({ where: { id: exchange.id } })).courierCodBooked)).toBe(1450);

    const plain = await placeOrder([{ variantId: plainVariant, quantity: 1 }]);
    await updateOrderStatus(plain.id, { status: "CONFIRMED" }, admin);
    await bookOrderWithSteadfast(plain.id);
    const normal = booked.find((b) => b.invoice === plain.orderNumber)!;
    expect(normal.codAmount).toBe(Number(plain.total));
    expect(normal.note ?? "").not.toMatch(/এক্সচেঞ্জ/);
  });

  it("bulk booking sends the protected COD too", async () => {
    const { exchange } = await swap();
    await bookOrdersWithSteadfastBulk([exchange.id]);
    expect(booked.find((b) => b.invoice === exchange.orderNumber)?.codAmount).toBe(1450);
  });
});
