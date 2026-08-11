import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { getSettings } from "../settings/settings.service";
import { markOrderPaid } from "./order.service";

// Money-critical path: checkout (stock decrement, coupon math, order totals) and payment
// confirmation (amount verification, idempotency). A dedicated product/variant/coupon are created
// here rather than reusing seed data, so stock levels are exact and predictable across tests.
const suffix = Date.now();
const UNIT_PRICE = 500;
// Enough for every successful-checkout test below (4: base order, coupon order, tracking order,
// markOrderPaid order) plus headroom — the insufficient-stock test itself never decrements.
const INITIAL_STOCK = 6;
const couponCode = `VITEST${suffix}`;

let productId: string;
let variantId: string;
let couponId: string;
const orderIds: string[] = [];

function checkoutBody(overrides: Record<string, unknown> = {}) {
  return {
    items: [{ variantId, quantity: 1 }],
    customerName: "Vitest Checkout",
    customerPhone: "01712345678",
    shippingDivision: "Dhaka",
    shippingDistrict: "Dhaka",
    shippingArea: "Uttara",
    shippingAddressLine: "House 1, Road 2",
    paymentMethod: "COD",
    ...overrides,
  };
}

describe("checkout & payment", () => {
  beforeAll(async () => {
    const category = await prisma.category.findFirst();
    if (!category) throw new Error("Seed at least one category before running checkout tests");

    const product = await prisma.product.create({
      data: {
        name: `Vitest Checkout Product ${suffix}`,
        slug: `vitest-checkout-product-${suffix}`,
        categoryId: category.id,
        basePrice: UNIT_PRICE,
        isActive: true,
        variants: {
          create: [{ sku: `VITEST-SKU-${suffix}`, size: "M", color: "Black", stock: INITIAL_STOCK }],
        },
      },
      include: { variants: true },
    });
    productId = product.id;
    variantId = product.variants[0]!.id;

    const coupon = await prisma.coupon.create({
      data: { code: couponCode, type: "FIXED", value: 50, isActive: true },
    });
    couponId = coupon.id;
  });

  afterAll(async () => {
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.coupon.delete({ where: { id: couponId } }).catch(() => {});
    await prisma.product.delete({ where: { id: productId } }).catch(() => {});
    await prisma.$disconnect();
  });

  it("creates a COD order, decrements stock, and computes subtotal/total correctly", async () => {
    const settings = await getSettings();

    const res = await request(app).post("/api/orders").send(checkoutBody());
    expect(res.status).toBe(201);
    orderIds.push(res.body.order.id);

    expect(Number(res.body.order.subtotal)).toBe(UNIT_PRICE);
    expect(Number(res.body.order.total)).toBe(UNIT_PRICE + Number(settings.shippingFeeDhaka));
    expect(res.body.order.paymentStatus).toBe("UNPAID");
    expect(res.body.order.items).toHaveLength(1);
    expect(res.body.order.items[0].skuSnapshot).toBe(`VITEST-SKU-${suffix}`);

    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });
    expect(variant.stock).toBe(INITIAL_STOCK - 1);
  });

  it("rejects checkout when the requested quantity exceeds available stock, without changing stock", async () => {
    const before = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });

    const res = await request(app)
      .post("/api/orders")
      .send(checkoutBody({ items: [{ variantId, quantity: before.stock + 1 }] }));
    expect(res.status).toBe(409);

    const after = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });
    expect(after.stock).toBe(before.stock);
  });

  it("applies a coupon, reduces the total, and increments usage", async () => {
    const beforeCoupon = await prisma.coupon.findUniqueOrThrow({ where: { id: couponId } });
    const settings = await getSettings();

    const res = await request(app).post("/api/orders").send(checkoutBody({ couponCode }));
    expect(res.status).toBe(201);
    orderIds.push(res.body.order.id);

    expect(Number(res.body.order.discount)).toBe(50);
    expect(Number(res.body.order.total)).toBe(UNIT_PRICE - 50 + Number(settings.shippingFeeDhaka));

    const afterCoupon = await prisma.coupon.findUniqueOrThrow({ where: { id: couponId } });
    expect(afterCoupon.usedCount).toBe(beforeCoupon.usedCount + 1);
  });

  it("tracks an order by orderNumber+phone and rejects a mismatched phone", async () => {
    const created = await request(app).post("/api/orders").send(checkoutBody());
    expect(created.status).toBe(201);
    orderIds.push(created.body.order.id);
    const { orderNumber } = created.body.order;

    const okRes = await request(app).post("/api/orders/track").send({ orderNumber, phone: "01712345678" });
    expect(okRes.status).toBe(200);
    expect(okRes.body.order.orderNumber).toBe(orderNumber);

    const wrongRes = await request(app).post("/api/orders/track").send({ orderNumber, phone: "01999999999" });
    expect(wrongRes.status).toBe(404);
  });

  it("markOrderPaid rejects an amount mismatch and is idempotent once paid", async () => {
    const created = await request(app).post("/api/orders").send(checkoutBody());
    expect(created.status).toBe(201);
    orderIds.push(created.body.order.id);
    const { orderNumber, total } = created.body.order;

    // The gateway's own verified amount is the only thing that can confirm payment — a mismatch
    // (tampered callback, wrong order) must be rejected, never silently accepted.
    await expect(markOrderPaid(orderNumber, "vitest-tx-mismatch", Number(total) + 100)).rejects.toThrow();

    const paid = await markOrderPaid(orderNumber, "vitest-tx-ok", Number(total));
    expect(paid.paymentStatus).toBe("PAID");
    expect(paid.status).toBe("CONFIRMED");

    // Calling again (e.g. a duplicate gateway callback) must not throw or re-validate — it's a
    // no-op once the order is already PAID.
    const again = await markOrderPaid(orderNumber, "vitest-tx-duplicate", Number(total));
    expect(again.paymentStatus).toBe("PAID");
  });
});
