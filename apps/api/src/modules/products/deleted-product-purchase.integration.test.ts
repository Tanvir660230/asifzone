import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { RUN, asOwner, checkout, cleanupFixtures, createStockedProduct, ownerId, placeOrder, stockOf, trackOrder } from "../../test-fixtures";
import { createManualOrder, updateOrderStatus } from "../orders/order.service";
import { reviewReturnRequest } from "../return-requests/return-request.service";
import { getActiveFlashSaleForHomepage } from "../flash-sales/flash-sale.service";

// A product in Trash (deletedAt set) must never be purchasable — the old checkout only checked isActive, and
// trashing never touched isActive, so any cart still holding the variant could order it.

let admin: string;
let customerCookies: string[];
let csrf: string;
const customerEmail = `vitest-p1-${RUN}@example.com`;

async function trash(productId: string) {
  const res = await (await asOwner()).delete(`/api/products/${productId}`);
  expect([200, 204]).toContain(res.status);
}

beforeAll(async () => {
  admin = await ownerId();
  const register = await request(app).post("/api/customers/register").send({ name: "Vitest P1 Customer", email: customerEmail, password: "SomePass123" });
  customerCookies = register.get("Set-Cookie")!;
  csrf = customerCookies.find((c) => c.startsWith("csrf_token="))!.split(";")[0]!.split("=")[1]!;
});
afterAll(async () => {
  await prisma.flashSale.deleteMany({ where: { name: { startsWith: `Vitest P1 Deleted ${RUN}` } } });
  await cleanupFixtures();
  await prisma.customer.deleteMany({ where: { email: customerEmail } });
  await prisma.$disconnect();
});

describe("deleted products are never purchasable", () => {
  it("checkout refuses a stale cart line for a trashed product and takes no stock", async () => {
    const { product, variants } = await createStockedProduct({ stocks: [5] });
    await trash(product.id);
    const res = await request(app).post("/api/orders").send(checkout([{ variantId: variants[0]!.id, quantity: 1 }]));
    expect(res.status).toBe(400);
    expect(res.body.error ?? res.body.message ?? JSON.stringify(res.body)).toMatch(/no longer available/);
    expect(await stockOf(variants[0]!.id)).toBe(5);
  });

  it("the admin 'Create order' path refuses it too", async () => {
    const { product, variants } = await createStockedProduct({ stocks: [5] });
    await trash(product.id);
    await expect(createManualOrder({ ...checkout([{ variantId: variants[0]!.id, quantity: 1 }]), markPaid: false } as never, admin)).rejects.toThrow(/no longer available/);
    expect(await stockOf(variants[0]!.id)).toBe(5);
  });

  it("a restored product is purchasable again", async () => {
    const { product, variants } = await createStockedProduct({ stocks: [5] });
    await trash(product.id);
    expect((await (await asOwner()).post(`/api/products/${product.id}/restore`)).status).toBe(200);
    const order = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
    expect(order.status).toBe("PENDING");
  });

  it("the public product page and variant data 404", async () => {
    const { product } = await createStockedProduct({ stocks: [5] });
    await trash(product.id);
    expect((await request(app).get(`/api/products/slug/${product.slug}`)).status).toBe(404);
  });

  it("wishlist: can't add it, and an existing entry is hidden (kept for a restore)", async () => {
    const { product } = await createStockedProduct({ stocks: [5] });
    const add = (id: string) => request(app).post("/api/wishlist").set("Cookie", customerCookies).set("X-CSRF-Token", csrf).send({ productId: id });
    expect((await add(product.id)).status).toBe(201);
    await trash(product.id);
    const list = await request(app).get("/api/wishlist").set("Cookie", customerCookies);
    expect(list.body.items.some((i: { product: { id: string } }) => i.product.id === product.id)).toBe(false);
    expect(await prisma.wishlistItem.count({ where: { productId: product.id } })).toBe(1);

    const other = await createStockedProduct({ stocks: [5] });
    await trash(other.product.id);
    expect((await add(other.product.id)).status).toBe(404);
  });

  it("back-in-stock alerts can't be subscribed for it", async () => {
    const { product, variants } = await createStockedProduct({ stocks: [0] });
    await trash(product.id);
    const res = await request(app).post("/api/stock-alerts").set("Cookie", customerCookies).set("X-CSRF-Token", csrf).send({ variantId: variants[0]!.id });
    expect(res.status).toBe(404);
  });

  it("flash sales: can't add it, and a live sale's public feed doesn't advertise it", async () => {
    const live = await createStockedProduct({ stocks: [5] });
    const gone = await createStockedProduct({ stocks: [5] });
    const sale = await prisma.flashSale.create({
      data: {
        name: `Vitest P1 Deleted ${RUN}`,
        startsAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + 90_000), // ends soonest, so it is the one the homepage feed picks
        enabled: true,
        isActive: true,
        items: { create: [{ productId: live.product.id, discountType: "PERCENTAGE", discountValue: 10 }, { productId: gone.product.id, discountType: "PERCENTAGE", discountValue: 10 }] },
      },
    });
    await trash(gone.product.id);
    const addTrashed = await (await asOwner()).post(`/api/flash-sales/${sale.id}/items`, { productId: gone.product.id, discountType: "PERCENTAGE", discountValue: 5 });
    expect(addTrashed.status).toBe(400);

    const feed = await getActiveFlashSaleForHomepage();
    expect(feed?.id, "the test sale is the homepage sale").toBe(sale.id);
    const ids = feed!.items.map((i) => i.productId);
    expect(ids).toContain(live.product.id);
    expect(ids).not.toContain(gone.product.id);
  });

  it("an exchange can't ship a trashed product as the replacement", async () => {
    const original = await createStockedProduct({ stocks: [5] });
    const replacement = await createStockedProduct({ stocks: [5] });
    const order = await placeOrder([{ variantId: original.variants[0]!.id, quantity: 1 }]);
    await updateOrderStatus(order.id, { status: "DELIVERED" }, admin);
    const line = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    const req = await prisma.returnRequest.create({
      data: { orderId: order.id, customerId: order.customerId!, reason: "Size", type: "EXCHANGE", orderItemId: line.id, requestedVariantId: replacement.variants[0]!.id },
    });
    await trash(replacement.product.id);
    await expect(reviewReturnRequest(req.id, { status: "APPROVED" }, admin)).rejects.toThrow(/no longer available/);
    expect((await prisma.returnRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("PENDING");
    expect(await stockOf(replacement.variants[0]!.id)).toBe(5);
    expect(await stockOf(original.variants[0]!.id)).toBe(4);
    trackOrder(order.id);
  });
});
