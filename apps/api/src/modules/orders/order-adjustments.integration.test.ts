import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// Gateways never reached: every init returns a hosted-page URL; settlement is driven by calling settlePaymentSession.
vi.mock("../../providers/payment/eps", async (orig) => ({
  ...(await orig<typeof import("../../providers/payment/eps")>()),
  initEpsSession: vi.fn(async () => ({ gatewayUrl: `https://gateway.test/eps/${Math.random()}`, transactionId: "eps-t" })),
}));
vi.mock("../../providers/payment/sslcommerz", async (orig) => ({
  ...(await orig<typeof import("../../providers/payment/sslcommerz")>()),
  initSslcommerzSession: vi.fn(async () => ({ gatewayUrl: `https://gateway.test/ssl/${Math.random()}`, sessionKey: "ssl-k" })),
}));
// Every payment method switched on, whatever the test database's store settings say.
vi.mock("../settings/settings.service", async (orig) => {
  const actual = await orig<typeof import("../settings/settings.service")>();
  return { ...actual, getSettings: async () => ({ ...(await actual.getSettings()), codEnabled: true, onlinePaymentEnabled: true, epsPaymentEnabled: true }) };
});

import request from "supertest";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { signCustomerAccessToken } from "../../lib/customer-jwt";
import { CUSTOMER_ACCESS_COOKIE } from "../../lib/cookies";
import { asOwner, assertInventoryInvariants, checkout, cleanupFixtures, createStockedProduct, ownerId, RUN, stockOf, trackOrder } from "../../test-fixtures";
import { createOrder, updateOrderStatus } from "./order.service";
import { applyOrderModification, previewOrderModification } from "./order-modification.service";
import { cancelOwnOrder, previewItemReturn, recordItemReturn } from "./order-adjustments.service";
import { initiatePendingPayment, markPaymentSessionFailed, settlePaymentSession } from "../payments/payment.service";
import { createPaymentLink, startPaymentLink, viewPaymentLink } from "../payments/payment-link.service";
import { creditRefundDueToStore, getOrderPaymentSummary, recordRefund } from "../../domain/payments/payment-ledger.service";
import { storeCreditBalance } from "../../domain/credit/customer-credit.service";
import { createReturnRequest, previewExchange, reviewReturnRequest } from "../return-requests/return-request.service";

// docs/ORDER_ADJUSTMENTS.md §22 — the test matrix, against a real database.

let admin: string;
const customers: string[] = [];
beforeAll(async () => {
  admin = await ownerId();
});
afterAll(async () => {
  await prisma.customerCreditEntry.deleteMany({ where: { customerId: { in: customers } } });
  await cleanupFixtures();
  await prisma.returnRequest.deleteMany({ where: { customerId: { in: customers } } });
  await prisma.customer.deleteMany({ where: { id: { in: customers } } });
  await prisma.$disconnect();
});

let phoneSeq = 0;
async function newCustomer() {
  const c = await prisma.customer.create({ data: { name: `Vitest Adjust ${RUN}`, phone: `0171${RUN.slice(-4)}${String(++phoneSeq).padStart(3, "0")}` } });
  customers.push(c.id);
  return c;
}

async function orderFor(customerId: string, items: Array<{ variantId: string; quantity: number }>, over: Parameters<typeof checkout>[1] = {}, opts: { storeCredit?: boolean } = {}) {
  const c = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
  const order = await createOrder(checkout(items, { customerPhone: c.phone!, ...over }), customerId, { storeCreditCustomerId: opts.storeCredit ? customerId : null });
  trackOrder(order.id);
  return order;
}

/** An order of the customer's, paid in full through a verified EPS settlement (the online "already paid" case). */
async function paidOnlineOrder(customerId: string, items: Array<{ variantId: string; quantity: number }>) {
  const order = await orderFor(customerId, items);
  await prisma.order.update({ where: { id: order.id }, data: { paymentMethod: "EPS_PG" } });
  const session = await prisma.paymentSession.create({
    data: { orderId: order.id, provider: "EPS_PG", status: "ACTIVE", gatewayTransactionRef: `adj_${order.id}`, expiresAt: new Date(Date.now() + 60_000), amount: order.total },
  });
  await settlePaymentSession(session.gatewayTransactionRef, `eps_${order.id}`, Number(order.total));
  return prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
}

async function refused(promise: Promise<unknown>, status: number, code?: string) {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err, "the command should have been refused").toBeInstanceOf(AppError);
  expect((err as AppError).statusCode).toBe(status);
  if (code) expect((err as AppError).details).toMatchObject({ code });
  return err as AppError;
}

const customerAgent = (customerId: string) => {
  const cookies = [`${CUSTOMER_ACCESS_COOKIE}=${signCustomerAccessToken({ customerId })}`, "csrf_token=vitest-csrf"];
  return {
    get: (url: string) => request(app).get(url).set("Cookie", cookies).set("X-CSRF-Token", "vitest-csrf"),
    post: (url: string, body: object = {}) => request(app).post(url).set("Cookie", cookies).set("X-CSRF-Token", "vitest-csrf").send(body),
  };
};

const balanceOf = async (customerId: string) => (await storeCreditBalance(customerId, "BDT")).amount / 100;

describe("product free delivery (§1)", () => {
  it("a free-delivery-only order ships free; changing the product later never touches the order", async () => {
    const c = await newCustomer();
    const { product, variants } = await createStockedProduct({ stocks: [5], basePrice: 900 });
    await prisma.product.update({ where: { id: product.id }, data: { freeDelivery: true } });
    const order = await orderFor(c.id, [{ variantId: variants[0]!.id, quantity: 1 }]);
    expect(order.shippingWaived).toBe(true);
    expect(Number(order.total)).toBe(900);
    expect(order.items[0]!.freeDeliverySnapshot).toBe(true);
    await prisma.product.update({ where: { id: product.id }, data: { freeDelivery: false } });
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
    expect(Number(after.total)).toBe(900);
    expect(after.items[0]!.freeDeliverySnapshot).toBe(true);
  });

  it("a mixed cart pays the zone fee", async () => {
    const c = await newCustomer();
    const free = await createStockedProduct({ stocks: [5], basePrice: 500 });
    await prisma.product.update({ where: { id: free.product.id }, data: { freeDelivery: true } });
    const normal = await createStockedProduct({ stocks: [5], basePrice: 500 });
    const order = await orderFor(c.id, [
      { variantId: free.variants[0]!.id, quantity: 1 },
      { variantId: normal.variants[0]!.id, quantity: 1 },
    ]);
    expect(order.shippingWaived).toBe(false);
    expect(Number(order.total)).toBe(1060);
  });
});

describe("pending order modification (§2, §12, §14)", () => {
  it("add, change quantity, change variant and remove — stock, lines and totals follow; history is recorded", async () => {
    const c = await newCustomer();
    const { variants } = await createStockedProduct({ stocks: [10, 10], basePrice: 1000 });
    const [m, l] = [variants[0]!, variants[1]!];
    const other = await createStockedProduct({ stocks: [10], basePrice: 400 });
    const order = await orderFor(c.id, [{ variantId: m.id, quantity: 1 }]);
    expect(await stockOf(m.id)).toBe(9);

    const actor = { type: "CUSTOMER" as const, customerId: c.id };
    // M → L (variant change) and add another product.
    const preview = await previewOrderModification(order.id, { items: [{ variantId: l.id, quantity: 2 }, { variantId: other.variants[0]!.id, quantity: 1 }] }, actor);
    expect(preview.removed.map((r) => r.variantId)).toEqual([m.id]);
    expect(preview.added.map((a) => a.variantId).sort()).toEqual([l.id, other.variants[0]!.id].sort());
    expect(preview.next.total).toBe(2000 + 400 + 60);
    expect(preview.outcome).toBe("APPLY");
    const res = await applyOrderModification(order.id, { items: [{ variantId: l.id, quantity: 2 }, { variantId: other.variants[0]!.id, quantity: 1 }], previewToken: preview.previewToken }, actor);
    expect(res.modification.status).toBe("APPLIED");

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true, modifications: true } });
    expect(Number(after.total)).toBe(2460);
    expect(after.revision).toBe(1);
    expect(after.items.map((i) => [i.variantId, i.quantity]).sort()).toEqual([[l.id, 2], [other.variants[0]!.id, 1]].sort());
    expect(await stockOf(m.id)).toBe(10);
    expect(await stockOf(l.id)).toBe(8);
    await assertInventoryInvariants(m.id);
    await assertInventoryInvariants(l.id);
    expect(after.modifications[0]!.before).toMatchObject({ totals: { total: 1060 } });

    // Quantity down: 2 → 1 of L.
    await applyOrderModification(order.id, { items: [{ variantId: l.id, quantity: 1 }, { variantId: other.variants[0]!.id, quantity: 1 }] }, actor);
    expect(await stockOf(l.id)).toBe(9);
    expect(Number((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).total)).toBe(1460);
    const summary = await getOrderPaymentSummary(order.id);
    expect(summary.codToCollect).toBe(1460);
  });

  it("an unavailable variant fails safely: nothing changes (atomic)", async () => {
    const c = await newCustomer();
    const { variants } = await createStockedProduct({ stocks: [5, 1], basePrice: 1000 });
    const order = await orderFor(c.id, [{ variantId: variants[0]!.id, quantity: 1 }]);
    await refused(applyOrderModification(order.id, { items: [{ variantId: variants[1]!.id, quantity: 2 }] }, { type: "CUSTOMER", customerId: c.id }), 409, "INSUFFICIENT_STOCK");
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
    expect(after.revision).toBe(0);
    expect(after.items).toHaveLength(1);
    expect(await stockOf(variants[0]!.id)).toBe(4);
    expect(await stockOf(variants[1]!.id)).toBe(1);
  });

  it("someone else's order reads as not found; a shipped order can't be edited; a stale preview is refused", async () => {
    const [c, stranger] = [await newCustomer(), await newCustomer()];
    const { variants } = await createStockedProduct({ stocks: [5], basePrice: 1000 });
    const order = await orderFor(c.id, [{ variantId: variants[0]!.id, quantity: 1 }]);
    const items = [{ variantId: variants[0]!.id, quantity: 2 }];
    await refused(previewOrderModification(order.id, { items }, { type: "CUSTOMER", customerId: stranger.id }), 404);
    await refused(applyOrderModification(order.id, { items, previewToken: "stale" }, { type: "CUSTOMER", customerId: c.id }), 409, "MODIFICATION_CHANGED");
    await updateOrderStatus(order.id, { status: "PROCESSING" }, admin);
    await refused(previewOrderModification(order.id, { items }, { type: "CUSTOMER", customerId: c.id }), 409, "ORDER_NOT_EDITABLE");
    await updateOrderStatus(order.id, { status: "SHIPPED" }, admin);
    await refused(previewOrderModification(order.id, { items }, { type: "ADMIN", adminId: admin }), 409, "ORDER_NOT_EDITABLE");
  });

  it("removing the only normal product from a free-delivery mix drops shipping; adding one back charges it", async () => {
    const c = await newCustomer();
    const free = await createStockedProduct({ stocks: [5], basePrice: 500 });
    await prisma.product.update({ where: { id: free.product.id }, data: { freeDelivery: true } });
    const normal = await createStockedProduct({ stocks: [5], basePrice: 500 });
    const order = await orderFor(c.id, [{ variantId: free.variants[0]!.id, quantity: 1 }, { variantId: normal.variants[0]!.id, quantity: 1 }]);
    const actor = { type: "CUSTOMER" as const, customerId: c.id };
    const res = await applyOrderModification(order.id, { items: [{ variantId: free.variants[0]!.id, quantity: 1 }] }, actor);
    expect(res.preview.shippingWaivedReason).toBe("FREE_DELIVERY");
    expect(res.preview.next.total).toBe(500);
    const back = await applyOrderModification(order.id, { items: [{ variantId: free.variants[0]!.id, quantity: 1 }, { variantId: normal.variants[0]!.id, quantity: 1 }] }, actor);
    expect(back.preview.next.total).toBe(1060);
  });

  it("a retried apply with the same Idempotency-Key changes nothing twice", async () => {
    const c = await newCustomer();
    const { variants } = await createStockedProduct({ stocks: [10], basePrice: 1000 });
    const order = await orderFor(c.id, [{ variantId: variants[0]!.id, quantity: 1 }]);
    const input = { items: [{ variantId: variants[0]!.id, quantity: 3 }] };
    const key = `adj-idem-${order.id}`;
    const a = await applyOrderModification(order.id, input, { type: "CUSTOMER", customerId: c.id }, key);
    const b = await applyOrderModification(order.id, input, { type: "CUSTOMER", customerId: c.id }, key);
    expect(b.modification.id).toBe(a.modification.id);
    expect(await stockOf(variants[0]!.id)).toBe(7);
    expect(await prisma.orderModification.count({ where: { orderId: order.id } })).toBe(1);
  });

  it("customer HTTP routes: preview and apply own order; never another customer's", async () => {
    const [c, stranger] = [await newCustomer(), await newCustomer()];
    const { variants } = await createStockedProduct({ stocks: [10], basePrice: 1000 });
    const order = await orderFor(c.id, [{ variantId: variants[0]!.id, quantity: 1 }]);
    const body = { items: [{ variantId: variants[0]!.id, quantity: 2 }], previewToken: undefined, collectDifferenceLater: true };
    const preview = await customerAgent(c.id).post(`/api/customers/me/orders/${order.id}/modifications/preview`, body);
    expect(preview.status).toBe(200);
    expect(preview.body.preview.next.total).toBe(2060);
    expect((await customerAgent(stranger.id).post(`/api/customers/me/orders/${order.id}/modifications/preview`, body)).status).toBe(404);
    const applied = await customerAgent(c.id).post(`/api/customers/me/orders/${order.id}/modifications`, { ...body, previewToken: preview.body.preview.previewToken });
    expect(applied.status).toBe(201);
  });
});

describe("paid order modification (§3)", () => {
  it("Case A — total up on an online-paid order waits for the difference; the verified payment applies it", async () => {
    const c = await newCustomer();
    const { variants } = await createStockedProduct({ stocks: [10], basePrice: 1000 });
    const order = await paidOnlineOrder(c.id, [{ variantId: variants[0]!.id, quantity: 1 }]); // 1060 paid
    const res = await applyOrderModification(order.id, { items: [{ variantId: variants[0]!.id, quantity: 2 }] }, { type: "CUSTOMER", customerId: c.id });
    expect(res.modification.status).toBe("AWAITING_PAYMENT");
    expect(res.modification.amountDue).toBe(1000);
    // Nothing applied yet — an initiated payment is not a payment.
    let now = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(Number(now.total)).toBe(1060);
    expect(await stockOf(variants[0]!.id)).toBe(9);

    const session = await prisma.paymentSession.create({
      data: { orderId: order.id, provider: "EPS_PG", status: "ACTIVE", gatewayTransactionRef: `mod_${order.id}`, expiresAt: new Date(Date.now() + 60_000), amount: 1000, orderModificationId: res.modification.id },
    });
    await refused(settlePaymentSession(session.gatewayTransactionRef, "x", 900), 400); // wrong amount never settles
    await settlePaymentSession(session.gatewayTransactionRef, `eps_mod_${order.id}`, 1000);
    now = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(Number(now.total)).toBe(2060);
    expect(await stockOf(variants[0]!.id)).toBe(8);
    const summary = await getOrderPaymentSummary(order.id);
    expect(summary).toMatchObject({ status: "PAID", paid: 2060, amountDue: 0 });
    expect(summary.payments.filter((p) => p.status === "SUCCEEDED").map((p) => p.amount).sort()).toEqual([1000, 1060]);
    expect((await prisma.orderModification.findUniqueOrThrow({ where: { id: res.modification.id } })).status).toBe("APPLIED");
  });

  it("Case A — the difference paid after the item sold out: not applied, nothing oversold, payment credited", async () => {
    const c = await newCustomer();
    const { variants } = await createStockedProduct({ stocks: [5, 1], basePrice: 1000 });
    const order = await paidOnlineOrder(c.id, [{ variantId: variants[0]!.id, quantity: 1 }]);
    const res = await applyOrderModification(
      order.id,
      { items: [{ variantId: variants[0]!.id, quantity: 1 }, { variantId: variants[1]!.id, quantity: 1 }] },
      { type: "CUSTOMER", customerId: c.id },
    );
    expect(res.modification.status).toBe("AWAITING_PAYMENT");
    // Someone else buys the last unit.
    await orderFor((await newCustomer()).id, [{ variantId: variants[1]!.id, quantity: 1 }]);
    const session = await prisma.paymentSession.create({
      data: { orderId: order.id, provider: "EPS_PG", status: "ACTIVE", gatewayTransactionRef: `modso_${order.id}`, expiresAt: new Date(Date.now() + 60_000), amount: 1000, orderModificationId: res.modification.id },
    });
    await settlePaymentSession(session.gatewayTransactionRef, `eps_modso_${order.id}`, 1000);
    expect(await stockOf(variants[1]!.id)).toBe(0);
    expect((await prisma.orderModification.findUniqueOrThrow({ where: { id: res.modification.id } })).status).toBe("CANCELLED");
    const summary = await getOrderPaymentSummary(order.id);
    expect(summary).toMatchObject({ paid: 2060, credited: 1000, refundDue: 0, status: "PAID" });
    expect(await balanceOf(c.id)).toBe(1000);
  });

  it("Case B — total down on a paid order: excess to store credit, original payment untouched", async () => {
    const c = await newCustomer();
    const { variants } = await createStockedProduct({ stocks: [10], basePrice: 1000 });
    const order = await paidOnlineOrder(c.id, [{ variantId: variants[0]!.id, quantity: 2 }]); // 2060
    const res = await applyOrderModification(order.id, { items: [{ variantId: variants[0]!.id, quantity: 1 }] }, { type: "CUSTOMER", customerId: c.id });
    expect(res.preview.amountCredited).toBe(1000);
    const summary = await getOrderPaymentSummary(order.id);
    expect(summary).toMatchObject({ status: "PAID", paid: 2060, refunded: 0, credited: 1000, refundable: 1060 });
    expect(summary.payments).toHaveLength(1);
    expect(await balanceOf(c.id)).toBe(1000);
  });

  it("Case C — same total, address change only: no money moves", async () => {
    const c = await newCustomer();
    const { variants } = await createStockedProduct({ stocks: [10], basePrice: 1000 });
    const order = await paidOnlineOrder(c.id, [{ variantId: variants[0]!.id, quantity: 1 }]);
    const res = await applyOrderModification(
      order.id,
      { items: [{ variantId: variants[0]!.id, quantity: 1 }], shipping: { shippingDivision: "Dhaka", shippingDistrict: "Dhaka", shippingArea: "Mirpur", shippingAddressLine: "House 9" } },
      { type: "CUSTOMER", customerId: c.id },
    );
    expect(res.preview).toMatchObject({ amountToPay: 0, amountCredited: 0, addressChanged: true });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).shippingArea).toBe("Mirpur");
    expect(await balanceOf(c.id)).toBe(0);
  });
});

describe("cancellation after payment → store credit (§5)", () => {
  it("paid ৳ then cancelled by the customer: credited once, payment intact, no refund; repeats credit nothing", async () => {
    const c = await newCustomer();
    const { variants } = await createStockedProduct({ stocks: [10], basePrice: 1000 });
    const order = await paidOnlineOrder(c.id, [{ variantId: variants[0]!.id, quantity: 1 }]);
    const res = await cancelOwnOrder(c.id, order.id, { reason: "changed my mind" });
    expect(res.storeCredit).toBe(1060);
    expect(await stockOf(variants[0]!.id)).toBe(10);
    const summary = await getOrderPaymentSummary(order.id);
    expect(summary).toMatchObject({ status: "CREDITED", paid: 1060, refunded: 0, credited: 1060, refundable: 0, refundDue: 0, amountDue: 0 });
    expect(summary.payments).toHaveLength(1);
    expect(Number(summary.payments[0]!.amount)).toBe(1060);
    await cancelOwnOrder(c.id, order.id, {});
    await cancelOwnOrder(c.id, order.id, {});
    expect(await balanceOf(c.id)).toBe(1060);
    // No double compensation: the credited money can't also be refunded.
    await refused(recordRefund(order.id, { amount: 1 }, admin), 400, "NOTHING_TO_REFUND");
  });

  it("partial credit: what was already refunded isn't credited again; staff refund-to-credit is capped at what's owed", async () => {
    const c = await newCustomer();
    const { variants } = await createStockedProduct({ stocks: [10], basePrice: 1000 });
    const order = await paidOnlineOrder(c.id, [{ variantId: variants[0]!.id, quantity: 1 }]);
    await updateOrderStatus(order.id, { status: "CANCELLED" }, admin);
    await recordRefund(order.id, { amount: 60 }, admin);
    await refused(creditRefundDueToStore(order.id, { amount: 1001, reason: "too much" }, admin, `cap-${order.id}`), 400, "CREDIT_EXCEEDS_REFUND_DUE");
    const key = `r2c-${order.id}`;
    await creditRefundDueToStore(order.id, { reason: "customer prefers balance" }, admin, key);
    await creditRefundDueToStore(order.id, { reason: "customer prefers balance" }, admin, key); // double click
    expect(await balanceOf(c.id)).toBe(1000);
    expect((await getOrderPaymentSummary(order.id)).status).toBe("CREDITED");
  });

  it("a customer can't cancel an order that is being prepared", async () => {
    const c = await newCustomer();
    const { variants } = await createStockedProduct({ stocks: [10], basePrice: 1000 });
    const order = await orderFor(c.id, [{ variantId: variants[0]!.id, quantity: 1 }]);
    await updateOrderStatus(order.id, { status: "PROCESSING" }, admin);
    await refused(cancelOwnOrder(c.id, order.id, {}), 409, "ORDER_NOT_CANCELLABLE");
  });
});

/** Gives the customer a store balance the real way: a paid online order they cancel. */
async function fundBalance(customerId: string, basePrice: number) {
  const { variants } = await createStockedProduct({ stocks: [5], basePrice });
  const order = await paidOnlineOrder(customerId, [{ variantId: variants[0]!.id, quantity: 1 }]);
  await cancelOwnOrder(customerId, order.id, {});
  return basePrice + 60;
}

describe("store credit used on new orders (§6, §7)", () => {
  it("balance covers the whole COD order: STORE_CREDIT payment, PAID, the rest of the balance stays", async () => {
    const c = await newCustomer();
    await fundBalance(c.id, 2940); // 3000
    const { variants } = await createStockedProduct({ stocks: [5], basePrice: 2140 });
    const order = await orderFor(c.id, [{ variantId: variants[0]!.id, quantity: 1 }], {}, { storeCredit: true }); // 2200
    const summary = await getOrderPaymentSummary(order.id);
    expect(summary).toMatchObject({ status: "PAID", paid: 2200, paidFromStoreCredit: 2200, codToCollect: 0 });
    expect(await balanceOf(c.id)).toBe(800);
  });

  it("balance smaller than the order: all of it is used, COD collects the rest", async () => {
    const c = await newCustomer();
    await fundBalance(c.id, 940); // 1000
    const { variants } = await createStockedProduct({ stocks: [5], basePrice: 1440 });
    const order = await orderFor(c.id, [{ variantId: variants[0]!.id, quantity: 1 }], {}, { storeCredit: true }); // 1500
    expect(await getOrderPaymentSummary(order.id)).toMatchObject({ status: "PARTIALLY_PAID", paidFromStoreCredit: 1000, codToCollect: 500 });
    expect(await balanceOf(c.id)).toBe(0);
  });

  it("concurrent checkouts can't spend the same balance", async () => {
    const c = await newCustomer();
    await fundBalance(c.id, 940); // 1000
    const { variants } = await createStockedProduct({ stocks: [10], basePrice: 940 });
    const orders = await Promise.all([1, 2, 3].map(() => orderFor(c.id, [{ variantId: variants[0]!.id, quantity: 1 }], {}, { storeCredit: true })));
    const spent = (await Promise.all(orders.map((o) => getOrderPaymentSummary(o.id)))).reduce((n, s) => n + s.paidFromStoreCredit, 0);
    expect(spent).toBe(1000);
    expect(await balanceOf(c.id)).toBe(0);
  });

  it("credit + online payment: balance reserved at checkout, the gateway collects the rest, both recorded on settlement", async () => {
    const c = await newCustomer();
    await fundBalance(c.id, 940); // 1000
    const { variants } = await createStockedProduct({ stocks: [5], basePrice: 2440 }); // 2500 with shipping
    const input = checkout([{ variantId: variants[0]!.id, quantity: 1 }], { customerPhone: c.phone!, paymentMethod: "EPS_PG", useStoreCredit: true });
    const started = await initiatePendingPayment(input, c.id);
    expect("gatewayUrl" in started).toBe(true);
    const session = await prisma.paymentSession.findFirstOrThrow({ where: { id: (started as { sessionId: string }).sessionId } });
    expect(Number(session.amount)).toBe(1500);
    expect(await balanceOf(c.id)).toBe(0); // reserved
    const { order } = await settlePaymentSession(session.gatewayTransactionRef, "eps_mixed", 1500);
    trackOrder(order.id);
    const summary = await getOrderPaymentSummary(order.id);
    expect(summary).toMatchObject({ status: "PAID", paid: 2500, paidFromStoreCredit: 1000 });
    expect(await balanceOf(c.id)).toBe(0);
  });

  it("a failed online attempt gives the reserved balance back", async () => {
    const c = await newCustomer();
    await fundBalance(c.id, 940);
    const { variants } = await createStockedProduct({ stocks: [5], basePrice: 2440 });
    const input = checkout([{ variantId: variants[0]!.id, quantity: 1 }], { customerPhone: c.phone!, paymentMethod: "EPS_PG", useStoreCredit: true });
    const started = (await initiatePendingPayment(input, c.id)) as { sessionId: string };
    const session = await prisma.paymentSession.findUniqueOrThrow({ where: { id: started.sessionId } });
    expect(await balanceOf(c.id)).toBe(0);
    await markPaymentSessionFailed(session.gatewayTransactionRef);
    await markPaymentSessionFailed(session.gatewayTransactionRef);
    expect(await balanceOf(c.id)).toBe(1000);
  });

  it("a guest can never spend a balance (only the signed-in account)", async () => {
    const c = await newCustomer();
    await fundBalance(c.id, 940);
    const { variants } = await createStockedProduct({ stocks: [5], basePrice: 500 });
    const order = await createOrder(checkout([{ variantId: variants[0]!.id, quantity: 1 }], { customerPhone: c.phone!, useStoreCredit: true }), null);
    trackOrder(order.id);
    expect((await getOrderPaymentSummary(order.id)).paidFromStoreCredit).toBe(0);
    expect(await balanceOf(c.id)).toBe(1000);
  });
});

describe("item-level return on a delivered order (§8, §11)", () => {
  it("keeps A, returns B + C (C damaged): allocated value credited, B restocked, C written off, history intact", async () => {
    const c = await newCustomer();
    const a = await createStockedProduct({ stocks: [5], basePrice: 1000 });
    const b = await createStockedProduct({ stocks: [5], basePrice: 1500 });
    const cc = await createStockedProduct({ stocks: [5], basePrice: 800 });
    const order = await orderFor(c.id, [
      { variantId: a.variants[0]!.id, quantity: 1 },
      { variantId: b.variants[0]!.id, quantity: 1 },
      { variantId: cc.variants[0]!.id, quantity: 1 },
    ]);
    // A coupon-like allocation on the lines: the returned value must come from the allocation, not price × quantity.
    const items = await prisma.orderItem.findMany({ where: { orderId: order.id } });
    const lineB = items.find((i) => i.variantId === b.variants[0]!.id)!;
    const lineC = items.find((i) => i.variantId === cc.variants[0]!.id)!;
    await prisma.orderItem.update({ where: { id: lineB.id }, data: { couponDiscountAllocated: 150 } });
    await updateOrderStatus(order.id, { status: "DELIVERED" }, admin); // COD collected: 3360
    const key = `ret-${order.id}`;
    const req = await recordItemReturn(
      order.id,
      {
        items: [
          { orderItemId: lineB.id, quantity: 1, restock: true },
          { orderItemId: lineC.id, quantity: 1, restock: false },
        ],
        reason: "Didn't fit",
        note: null,
        compensation: "STORE_CREDIT",
      },
      admin,
      key,
    );
    expect(Number(req.compensationAmount)).toBe(1350 + 800);
    expect(await balanceOf(c.id)).toBe(2150);
    expect(await stockOf(b.variants[0]!.id)).toBe(5);
    expect(await stockOf(cc.variants[0]!.id)).toBe(4);
    await assertInventoryInvariants(b.variants[0]!.id);
    await assertInventoryInvariants(cc.variants[0]!.id);
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
    expect(after.status).toBe("DELIVERED");
    expect(after.items).toHaveLength(3);
    expect(Number(after.total)).toBe(Number(order.total));
    expect(after.items.find((i) => i.id === lineB.id)!.returnedQuantity).toBe(1);
    // Duplicate processing: same key → same record; the same units again → refused.
    expect((await recordItemReturn(order.id, { items: [{ orderItemId: lineB.id, quantity: 1, restock: true }], reason: "x", note: null, compensation: "STORE_CREDIT" }, admin, key)).id).toBe(req.id);
    await refused(recordItemReturn(order.id, { items: [{ orderItemId: lineB.id, quantity: 1, restock: true }], reason: "again", note: null, compensation: "STORE_CREDIT" }, admin), 409, "RETURN_EXCEEDS_OUTSTANDING");
    expect(await balanceOf(c.id)).toBe(2150);
    expect(await getOrderPaymentSummary(order.id)).toMatchObject({ paid: 3360, credited: 2150, refundDue: 0 });
  });

  it("returning everything moves the order to RETURNED", async () => {
    const c = await newCustomer();
    const { variants } = await createStockedProduct({ stocks: [5], basePrice: 1000 });
    const order = await orderFor(c.id, [{ variantId: variants[0]!.id, quantity: 2 }]);
    await updateOrderStatus(order.id, { status: "DELIVERED" }, admin);
    const line = (await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } })).id;
    await recordItemReturn(order.id, { items: [{ orderItemId: line, quantity: 2, restock: true }], reason: "All back", note: null, compensation: "STORE_CREDIT" }, admin);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("RETURNED");
    expect(await stockOf(variants[0]!.id)).toBe(5);
  });
});

describe("read-only previews equal what the commands record (Orders UI phase 2)", () => {
  it("item-return preview: allocated value, per-line quantities, caps — and nothing is written", async () => {
    const c = await newCustomer();
    const a = await createStockedProduct({ stocks: [5], basePrice: 1000 });
    const order = await orderFor(c.id, [{ variantId: a.variants[0]!.id, quantity: 3 }]);
    const line = (await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } })).id;
    await prisma.orderItem.update({ where: { id: line }, data: { couponDiscountAllocated: 300 } });
    await updateOrderStatus(order.id, { status: "DELIVERED" }, admin); // COD collected 3060
    const input = { items: [{ orderItemId: line, quantity: 2, restock: true }] };
    const before = await prisma.stockMovement.count({ where: { variantId: a.variants[0]!.id } });
    const preview = await previewItemReturn(order.id, input);
    expect(preview.value).toBe(1800); // (3000 − 300) × 2/3 — never list price × quantity
    expect(preview.items[0]).toMatchObject({ ordered: 3, alreadyReturned: 0, returnable: 3, returning: 2, keptAfter: 1 });
    expect(preview.compensation).toEqual({ storeCredit: 1800, refund: 1800 });
    expect(preview.returnsEverything).toBe(false);
    expect(await prisma.stockMovement.count({ where: { variantId: a.variants[0]!.id } })).toBe(before);
    expect(await prisma.returnRequest.count({ where: { orderId: order.id } })).toBe(0);
    const recorded = await recordItemReturn(order.id, { ...input, reason: "Too big", note: null, compensation: "STORE_CREDIT" }, admin);
    expect(Number(recorded.compensationAmount)).toBe(preview.compensation.storeCredit);
    await refused(previewItemReturn(order.id, { items: [{ orderItemId: line, quantity: 2, restock: true }] }), 409, "RETURN_EXCEEDS_OUTSTANDING");
  });

  it("exchange preview: same numbers and outcome as the approval that follows", async () => {
    const c = await newCustomer();
    const { variants } = await createStockedProduct({ stocks: [5, 5], variantPrices: [1800, 1500] });
    const order = await orderFor(c.id, [{ variantId: variants[0]!.id, quantity: 1 }]);
    await updateOrderStatus(order.id, { status: "DELIVERED" }, admin);
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    const req = await createReturnRequest(c.id, { orderId: order.id, type: "EXCHANGE", reason: "Size", note: null, orderItemId: item.id, requestedVariantId: variants[1]!.id });
    const preview = await previewExchange(req.id);
    expect(preview).toMatchObject({ quantity: 1, amountDue: 0, amountOwedBack: 300, canCredit: true, canRefund: true });
    expect(preview.original.paidValue).toBe(1800);
    expect(preview.replacement).toMatchObject({ value: 1500, inStock: true });
    await reviewReturnRequest(req.id, { status: "APPROVED", adminNote: null }, admin);
    const rr = await prisma.returnRequest.findUniqueOrThrow({ where: { id: req.id } });
    trackOrder(rr.exchangeOrderId!);
    expect(Number(rr.compensationAmount)).toBe(preview.amountOwedBack);
    await refused(previewExchange(req.id), 409);
  });

  it("HTTP: previews are permission-gated admin routes", async () => {
    const owner = await asOwner();
    expect((await request(app).post("/api/orders/x/returns/preview").send({ items: [] })).status).toBe(401);
    expect((await owner.get("/api/return-requests/does-not-exist/exchange-preview")).status).toBe(404);
  });
});

describe("size exchange (§9)", () => {
  async function deliveredWith(price: number, replacementPrice: number, replacementStock = 5) {
    const c = await newCustomer();
    const { variants } = await createStockedProduct({ stocks: [5, replacementStock], variantPrices: [price, replacementPrice] });
    const order = await orderFor(c.id, [{ variantId: variants[0]!.id, quantity: 1 }]);
    await updateOrderStatus(order.id, { status: "DELIVERED" }, admin);
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    const request = await createReturnRequest(c.id, { orderId: order.id, type: "EXCHANGE", reason: "Size", note: null, orderItemId: item.id, requestedVariantId: variants[1]!.id });
    return { c, variants, order, request };
  }

  it("same price: free exchange, M restocked, L taken", async () => {
    const { c, variants, request } = await deliveredWith(1500, 1500);
    await reviewReturnRequest(request.id, { status: "APPROVED", adminNote: null }, admin);
    expect(await stockOf(variants[0]!.id)).toBe(5);
    expect(await stockOf(variants[1]!.id)).toBe(4);
    expect(await balanceOf(c.id)).toBe(0);
    const rr = await prisma.returnRequest.findUniqueOrThrow({ where: { id: request.id } });
    trackOrder(rr.exchangeOrderId!);
    expect((await getOrderPaymentSummary(rr.exchangeOrderId!)).status).toBe("PAID");
  });

  it("dearer replacement: the difference is due on the replacement order", async () => {
    const { request } = await deliveredWith(1500, 1800);
    await reviewReturnRequest(request.id, { status: "APPROVED", adminNote: null }, admin);
    const rr = await prisma.returnRequest.findUniqueOrThrow({ where: { id: request.id } });
    trackOrder(rr.exchangeOrderId!);
    expect(await getOrderPaymentSummary(rr.exchangeOrderId!)).toMatchObject({ total: 300, amountDue: 300, codToCollect: 300 });
  });

  it("cheaper replacement: the difference goes to store credit (default)", async () => {
    const { c, request } = await deliveredWith(1800, 1500);
    await reviewReturnRequest(request.id, { status: "APPROVED", adminNote: null }, admin);
    const rr = await prisma.returnRequest.findUniqueOrThrow({ where: { id: request.id } });
    trackOrder(rr.exchangeOrderId!);
    expect(await balanceOf(c.id)).toBe(300);
    expect(rr.compensation).toBe("STORE_CREDIT");
  });

  it("replacement out of stock: the approval rolls back entirely; a second review is refused", async () => {
    const { variants, request } = await deliveredWith(1500, 1500, 0);
    await refused(reviewReturnRequest(request.id, { status: "APPROVED", adminNote: null }, admin), 409);
    expect((await prisma.returnRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("PENDING");
    expect(await stockOf(variants[0]!.id)).toBe(4);
  });
});

describe("payment links (§11 / payment-link spec)", () => {
  it("unpaid order: link for the balance due; paying it settles the exact order and uses the link up", async () => {
    const c = await newCustomer();
    const { variants } = await createStockedProduct({ stocks: [5], basePrice: 2940 });
    const order = await orderFor(c.id, [{ variantId: variants[0]!.id, quantity: 1 }]); // COD 3000
    const link = await createPaymentLink(order.id, { expiresInHours: 24, send: [] }, admin);
    expect(link).toMatchObject({ amount: 3000, status: "ACTIVE", purpose: "ORDER_BALANCE" });
    const token = new URL(link.url!).pathname.split("/").pop()!;
    const view = await viewPaymentLink(token);
    expect(view).toMatchObject({ status: "ACTIVE", amount: 3000, orderNumber: order.orderNumber });
    expect(JSON.stringify(view)).not.toContain(order.customerPhone);
    // No payment exists merely because a link does.
    expect((await getOrderPaymentSummary(order.id)).paid).toBe(0);

    const { sessionId } = await startPaymentLink(token, "EPS_PG");
    const session = await prisma.paymentSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(Number(session.amount)).toBe(3000);
    await settlePaymentSession(session.gatewayTransactionRef, `eps_link_${order.id}`, 3000);
    await settlePaymentSession(session.gatewayTransactionRef, `eps_link_${order.id}`, 3000); // replayed callback
    const summary = await getOrderPaymentSummary(order.id);
    expect(summary).toMatchObject({ status: "PAID", paid: 3000, codToCollect: 0 });
    expect(summary.payments).toHaveLength(1);
    expect((await prisma.paymentLink.findUniqueOrThrow({ where: { id: link.id } })).status).toBe("USED");
    await refused(startPaymentLink(token, "EPS_PG"), 409, "PAYMENT_LINK_INACTIVE");
    await refused(createPaymentLink(order.id, { expiresInHours: 24, send: [] }, admin), 409, "PAYMENT_LINK_NOT_ALLOWED");
  });

  it("the order changes after the link was made: the stale link can't collect the old amount", async () => {
    const c = await newCustomer();
    const { variants } = await createStockedProduct({ stocks: [5], basePrice: 2940 });
    const order = await orderFor(c.id, [{ variantId: variants[0]!.id, quantity: 1 }]);
    const link = await createPaymentLink(order.id, { expiresInHours: 24, send: [] }, admin);
    const token = new URL(link.url!).pathname.split("/").pop()!;
    await applyOrderModification(order.id, { items: [{ variantId: variants[0]!.id, quantity: 2 }] }, { type: "ADMIN", adminId: admin });
    expect((await viewPaymentLink(token)).status).not.toBe("ACTIVE");
    await refused(startPaymentLink(token, "EPS_PG"), 409, "PAYMENT_LINK_INACTIVE");
    // A new link carries the new balance due.
    expect((await createPaymentLink(order.id, { expiresInHours: 24, send: [] }, admin)).amount).toBe(5940);
  });

  it("a paid order modified upward: the link collects only the difference and applies the change", async () => {
    const c = await newCustomer();
    const { variants } = await createStockedProduct({ stocks: [5], basePrice: 1000 });
    const order = await paidOnlineOrder(c.id, [{ variantId: variants[0]!.id, quantity: 1 }]);
    const mod = await applyOrderModification(order.id, { items: [{ variantId: variants[0]!.id, quantity: 2 }] }, { type: "ADMIN", adminId: admin });
    const link = await createPaymentLink(order.id, { expiresInHours: 24, send: ["SMS"], modificationId: mod.modification.id }, admin);
    expect(link).toMatchObject({ amount: 1000, purpose: "MODIFICATION" });
    expect(await prisma.outboxEvent.count({ where: { consumer: "customer-payment-link", payload: { path: ["paymentLinkId"], equals: link.id } } })).toBe(1);
    const token = new URL(link.url!).pathname.split("/").pop()!;
    const { sessionId } = await startPaymentLink(token, "EPS_PG");
    const session = await prisma.paymentSession.findUniqueOrThrow({ where: { id: sessionId } });
    await settlePaymentSession(session.gatewayTransactionRef, `eps_modlink_${order.id}`, 1000);
    expect(await getOrderPaymentSummary(order.id)).toMatchObject({ status: "PAID", total: 2060, paid: 2060 });
    // The link that carried the payment is USED — applying the change must not cancel it as a "stale" link.
    expect((await prisma.paymentLink.findUniqueOrThrow({ where: { id: link.id } })).status).toBe("USED");
  });

  it("an unknown token is not found; HTTP view is public and rate-limited", async () => {
    await refused(viewPaymentLink("nope"), 404);
    expect((await request(app).get("/api/pay/not-a-real-token")).status).toBe(404);
  });

  it("admin HTTP: generate, list, cancel", async () => {
    const c = await newCustomer();
    const { variants } = await createStockedProduct({ stocks: [5], basePrice: 500 });
    const order = await orderFor(c.id, [{ variantId: variants[0]!.id, quantity: 1 }]);
    const owner = await asOwner();
    const created = await owner.post(`/api/orders/${order.id}/payment-links`, { expiresInHours: 2 });
    expect(created.status).toBe(201);
    const listed = await owner.get(`/api/orders/${order.id}/payment-links`);
    expect(listed.body.links).toHaveLength(1);
    const cancelled = await owner.post(`/api/orders/${order.id}/payment-links/${created.body.link.id}/cancel`);
    expect(cancelled.body.link.status).toBe("CANCELLED");
  });
});
