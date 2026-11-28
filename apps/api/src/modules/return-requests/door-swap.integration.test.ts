import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma";
import { asOwner, cleanupFixtures, createStockedProduct, ownerId, placeOrder, stockOf, trackOrder } from "../../test-fixtures";
import { updateOrderStatus } from "../orders/order.service";
import { createDoorSwap, listOrderExchanges, swapCourierFacts } from "./door-swap.service";

let admin: string;
beforeAll(async () => {
  admin = await ownerId();
});
afterAll(async () => {
  await cleanupFixtures();
});

/** A delivered Dhaka order (fee inside Dhaka = the test store's Dhaka zone fee) of variant A; variant B in stock. */
async function delivered(opts: { prices?: Array<number | null>; daysAgo?: number } = {}) {
  const { variants } = await createStockedProduct({ stocks: [5, 5], basePrice: 1390, variantPrices: opts.prices });
  const order = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
  await updateOrderStatus(order.id, { status: "DELIVERED" }, admin);
  if (opts.daysAgo) {
    await prisma.orderStatusHistory.updateMany({
      where: { orderId: order.id, status: "DELIVERED" },
      data: { createdAt: new Date(Date.now() - opts.daysAgo * 24 * 60 * 60 * 1000) },
    });
  }
  const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
  return { order, item, a: variants[0]!.id, b: variants[1]!.id };
}

const track = (r: { exchangeOrder: { id: string } | null }) => r.exchangeOrder && trackOrder(r.exchangeOrder.id);

describe("door-swap exchange", () => {
  it("customer's size change: replacement collects the fee, the parcel is protected with the full price, original stays delivered", async () => {
    const { order, item, a, b } = await delivered();
    const r = await createDoorSwap(order.id, { orderItemId: item.id, requestedVariantId: b, reason: "CUSTOMER_SIZE" }, admin, null);
    track(r);
    expect(r.fee).toBeGreaterThan(0);
    expect(r.total).toBe(r.fee);
    expect(r.protectedCod).toBe(r.fee + 1390);
    const ex = await prisma.order.findUniqueOrThrow({ where: { id: r.exchangeOrder!.id } });
    expect([Number(ex.subtotal), Number(ex.discount), Number(ex.shippingFee), Number(ex.total)]).toEqual([1390, 1390, r.fee, r.fee]);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("DELIVERED");
    expect(await stockOf(a)).toBe(4); // the old unit is not back on the shelf until its parcel is scanned
    expect(await stockOf(b)).toBe(4);
    const req = await prisma.returnRequest.findUniqueOrThrow({ where: { id: r.requestId! } });
    expect([req.swap, req.swapStatus, req.exchangeReason, req.status]).toEqual([true, "AWAITING_SWAP", "CUSTOMER_SIZE", "APPROVED"]);
  });

  it("damaged item (our fault): free, the parcel still protects the full price", async () => {
    const { order, item, b } = await delivered();
    const r = await createDoorSwap(order.id, { orderItemId: item.id, requestedVariantId: b, reason: "DEFECT", evidenceNote: "WhatsApp photo: torn sleeve" }, admin, null);
    track(r);
    expect([r.fee, r.total, r.protectedCod]).toEqual([0, 0, 1390]);
  });

  it("a pricier replacement adds the difference", async () => {
    const { order, item, b } = await delivered({ prices: [null, 1590] });
    const r = await createDoorSwap(order.id, { orderItemId: item.id, requestedVariantId: b, reason: "CUSTOMER_SIZE", fee: 60 }, admin, null);
    track(r);
    expect([r.fee, r.total, r.protectedCod]).toEqual([60, 260, 1650]);
  });

  it("past the window: refused without a reason, recorded with one", async () => {
    const { order, item, b } = await delivered({ daysAgo: 4 });
    await expect(createDoorSwap(order.id, { orderItemId: item.id, requestedVariantId: b, reason: "CUSTOMER_SIZE" }, admin, null)).rejects.toMatchObject({
      statusCode: 409,
      details: { code: "EXCHANGE_WINDOW_PASSED" },
    });
    const r = await createDoorSwap(order.id, { orderItemId: item.id, requestedVariantId: b, reason: "CUSTOMER_SIZE", overrideReason: "Customer was travelling" }, admin, null);
    track(r);
    expect((await prisma.returnRequest.findUniqueOrThrow({ where: { id: r.requestId! } })).overrideReason).toBe("Customer was travelling");
  });

  it("one open swap per item; the same key twice is one exchange", async () => {
    const { order, item, b } = await delivered();
    const key = `swap-${Date.now()}`;
    const first = await createDoorSwap(order.id, { orderItemId: item.id, requestedVariantId: b, reason: "CUSTOMER_SIZE" }, admin, key);
    track(first);
    const again = await createDoorSwap(order.id, { orderItemId: item.id, requestedVariantId: b, reason: "CUSTOMER_SIZE" }, admin, key);
    expect(again.requestId).toBe(first.requestId);
    await expect(createDoorSwap(order.id, { orderItemId: item.id, requestedVariantId: b, reason: "CUSTOMER_SIZE" }, admin, null)).rejects.toMatchObject({
      statusCode: 409,
      details: { code: "EXCHANGE_OPEN" },
    });
    expect(await prisma.returnRequest.count({ where: { orderId: order.id } })).toBe(1);
  });

  it("refuses an order that isn't delivered, the same variant, and a sold-out size", async () => {
    const { variants } = await createStockedProduct({ stocks: [5, 0], basePrice: 1390 });
    const open = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
    const openItem = await prisma.orderItem.findFirstOrThrow({ where: { orderId: open.id } });
    await expect(createDoorSwap(open.id, { orderItemId: openItem.id, requestedVariantId: variants[1]!.id, reason: "CUSTOMER_SIZE" }, admin, null)).rejects.toMatchObject({ statusCode: 400 });
    await updateOrderStatus(open.id, { status: "DELIVERED" }, admin);
    await expect(createDoorSwap(open.id, { orderItemId: openItem.id, requestedVariantId: variants[0]!.id, reason: "CUSTOMER_SIZE" }, admin, null)).rejects.toMatchObject({ statusCode: 400 });
    await expect(createDoorSwap(open.id, { orderItemId: openItem.id, requestedVariantId: variants[1]!.id, reason: "CUSTOMER_SIZE" }, admin, null)).rejects.toMatchObject({ statusCode: 409 });
  });

  it("preview writes nothing; the courier facts carry the protected COD and the Bangla rider note", async () => {
    const { order, item, b } = await delivered();
    const p = await createDoorSwap(order.id, { orderItemId: item.id, requestedVariantId: b, reason: "CUSTOMER_SIZE", fee: 60, preview: true }, admin, null);
    expect([p.preview, p.total, p.protectedCod]).toEqual([true, 60, 1450]);
    expect(await prisma.returnRequest.count({ where: { orderId: order.id } })).toBe(0);
    const r = await createDoorSwap(order.id, { orderItemId: item.id, requestedVariantId: b, reason: "CUSTOMER_SIZE", fee: 60 }, admin, null);
    track(r);
    const facts = (await swapCourierFacts([r.exchangeOrder!.id])).get(r.exchangeOrder!.id)!;
    expect(facts.protectedCod).toBe(1450);
    expect(facts.note).toMatch(/^এক্সচেঞ্জ: পুরনো .+ হাতে নিয়ে শুধু ৳60 নিন। পুরনোটা না দিলে ৳1,450 নিন, নইলে নতুনটা ফেরত আনুন।$/);
    const list = await listOrderExchanges(order.id);
    expect(list.map((x) => [x.swap, x.swapStatus, x.total, x.protectedCod])).toEqual([[true, "AWAITING_SWAP", 60, 1450]]);
  });

  it("over HTTP: a reported problem, then a free exchange answering it", async () => {
    const { order, item, b } = await delivered();
    const owner = await asOwner();
    const bad = await owner.post(`/api/orders/${order.id}/issues`, { kind: "TORN", note: "" });
    expect(bad.status).toBe(400);
    const made = await owner.post(`/api/orders/${order.id}/issues`, { orderItemId: item.id, kind: "TORN", channel: "WHATSAPP", note: "Left sleeve torn (photo on WhatsApp)" });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body.issue).toMatchObject({ kind: "TORN", kindLabel: "Torn", channel: "WHATSAPP", resolvedAt: null });
    const ex = await owner.post(`/api/orders/${order.id}/exchanges`, { orderItemId: item.id, requestedVariantId: b, reason: "DEFECT", issueId: made.body.issue.id });
    expect(ex.status, JSON.stringify(ex.body)).toBe(201);
    track(ex.body);
    expect([ex.body.fee, ex.body.total, ex.body.protectedCod]).toEqual([0, 0, 1390]);
    const listed = await owner.get(`/api/orders/${order.id}/exchanges`);
    expect(listed.body.exchanges).toHaveLength(1);
    const issues = await owner.get(`/api/orders/${order.id}/issues`);
    expect(issues.body.issues.map((i: { note: string }) => i.note)).toEqual(["Left sleeve torn (photo on WhatsApp)"]);
  });
});
