import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Prisma } from "@prisma/client";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { cacheDel, redis } from "../../config/redis";
import {
  RUN,
  asOwner,
  checkout,
  cleanupFixtures,
  createStockedProduct,
  ledgerSum,
  ownerId,
  placeOrder,
  stockOf,
  trackOrder,
} from "../../test-fixtures";
import { adjustOrderPrice, createOrder, deriveOrderPricing, updateOrderStatus } from "../../modules/orders/order.service";
import { refundOrderPayment, settlePaymentSession } from "../../modules/payments/payment.service";
import { reviewReturnRequest } from "../../modules/return-requests/return-request.service";
import { pricingConfigDrift } from "./pricing-config";

// Phase 2 — one pricing pipeline, one server-side quote, every consumer on it (docs/PRICING_INVARIANTS.md).

let admin: string;
const made = { flashSaleIds: [] as string[], couponIds: [] as string[] };
let originalTax: Prisma.TaxSettingGetPayload<object> | null;
let originalStore: {
  rewardPointsPerCurrency: Prisma.Decimal;
  shippingFeeDhaka: Prisma.Decimal;
} | null;

/** StoreSetting written directly (no admin endpoint for these fields) must also drop the cached row that getSettings()
 * serves for 5 minutes, or code under test reads the stale value whenever Redis is connected. The client is lazy and has
 * no offline queue (config/redis.ts), so a command sent before the first connection fails — and cacheDel swallows it —
 * which is exactly what happens when this is the process's first Redis call (e.g. `-t D8`). Wait for the connection
 * first; without Redis there is no cache to drop. */
async function setStoreSetting(data: Prisma.StoreSettingUpdateInput) {
  await prisma.storeSetting.update({ where: { id: "singleton" }, data });
  if (redis.status !== "ready") {
    if (redis.status === "wait") redis.connect().catch(() => undefined);
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      redis.once("ready", done);
      redis.once("error", done);
      setTimeout(done, 2500);
    });
  }
  await cacheDel("settings:singleton");
}

const quote = (body: object) => request(app).post("/api/v1/checkout/quote").send(body);

async function flashSale(
  productId: string,
  over: {
    discountValue?: number;
    discountType?: "PERCENTAGE" | "FIXED";
    stockLimit?: number | null;
    endsInMin?: number;
  } = {},
) {
  const sale = await prisma.flashSale.create({
    data: {
      name: `Vitest P2 Flash ${RUN} ${made.flashSaleIds.length}`,
      startsAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + (over.endsInMin ?? 60) * 60_000),
      enabled: true,
      isActive: true,
      items: {
        create: {
          productId,
          discountType: over.discountType ?? "PERCENTAGE",
          discountValue: over.discountValue ?? 10,
          stockLimit: over.stockLimit ?? null,
        },
      },
    },
    include: { items: true },
  });
  made.flashSaleIds.push(sale.id);
  return sale;
}

async function coupon(over: Partial<Prisma.CouponUncheckedCreateInput> = {}) {
  const c = await prisma.coupon.create({
    data: {
      code: `VTP2${RUN}${made.couponIds.length}`.toUpperCase(),
      type: "PERCENTAGE",
      value: 10,
      isActive: true,
      ...over,
    },
  });
  made.couponIds.push(c.id);
  return c;
}

beforeAll(async () => {
  admin = await ownerId();
  originalTax = await prisma.taxSetting.findUnique({
    where: { id: "singleton" },
  });
  originalStore = await prisma.storeSetting.findUnique({
    where: { id: "singleton" },
    select: { rewardPointsPerCurrency: true, shippingFeeDhaka: true },
  });
});

afterAll(async () => {
  // Global settings this suite touches go back exactly as they were.
  if (originalTax)
    await prisma.taxSetting.update({
      where: { id: "singleton" },
      data: {
        enabled: originalTax.enabled,
        mode: originalTax.mode,
        defaultRate: originalTax.defaultRate,
        shippingTaxable: originalTax.shippingTaxable,
        shippingRate: originalTax.shippingRate,
      },
    });
  if (originalStore) {
    await (
      await asOwner()
    ).patch("/api/settings", {
      shippingFeeDhaka: Number(originalStore.shippingFeeDhaka),
      taxEnabled: originalTax?.enabled ?? false,
      defaultTaxRate: originalTax?.defaultRate ? Number(originalTax.defaultRate) : null,
    });
    await setStoreSetting({ rewardPointsPerCurrency: originalStore.rewardPointsPerCurrency });
  }
  await prisma.flashSale.deleteMany({
    where: { id: { in: made.flashSaleIds } },
  });
  await cleanupFixtures();
  await prisma.coupon.deleteMany({ where: { id: { in: made.couponIds } } });
  await prisma.$disconnect();
});

describe("canonical quote API", () => {
  it("prices from ids and quantities only; a variant's own price wins; explanations are explicit", async () => {
    const { variants } = await createStockedProduct({
      stocks: [10, 10],
      basePrice: 1000,
      variantPrices: [null, 1250],
    });
    const res = await quote({
      items: [
        { variantId: variants[0]!.id, quantity: 1 },
        { variantId: variants[1]!.id, quantity: 2 },
      ],
      shippingDistrict: "Dhaka",
      shippingDivision: "Dhaka",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const q = res.body.quote;
    expect(q.lines.map((l: { listUnitPrice: number }) => l.listUnitPrice)).toEqual([1000, 1250]);
    expect([q.subtotal, q.shipping.charged, q.total, q.orderable]).toEqual([3500, 60, 3560, true]);
    expect(q.token).toMatch(/^[0-9a-f]{40}$/);
    expect(q).toHaveProperty("tax.mode");
  });

  it("without an address, shipping is explicitly unresolved and the quote is not orderable", async () => {
    const { variants } = await createStockedProduct({ stocks: [5] });
    const q = (await quote({ items: [{ variantId: variants[0]!.id, quantity: 1 }] })).body.quote;
    expect(q.shipping).toEqual({ resolved: false, reason: "ADDRESS_REQUIRED" });
    expect(q.orderable).toBe(false);
  });

  it("a client-submitted price/total is never trusted: the order is charged the server price", async () => {
    const { variants } = await createStockedProduct({
      stocks: [5],
      basePrice: 800,
    });
    const res = await request(app)
      .post("/api/orders")
      .send({
        ...checkout([{ variantId: variants[0]!.id, quantity: 1 }]),
        total: 1,
        subtotal: 1,
        discount: 799,
        items: [{ variantId: variants[0]!.id, quantity: 1, price: 1 }],
      });
    expect(res.status).toBe(201);
    trackOrder(res.body.order.id);
    expect([Number(res.body.order.subtotal), Number(res.body.order.total), Number(res.body.order.items[0].priceSnapshot)]).toEqual([800, 860, 800]);
  });
});

describe("one price everywhere: PDP = quote = order", () => {
  it("a flash sale on a variant-priced item is the same number on the product page, in the quote and on the order line", async () => {
    const { product, variants } = await createStockedProduct({
      stocks: [10],
      basePrice: 2000,
      variantPrices: [2400],
    });
    await flashSale(product.id, { discountValue: 10 });
    const pdp = await request(app).get(`/api/products/slug/${product.slug}`);
    const pdpPrice = pdp.body.product.pricing.variants[variants[0]!.id].selling;
    const q = (
      await quote({
        items: [{ variantId: variants[0]!.id, quantity: 1 }],
        shippingDistrict: "Dhaka",
      })
    ).body.quote;
    const order = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
    expect([pdpPrice, q.lines[0].segments[0].unitPrice, Number(order.items[0]!.priceSnapshot)]).toEqual([2160, 2160, 2160]);
    // The old storefront showed flash-of-basePrice here (1800) while checkout charged 2160.
    expect(pdp.body.product.activeFlashSale.flashPrice).toBe("2160");
    expect([order.items[0]!.flashSaleItemId, Number(order.items[0]!.listPriceSnapshot), Number(order.flashDiscount)]).toEqual([
      expect.any(String),
      2400,
      240,
    ]);
  });
});

describe("flash-sale stock limit (D4)", () => {
  it("splits a line into flash and regular units, snapshots the attribution, and the limit is exhausted afterwards", async () => {
    const { product, variants } = await createStockedProduct({
      stocks: [20],
      basePrice: 1000,
    });
    const sale = await flashSale(product.id, {
      discountValue: 20,
      stockLimit: 3,
    });
    const order = await placeOrder([{ variantId: variants[0]!.id, quantity: 5 }]);
    const rows = order.items.map((i) => [i.quantity, Number(i.priceSnapshot), i.flashSaleItemId]).sort((a, b) => Number(a[1]) - Number(b[1]));
    expect(rows).toEqual([
      [3, 800, sale.items[0]!.id],
      [2, 1000, null],
    ]);
    expect(Number(order.subtotal)).toBe(3 * 800 + 2 * 1000);
    expect(await stockOf(variants[0]!.id)).toBe(15);
    const next = (
      await quote({
        items: [{ variantId: variants[0]!.id, quantity: 1 }],
        shippingDistrict: "Dhaka",
      })
    ).body.quote;
    expect(next.lines[0].segments[0].flash).toBeNull(); // limit exhausted
  });

  it("cancelled and returned units go back under the limit", async () => {
    const { product, variants } = await createStockedProduct({
      stocks: [20],
      basePrice: 1000,
    });
    await flashSale(product.id, { discountValue: 20, stockLimit: 2 });
    const a = await placeOrder([{ variantId: variants[0]!.id, quantity: 2 }]);
    const flashOf = async () =>
      (
        await quote({
          items: [{ variantId: variants[0]!.id, quantity: 1 }],
          shippingDistrict: "Dhaka",
        })
      ).body.quote.lines[0].segments[0].flash;
    expect(await flashOf()).toBeNull();
    await updateOrderStatus(a.id, { status: "CANCELLED" }, admin);
    expect((await flashOf())?.remaining).toBe(2);
    const b = await placeOrder([{ variantId: variants[0]!.id, quantity: 2 }]);
    await updateOrderStatus(b.id, { status: "DELIVERED" }, admin);
    expect(await flashOf()).toBeNull();
    await updateOrderStatus(b.id, { status: "RETURNED" }, admin);
    expect((await flashOf())?.remaining).toBe(2);
  });

  it("two concurrent checkouts can't both take the last flash unit", async () => {
    const { product, variants } = await createStockedProduct({
      stocks: [20],
      basePrice: 1000,
    });
    const sale = await flashSale(product.id, {
      discountValue: 50,
      stockLimit: 1,
    });
    const results = await Promise.allSettled([
      createOrder(
        checkout([{ variantId: variants[0]!.id, quantity: 1 }], {
          customerPhone: "01711111111",
        }),
      ),
      createOrder(
        checkout([{ variantId: variants[0]!.id, quantity: 1 }], {
          customerPhone: "01722222222",
        }),
      ),
    ]);
    for (const r of results) if (r.status === "fulfilled") trackOrder(r.value.id);
    const flashUnits = await prisma.orderItem.aggregate({
      where: { flashSaleItemId: sale.items[0]!.id },
      _sum: { quantity: true },
    });
    expect(flashUnits._sum.quantity).toBe(1);
    const rejected = results.filter((r) => r.status === "rejected");
    for (const r of rejected) expect(String((r as PromiseRejectedResult).reason.message)).toMatch(/flash-sale price|sold out/);
  });
});

describe("flash-sale quota lifecycle (D4, PRICING_INVARIANTS §4)", () => {
  const line = (items: Array<{ priceSnapshot: unknown; flashSaleItemId: string | null }>) => items.map((i) => [Number(i.priceSnapshot), i.flashSaleItemId]);

  it("consumed → exhausted (regular price) → released by cancellation → re-sold to a later customer; history never changes", async () => {
    const { product, variants } = await createStockedProduct({ stocks: [20], basePrice: 1000 });
    const v = variants[0]!.id;
    const sale = await flashSale(product.id, { discountValue: 20, stockLimit: 1 });
    const itemId = sale.items[0]!.id;

    const first = await placeOrder([{ variantId: v, quantity: 1 }], { customerPhone: "01755500001" });
    expect(line(first.items)).toEqual([[800, itemId]]); // 1. the sale consumes the quota
    const second = await placeOrder([{ variantId: v, quantity: 1 }], { customerPhone: "01755500002" });
    expect(line(second.items)).toEqual([[1000, null]]); // 2. exhausted → regular price

    await updateOrderStatus(first.id, { status: "CANCELLED" }, admin); // 3. cancellation releases it
    const later = (await quote({ items: [{ variantId: v, quantity: 1 }], shippingDistrict: "Dhaka" })).body.quote;
    expect([later.lines[0].segments[0].flash?.flashSaleItemId, later.subtotal]).toEqual([itemId, 800]); // 6. a later quote can use it
    const third = await placeOrder([{ variantId: v, quantity: 1 }], { customerPhone: "01755500003" });
    expect(line(third.items)).toEqual([[800, itemId]]);

    // 5. Historical orders keep their attribution and price, whatever happens to the sale afterwards (edited, switched
    // off, deleted) — usage is never inferred from the current FlashSale rows.
    await prisma.flashSaleItem.update({ where: { id: itemId }, data: { discountValue: 50 } });
    await prisma.flashSale.update({ where: { id: sale.id }, data: { enabled: false, isActive: false } });
    await prisma.flashSale.delete({ where: { id: sale.id } });
    const history = await prisma.orderItem.findMany({
      where: { orderId: { in: [first.id, second.id, third.id] } },
      select: { orderId: true, priceSnapshot: true, listPriceSnapshot: true, flashSaleId: true, flashSaleItemId: true },
    });
    const byOrder = (id: string) => history.filter((h) => h.orderId === id).map((h) => [Number(h.priceSnapshot), Number(h.listPriceSnapshot), h.flashSaleId, h.flashSaleItemId]);
    expect(byOrder(first.id)).toEqual([[800, 1000, sale.id, itemId]]);
    expect(byOrder(second.id)).toEqual([[1000, 1000, null, null]]);
    expect(byOrder(third.id)).toEqual([[800, 1000, sale.id, itemId]]);
    const totals = await prisma.order.findMany({ where: { id: { in: [first.id, third.id] } }, select: { subtotal: true, flashDiscount: true } });
    for (const t of totals) expect([Number(t.subtotal), Number(t.flashDiscount)]).toEqual([800, 200]);
  });

  it("4. a return releases the quota only when the goods come back; a refund alone does not", async () => {
    const { product, variants } = await createStockedProduct({ stocks: [20], basePrice: 1000 });
    const v = variants[0]!.id;
    await flashSale(product.id, { discountValue: 20, stockLimit: 1 });
    const flashOf = async () => (await quote({ items: [{ variantId: v, quantity: 1 }], shippingDistrict: "Dhaka" })).body.quote.lines[0].segments[0].flash;

    const order = await placeOrder([{ variantId: v, quantity: 1 }], { customerPhone: "01755500004" });
    await updateOrderStatus(order.id, { status: "DELIVERED" }, admin);
    expect(await flashOf()).toBeNull(); // a completed sale keeps consuming the quota
    await refundOrderPayment(order.id, { amount: 100 }, admin); // money back, goods not back
    expect(await flashOf()).toBeNull();
    await updateOrderStatus(order.id, { status: "RETURNED" }, admin); // goods back in stock
    expect((await flashOf())?.remaining).toBe(1);
    const kept = await prisma.orderItem.findMany({ where: { orderId: order.id } });
    expect(kept.map((i) => [Number(i.priceSnapshot), i.flashSaleItemId !== null, i.returnedQuantity])).toEqual([[800, true, 1]]);
  });
});

describe("promotion order and coupons (D9, D7)", () => {
  it("coupon after bundle: 10% of what remains after the bundle discount", async () => {
    const anchorCat = await prisma.category.create({
      data: { name: `VT P2 A ${RUN}`, slug: `vt-p2-a-${RUN}` },
    });
    const capCat = await prisma.category.create({
      data: { name: `VT P2 C ${RUN}`, slug: `vt-p2-c-${RUN}` },
    });
    try {
      const a = await createStockedProduct({ stocks: [5], basePrice: 1000 });
      const c = await createStockedProduct({ stocks: [5], basePrice: 500 });
      await prisma.product.update({
        where: { id: a.product.id },
        data: { categoryId: anchorCat.id },
      });
      await prisma.product.update({
        where: { id: c.product.id },
        data: { categoryId: capCat.id },
      });
      const bundle = await prisma.bundle.create({
        data: {
          name: `VT P2 ${RUN}`,
          anchorCategoryId: anchorCat.id,
          discountType: "FIXED",
          discountValue: 100,
          suggestions: { create: { categoryId: capCat.id } },
        },
      });
      const cp = await coupon({ value: 10 });
      const q = (
        await quote({
          items: [
            { variantId: a.variants[0]!.id, quantity: 1 },
            { variantId: c.variants[0]!.id, quantity: 1 },
          ],
          couponCode: cp.code,
          shippingDistrict: "Dhaka",
        })
      ).body.quote;
      expect([q.bundleDiscount, q.couponDiscount, q.total]).toEqual([100, 140, 1500 - 100 - 140 + 60]);
      await prisma.bundle.delete({ where: { id: bundle.id } });
    } finally {
      await prisma.product.updateMany({
        where: { categoryId: { in: [anchorCat.id, capCat.id] } },
        data: {
          categoryId: (
            await prisma.category.findFirstOrThrow({
              where: {
                deletedAt: null,
                id: { notIn: [anchorCat.id, capCat.id] },
              },
            })
          ).id,
        },
      });
      await prisma.category.deleteMany({
        where: { id: { in: [anchorCat.id, capCat.id] } },
      });
    }
  });

  it("a cancellation before shipping releases the coupon use; after shipping it doesn't", async () => {
    const { variants } = await createStockedProduct({ stocks: [10] });
    const cp = await coupon({ usageLimit: 1 });
    const first = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }], { couponCode: cp.code });
    expect((await prisma.coupon.findUniqueOrThrow({ where: { id: cp.id } })).usedCount).toBe(1);
    await expect(
      placeOrder([{ variantId: variants[0]!.id, quantity: 1 }], {
        couponCode: cp.code,
        customerPhone: "01733333333",
      }),
    ).rejects.toThrow(/usage limit/);
    await updateOrderStatus(first.id, { status: "CANCELLED" }, admin);
    expect((await prisma.coupon.findUniqueOrThrow({ where: { id: cp.id } })).usedCount).toBe(0);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: first.id } })).couponReleasedAt).not.toBeNull();

    const second = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }], { couponCode: cp.code });
    await updateOrderStatus(second.id, { status: "SHIPPED" }, admin);
    await updateOrderStatus(second.id, { status: "CANCELLED" }, admin);
    expect((await prisma.coupon.findUniqueOrThrow({ where: { id: cp.id } })).usedCount).toBe(1);
  });

  it("the coupon preview endpoint ignores the client subtotal", async () => {
    const { variants } = await createStockedProduct({
      stocks: [5],
      basePrice: 1000,
    });
    const cp = await coupon({ minOrderAmount: 900 });
    const res = await request(app)
      .post("/api/coupons/validate")
      .send({
        code: cp.code,
        subtotal: 99999,
        items: [{ variantId: variants[0]!.id, quantity: 1 }],
      });
    expect([res.status, res.body.discount]).toEqual([200, 100]);
  });
});

describe("tax snapshot (D3, D10) and shipping zones", () => {
  it("settings dual-write into the authorities; orders snapshot tax; history survives a config change", async () => {
    const owner = await asOwner();
    try {
      await owner.patch("/api/settings", {
        taxEnabled: true,
        defaultTaxRate: 15,
        shippingFeeDhaka: 70,
      });
      expect(await pricingConfigDrift()).toEqual([]);
      const driftRes = await owner.get("/api/settings/pricing-config-drift");
      expect([driftRes.status, driftRes.body.drift]).toEqual([200, []]);
      const tax = await prisma.taxSetting.findUniqueOrThrow({
        where: { id: "singleton" },
      });
      expect([tax.enabled, Number(tax.defaultRate)]).toEqual([true, 15]);

      const { variants } = await createStockedProduct({
        stocks: [5],
        basePrice: 1150,
      });
      const order = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
      const snap = await prisma.order.findUniqueOrThrow({
        where: { id: order.id },
      });
      // Inclusive: VAT inside the price. 1150 → 150; shipping 70 → 9.13. Total unchanged by tax.
      expect([
        snap.taxMode,
        Number(snap.taxRate),
        Number(snap.taxAmount),
        Number(snap.shippingTaxAmount),
        Number(snap.shippingFee),
        Number(snap.total),
      ]).toEqual(["INCLUSIVE", 15, 159.13, 9.13, 70, 1220]);

      await owner.patch("/api/settings", {
        taxEnabled: true,
        defaultTaxRate: 5,
        shippingTaxable: false,
        shippingFeeDhaka: 90,
      });
      const after = await prisma.order.findUniqueOrThrow({
        where: { id: order.id },
      });
      expect([Number(after.taxRate), Number(after.taxAmount), Number(after.shippingFee), Number(after.total)]).toEqual([15, 159.13, 70, 1220]);
      // A new order uses the new configuration: shipping VAT off.
      const newer = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
      const n = await prisma.order.findUniqueOrThrow({
        where: { id: newer.id },
      });
      expect([Number(n.taxRate), Number(n.shippingTaxAmount), Number(n.shippingFee)]).toEqual([5, 0, 90]);
    } finally {
      // Global configuration goes back before the next test prices anything.
      await owner.patch("/api/settings", {
        taxEnabled: originalTax?.enabled ?? false,
        defaultTaxRate: originalTax?.defaultRate ? Number(originalTax.defaultRate) : null,
        shippingTaxable: originalTax?.shippingTaxable ?? true,
        shippingFeeDhaka: Number(originalStore?.shippingFeeDhaka ?? 60),
      });
      expect(await pricingConfigDrift()).toEqual([]);
    }
  });

  it("the price adjustment uses the order's snapshot, never the live coupon", async () => {
    const { variants } = await createStockedProduct({
      stocks: [5],
      basePrice: 500,
    });
    const cp = await coupon({ type: "FREE_SHIPPING", value: null });
    const order = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }], { couponCode: cp.code, shippingDistrict: "Gazipur" });
    expect([Number(order.total), order.shippingWaived]).toEqual([500, true]);
    // Someone later edits the coupon — the old code re-read it and started charging shipping on this order.
    await prisma.coupon.update({
      where: { id: cp.id },
      data: { type: "FIXED", value: 10 },
    });
    const adjusted = await adjustOrderPrice(order.id, { priceAdjustment: -50, note: null }, admin);
    expect(Number(adjusted.total)).toBe(450);
  });
});

describe("inventory interaction", () => {
  it("trackInventory=false sells at zero stock (D5) and still records the movement", async () => {
    const { product, variants } = await createStockedProduct({ stocks: [0] });
    await prisma.product.update({
      where: { id: product.id },
      data: { trackInventory: false },
    });
    const order = await placeOrder([{ variantId: variants[0]!.id, quantity: 2 }]);
    expect(order.status).toBe("PENDING");
    expect([await stockOf(variants[0]!.id), await ledgerSum(variants[0]!.id)]).toEqual([-2, -2]);
  });

  it("a stale quote is refused with QUOTE_CHANGED and the fresh quote; the fresh token goes through", async () => {
    const { product, variants } = await createStockedProduct({
      stocks: [5],
      basePrice: 1000,
    });
    const body = {
      items: [{ variantId: variants[0]!.id, quantity: 1 }],
      shippingDistrict: "Dhaka",
      shippingDivision: "Dhaka",
    };
    const stale = (await quote(body)).body.quote.token;
    await prisma.product.update({
      where: { id: product.id },
      data: { basePrice: 1200 },
    });
    const res = await request(app)
      .post("/api/orders")
      .send({ ...checkout(body.items), quoteToken: stale });
    expect(res.status).toBe(409);
    expect([res.body.details.code, res.body.details.quote.total]).toEqual(["QUOTE_CHANGED", 1260]);
    expect(await stockOf(variants[0]!.id)).toBe(5);
    const ok = await request(app)
      .post("/api/orders")
      .send({
        ...checkout(body.items),
        quoteToken: res.body.details.quote.token,
      });
    expect(ok.status).toBe(201);
    trackOrder(ok.body.order.id);
    expect(Number(ok.body.order.total)).toBe(1260);
  });

  it("Idempotency-Key: repeated (and concurrent) requests create one order and one stock deduction", async () => {
    const { variants } = await createStockedProduct({ stocks: [10] });
    const key = `vt-idem-${RUN}`;
    const send = () =>
      request(app)
        .post("/api/orders")
        .set("Idempotency-Key", key)
        .send(checkout([{ variantId: variants[0]!.id, quantity: 2 }]));
    const [a, b] = await Promise.all([send(), send()]);
    const c = await send();
    const ids = new Set([a.body.order?.id, b.body.order?.id, c.body.order?.id]);
    ids.forEach((id) => id && trackOrder(id));
    expect([a.status, b.status, c.status]).toEqual([201, 201, 201]);
    expect(ids.size).toBe(1);
    expect(await stockOf(variants[0]!.id)).toBe(8);
  });
});

describe("every order path uses the same pricing", () => {
  it("admin manual order = quote", async () => {
    const { product, variants } = await createStockedProduct({
      stocks: [5],
      basePrice: 900,
    });
    await flashSale(product.id, { discountType: "FIXED", discountValue: 100 });
    const q = (
      await quote({
        items: [{ variantId: variants[0]!.id, quantity: 2 }],
        shippingDistrict: "Dhaka",
      })
    ).body.quote;
    const res = await (
      await asOwner()
    ).post("/api/orders/admin", {
      ...checkout([{ variantId: variants[0]!.id, quantity: 2 }]),
      paymentMethod: "COD",
      quoteToken: q.token,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    trackOrder(res.body.order.id);
    expect(Number(res.body.order.total)).toBe(q.total);
  });

  it("online payment: the paid order is written from the quoted snapshot (attribution and tax included)", async () => {
    const { product, variants } = await createStockedProduct({
      stocks: [5],
      basePrice: 1000,
    });
    await flashSale(product.id, { discountValue: 10, stockLimit: 1 });
    const input = checkout([{ variantId: variants[0]!.id, quantity: 2 }], {
      paymentMethod: "SSLCOMMERZ",
    });
    const pricing = await deriveOrderPricing(input, null);
    const { customerId: _c, quote: _q, quoteToken: _t, rows: _r, itemSnapshots, ...snapshot } = pricing;
    void _c;
    void _q;
    void _t;
    void _r;
    const ref = `vtp2${RUN}`.slice(0, 30);
    await prisma.paymentSession.create({
      data: {
        provider: "SSLCOMMERZ",
        status: "ACTIVE",
        gatewayTransactionRef: ref,
        expiresAt: new Date(Date.now() + 3600_000),
        checkoutPayload: {
          input,
          customerId: pricing.customerId,
          pricing: snapshot,
          itemSnapshots,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    const { order } = await settlePaymentSession(ref, "bank-1", pricing.total);
    trackOrder(order.id);
    const items = await prisma.orderItem.findMany({
      where: { orderId: order.id },
      orderBy: { priceSnapshot: "asc" },
    });
    expect(items.map((i) => [i.quantity, Number(i.priceSnapshot), Boolean(i.flashSaleItemId)])).toEqual([
      [1, 900, true],
      [1, 1000, false],
    ]);
    expect([Number(order.total), order.pricingVersion]).toEqual([1900 + 60, 2]);
  });

  it("exchange (D6): current effective price; a cheaper replacement owes a refund, a pricier one bills the gap", async () => {
    const { product, variants } = await createStockedProduct({
      stocks: [5, 5],
      basePrice: 1000,
    });
    const original = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
    await updateOrderStatus(original.id, { status: "DELIVERED" }, admin);
    await flashSale(product.id, { discountValue: 20 }); // the replacement is on sale now: 800
    const line = await prisma.orderItem.findFirstOrThrow({
      where: { orderId: original.id },
    });
    const req = await prisma.returnRequest.create({
      data: {
        orderId: original.id,
        customerId: original.customerId!,
        reason: "Size",
        type: "EXCHANGE",
        orderItemId: line.id,
        requestedVariantId: variants[1]!.id,
      },
    });
    await reviewReturnRequest(req.id, { status: "APPROVED" }, admin);
    const exchangeOrderId = (await prisma.returnRequest.findUniqueOrThrow({ where: { id: req.id } })).exchangeOrderId!;
    trackOrder(exchangeOrderId);
    const ex = await prisma.order.findUniqueOrThrow({
      where: { id: exchangeOrderId },
      include: { items: true },
    });
    expect([Number(ex.subtotal), Number(ex.total), Number(ex.items[0]!.priceSnapshot), Boolean(ex.items[0]!.flashSaleItemId)]).toEqual([
      800,
      0,
      800,
      true,
    ]);
    const refund = await prisma.refund.findFirstOrThrow({
      where: { orderId: original.id },
    });
    expect([Number(refund.amount), refund.status]).toEqual([200, "REQUESTED"]);
  });
});

describe("loyalty points (D8)", () => {
  it("earn on merchandise after discounts (no shipping), reversed on return and capped across refunds", async () => {
    await setStoreSetting({ rewardPointsPerCurrency: 0.1 });
    const { variants } = await createStockedProduct({
      stocks: [5],
      basePrice: 1000,
    });
    const cp = await coupon({ type: "FIXED", value: 200 });
    const order = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }], { couponCode: cp.code, customerPhone: "01744444444" });
    await updateOrderStatus(order.id, { status: "DELIVERED" }, admin);
    const earned = await prisma.rewardPointsEntry.findFirstOrThrow({
      where: { orderId: order.id, reason: "order_delivered" },
    });
    expect(earned.points).toBe(80); // (1000 − 200) × 0.1 — the old code used the total incl. shipping: 86
    await updateOrderStatus(order.id, { status: "RETURNED" }, admin);
    await refundOrderPayment(order.id, { amount: 800 }, admin);
    const net = await prisma.rewardPointsEntry.aggregate({
      where: { orderId: order.id },
      _sum: { points: true },
    });
    expect(net._sum.points).toBe(0);
  });
  it("the rewardable value can't include shipping, shipping VAT, tax or the admin price adjustment", async () => {
    await setStoreSetting({ rewardPointsPerCurrency: 0.1 });
    try {
      // Exclusive VAT so tax visibly adds to the total, shipping taxable (D10), and an admin adjustment on top.
      await prisma.taxSetting.update({ where: { id: "singleton" }, data: { enabled: true, mode: "EXCLUSIVE", defaultRate: 15, shippingTaxable: true } });
      const { variants } = await createStockedProduct({ stocks: [5], basePrice: 1000 });
      const cp = await coupon({ type: "FIXED", value: 200 });
      const placed = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }], { couponCode: cp.code, customerPhone: "01744400001" });
      await adjustOrderPrice(placed.id, { priceAdjustment: 500, note: null }, admin);
      const order = await prisma.order.findUniqueOrThrow({ where: { id: placed.id } });
      expect(Number(order.shippingFee)).toBeGreaterThan(0);
      expect([Number(order.taxAmount), Number(order.shippingTaxAmount) > 0]).toEqual([120 + Number(order.shippingTaxAmount), true]);
      expect(Number(order.total)).toBe(800 + Number(order.shippingFee) + Number(order.taxAmount) + 500);

      await updateOrderStatus(order.id, { status: "DELIVERED" }, admin);
      const earned = await prisma.rewardPointsEntry.findFirstOrThrow({ where: { orderId: order.id, reason: "order_delivered" } });
      expect(earned.points).toBe(80); // (1000 − 200) × 0.1 — not the total (1000+ with shipping, VAT and adjustment)

      await refundOrderPayment(order.id, { amount: 400 }, admin); // half the rewardable value
      const net = await prisma.rewardPointsEntry.aggregate({ where: { orderId: order.id }, _sum: { points: true } });
      expect(net._sum.points).toBe(40);
    } finally {
      if (originalTax)
        await prisma.taxSetting.update({
          where: { id: "singleton" },
          data: { enabled: originalTax.enabled, mode: originalTax.mode, defaultRate: originalTax.defaultRate, shippingTaxable: originalTax.shippingTaxable },
        });
    }
  });
});
