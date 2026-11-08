import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { cleanupFixtures, createStockedProduct, ownerId, stockOf, trackOrder } from "../../test-fixtures";
import { createManualOrder, updateOrderStatus } from "./order.service";
import { getProviders } from "../../providers/registry";
import { deliverCustomerOrderSms } from "../../lib/order-sms";
import { confirmBySelf, getSelfConfirmView, parseSelfConfirmCode, selfConfirmCode } from "./self-confirm";

// The order-placed SMS can carry a signed link: the customer confirms (or cancels) the order themselves, so staff only
// call the ones who didn't. The link is a capability — the order number plus an HMAC — and changes a PENDING
// cash-on-delivery order only; anything else is shown as it is.

let owner: string;
let variantId: string;

async function pendingOrder(phoneTail: string) {
  const o = await createManualOrder(
    {
      items: [{ variantId, quantity: 1 }],
      customerName: "Vitest Self Confirm",
      customerPhone: `0171234${phoneTail}`,
      shippingDivision: "Dhaka",
      shippingDistrict: "Dhaka",
      shippingArea: "Uttara",
      shippingAddressLine: "House 1",
      paymentMethod: "COD",
      confirmNow: false,
    } as never,
    owner,
  );
  trackOrder(o.id);
  return o;
}

beforeAll(async () => {
  owner = await ownerId();
  const { variants } = await createStockedProduct({ stocks: [30], basePrice: 500 });
  variantId = variants[0]!.id;
});
afterAll(async () => {
  await cleanupFixtures();
  await prisma.$disconnect();
});

describe("signed self-confirm code", () => {
  it("is the order number plus a 10-character signature, stable, and round-trips", () => {
    const code = selfConfirmCode("AZ1001");
    expect(code).toMatch(/^AZ1001\.[A-Za-z0-9_-]{10}$/);
    expect(selfConfirmCode("AZ1001")).toBe(code);
    expect(parseSelfConfirmCode(code)).toBe("AZ1001");
  });

  it("rejects a tampered, missing or borrowed signature", () => {
    const code = selfConfirmCode("AZ1001");
    const sig = code.split(".")[1]!;
    const flipped = `AZ1001.${sig[0] === "A" ? "B" : "A"}${sig.slice(1)}`;
    for (const bad of [flipped, "AZ1001", "AZ1001.", `AZ1002.${sig}`, ""]) expect(parseSelfConfirmCode(bad)).toBeNull();
  });
});

describe("customer confirms or cancels from the link", () => {
  it("confirms a pending COD order once, as the customer, with a timeline note", async () => {
    const o = await pendingOrder("701");
    expect(o.status).toBe("PENDING");
    const code = selfConfirmCode(o.orderNumber);
    expect((await getSelfConfirmView(code)).canAct).toBe(true);

    const first = await confirmBySelf(code, "confirm");
    expect(first.status).toBe("CONFIRMED");
    expect(first.canAct).toBe(false);
    const again = await confirmBySelf(code, "confirm");
    expect(again.status).toBe("CONFIRMED");

    const attempts = await prisma.orderConfirmationAttempt.findMany({ where: { orderId: o.id } });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ outcome: "CONFIRMED", adminId: null });
    const history = await prisma.orderStatusHistory.findMany({ where: { orderId: o.id } });
    expect(history.some((h) => h.status === "CONFIRMED" && /Confirmed by the customer from the SMS link/.test(h.note ?? ""))).toBe(true);
  });

  it("cancels a pending order and gives the stock back", async () => {
    const before = await stockOf(variantId);
    const o = await pendingOrder("702");
    expect(await stockOf(variantId)).toBe(before - 1);
    const v = await confirmBySelf(selfConfirmCode(o.orderNumber), "cancel");
    expect(v.status).toBe("CANCELLED");
    expect(await stockOf(variantId)).toBe(before);
    const attempts = await prisma.orderConfirmationAttempt.findMany({ where: { orderId: o.id } });
    expect(attempts.map((a) => a.outcome)).toEqual(["DECLINED"]);
  });

  it("leaves an order staff already cancelled exactly as it is", async () => {
    const o = await pendingOrder("703");
    await updateOrderStatus(o.id, { status: "CANCELLED", note: "Customer called to cancel" } as never, owner);
    const v = await confirmBySelf(selfConfirmCode(o.orderNumber), "confirm");
    expect(v.status).toBe("CANCELLED");
    expect(v.canAct).toBe(false);
    expect(await prisma.orderConfirmationAttempt.count({ where: { orderId: o.id } })).toBe(0);
  });

  it("a bad code is not found, whatever is wrong with it", async () => {
    await expect(getSelfConfirmView("AZ0000.abcdefghij")).rejects.toMatchObject({ statusCode: 404 });
    const o = await pendingOrder("704");
    await expect(confirmBySelf(`${o.orderNumber}.abcdefghij`, "confirm")).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("public routes", () => {
  it("GET shows the order, POST confirms it, a wrong action is refused, a bad code is 404", async () => {
    const o = await pendingOrder("705");
    const code = selfConfirmCode(o.orderNumber);
    const view = await request(app).get(`/api/order-confirm/${code}`);
    expect(view.status).toBe(200);
    expect(view.body.order).toMatchObject({ orderNumber: o.orderNumber, status: "PENDING", canAct: true });
    expect(view.body.order.items[0]).toMatchObject({ quantity: 1 });
    expect(JSON.stringify(view.body)).not.toContain("01712340705"); // no phone on a public page

    expect((await request(app).post(`/api/order-confirm/${code}`).send({ action: "delete" })).status).toBe(400);
    const done = await request(app).post(`/api/order-confirm/${code}`).send({ action: "confirm" });
    expect(done.status).toBe(200);
    expect(done.body.order.status).toBe("CONFIRMED");
    expect((await request(app).get(`/api/order-confirm/${o.orderNumber}.zzzzzzzzzz`)).status).toBe(404);
  });
});

describe("the order-placed SMS carries the link only when switched on", () => {
  const facts = (o: { orderNumber: string; total: unknown; customerName: string; customerPhone: string }, extra: Record<string, unknown> = {}) =>
    ({ orderNumber: o.orderNumber, total: o.total, customerName: o.customerName, customerPhone: o.customerPhone, status: "PENDING", paymentMethod: "COD", ...extra }) as never;

  async function placedBody(order: Parameters<typeof facts>[0], extra: Record<string, unknown> = {}) {
    const send = vi.spyOn(getProviders().sms, "send").mockResolvedValue(undefined as never);
    try {
      await deliverCustomerOrderSms(facts(order, extra), "PLACED");
      return String(send.mock.calls.at(-1)?.[0]?.body ?? "");
    } finally {
      send.mockRestore();
    }
  }
  async function setSms(data: Record<string, unknown>) {
    await prisma.smsNotificationSetting.upsert({ where: { id: "singleton" }, create: { id: "singleton", ...data }, update: data });
  }

  it("off: today's message, no link", async () => {
    const o = await pendingOrder("706");
    await setSms({ customerSelfConfirmEnabled: false, customerOrderPlacedEnabled: true, customerOrderPlacedTemplate: null });
    expect(await placedBody(o)).not.toContain("/c/");
  });

  it("on: a pending COD order gets its signed link; a paid order and a custom template are handled", async () => {
    const o = await pendingOrder("707");
    await setSms({ customerSelfConfirmEnabled: true, customerOrderPlacedEnabled: true, customerOrderPlacedTemplate: null });
    try {
      const body = await placedBody(o);
      expect(body).toContain(`/c/${selfConfirmCode(o.orderNumber)}`);
      expect(await placedBody(o, { paymentMethod: "EPS" })).not.toContain("/c/");
      await setSms({ customerOrderPlacedTemplate: "Order {orderNumber} received." });
      expect(await placedBody(o)).toMatch(new RegExp(`^Order ${o.orderNumber} received\. .+/c/${o.orderNumber}\.`));
      await setSms({ customerOrderPlacedTemplate: "Confirm here {confirmLink} thanks" });
      expect(await placedBody(o)).toMatch(/^Confirm here \S+\/c\/\S+ thanks$/);
    } finally {
      await setSms({ customerSelfConfirmEnabled: false, customerOrderPlacedTemplate: null });
    }
  });
});
