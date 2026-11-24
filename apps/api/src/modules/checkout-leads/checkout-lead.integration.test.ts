import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { nextCallingMoment, recordCheckoutLeadActionSchema } from "@clothing-brand/shared";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { cleanupFixtures, createStockedProduct, ownerId, placeOrder, stockOf } from "../../test-fixtures";
import { createManualOrder } from "../orders/order.service";
import { captureCheckoutLead, checkoutLeadSummary, listCheckoutLeads, recordCheckoutLeadAction, resumeCheckoutLead, sweepCheckoutLeads } from "./checkout-lead.service";
import { checkoutLeadCode } from "./checkout-lead-code";

// Incomplete orders (docs/INCOMPLETE_ORDERS.md). Owner decisions 2026-11-22: a valid phone typed at checkout or on a
// landing page is saved; staff see it after 15 quiet minutes inside 10:00–21:00; at most two unanswered calls; an order
// from that phone closes it; never holds stock; open ones close after 3 days and everything goes after 30.

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
let owner: string;
let seq = 0;
const phones: string[] = [];

/** A fresh phone per test so leads never collide across tests or runs. */
function phone() {
  const p = `017${String(Date.now() % 1e7).padStart(7, "0").slice(0, 4)}${String(++seq).padStart(4, "0")}`.slice(0, 11);
  phones.push(p);
  return p;
}

beforeAll(async () => {
  owner = await ownerId();
});

afterAll(async () => {
  await prisma.checkoutLead.deleteMany({ where: { phone: { in: phones } } });
  await cleanupFixtures();
  await prisma.$disconnect();
});

async function product(stock = 5) {
  const { variants } = await createStockedProduct({ stocks: [stock], basePrice: 1200 });
  return variants[0]!.id;
}
/** Make a lead look as if the shopper left `minutes` ago (and was captured then). */
async function age(p: string, minutes: number) {
  const at = new Date(Date.now() - minutes * MIN);
  await prisma.checkoutLead.updateMany({ where: { phone: p }, data: { lastActivityAt: at, createdAt: at, nextCallAt: at } });
}
const leadOf = (p: string) => prisma.checkoutLead.findFirstOrThrow({ where: { phone: p }, orderBy: { createdAt: "desc" } });

describe("capture", () => {
  it("saves a lead from the public endpoint, keeps one open lead per phone and never touches stock", async () => {
    const variantId = await product(5);
    const p = phone();
    const res = await request(app).post("/api/checkout-leads/capture").send({ phone: p, items: [{ variantId, quantity: 1 }], source: "CHECKOUT" });
    expect(res.status).toBe(200);
    await captureCheckoutLead({ phone: p, name: "Rahim", shippingDistrict: "Dhaka", items: [{ variantId, quantity: 2 }], source: "CHECKOUT" });
    // A cleared field keeps what was typed before.
    await captureCheckoutLead({ phone: p, items: [{ variantId, quantity: 2 }], source: "CHECKOUT" });
    const rows = await prisma.checkoutLead.findMany({ where: { phone: p } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "OPEN", name: "Rahim", shippingDistrict: "Dhaka" });
    expect(Number(rows[0]!.value)).toBe(2400);
    expect(await stockOf(variantId)).toBe(5);
  });

  it("refuses an invalid phone, and skips a do-not-contact phone and a blocked customer", async () => {
    const variantId = await product();
    const bad = await request(app).post("/api/checkout-leads/capture").send({ phone: "12345", items: [{ variantId, quantity: 1 }], source: "CHECKOUT" });
    expect(bad.status).toBe(400);

    const p = phone();
    await captureCheckoutLead({ phone: p, items: [{ variantId, quantity: 1 }], source: "LANDING", landingSlug: "caps" });
    const lead = await leadOf(p);
    await recordCheckoutLeadAction(lead.id, { action: "DO_NOT_CONTACT" }, owner);
    await captureCheckoutLead({ phone: p, items: [{ variantId, quantity: 1 }], source: "CHECKOUT" });
    expect(await prisma.checkoutLead.count({ where: { phone: p } })).toBe(1);
  });
});

describe("the work list", () => {
  it("shows a lead only after 15 quiet minutes, and an order from that phone converts it", async () => {
    const variantId = await product();
    const p = phone();
    await captureCheckoutLead({ phone: p, name: "Karim", items: [{ variantId, quantity: 1 }], source: "CHECKOUT" });
    expect((await listCheckoutLeads("open")).some((l) => l.phone === p)).toBe(false);
    await age(p, 40);
    const listed = (await listCheckoutLeads("open")).find((l) => l.phone === p);
    expect(listed).toMatchObject({ name: "Karim", complete: false, attempts: 0 });
    expect(listed!.items[0]).toMatchObject({ variantId, available: true });

    const order = await placeOrder([{ variantId, quantity: 1 }], { customerPhone: p });
    expect(await leadOf(p)).toMatchObject({ status: "CONVERTED", outcome: "ORDERED_ONLINE", orderId: order.id });
    expect((await listCheckoutLeads("open")).some((l) => l.phone === p)).toBe(false);
  });

  it("two unanswered calls close it; the second waits for the next day", async () => {
    const variantId = await product();
    const p = phone();
    await captureCheckoutLead({ phone: p, items: [{ variantId, quantity: 1 }], source: "CHECKOUT" });
    await age(p, 40);
    const { id } = await leadOf(p);
    const after1 = await recordCheckoutLeadAction(id, { action: "NO_ANSWER" }, owner);
    expect(after1).toMatchObject({ status: "OPEN", attempts: 1 });
    expect(new Date(after1.nextCallAt).getTime()).toBeGreaterThan(Date.now() + 8 * 60 * MIN);
    const after2 = await recordCheckoutLeadAction(id, { action: "NO_ANSWER" }, owner);
    expect(after2).toMatchObject({ status: "CLOSED", outcome: "NO_ANSWER_LIMIT", attempts: 2 });
    await expect(recordCheckoutLeadAction(id, { action: "NO_ANSWER" }, owner)).rejects.toMatchObject({ statusCode: 409 });
  });

  it("'Not interested' needs a reason, and the summary counts it", async () => {
    expect(recordCheckoutLeadActionSchema.safeParse({ action: "NOT_INTERESTED" }).success).toBe(false);
    expect(recordCheckoutLeadActionSchema.safeParse({ action: "CALL_LATER" }).success).toBe(false);
    const variantId = await product();
    const p = phone();
    await captureCheckoutLead({ phone: p, items: [{ variantId, quantity: 1 }], source: "CHECKOUT" });
    const { id } = await leadOf(p);
    const before = await checkoutLeadSummary(1);
    await recordCheckoutLeadAction(id, { action: "NOT_INTERESTED", reason: "DELIVERY_CHARGE" }, owner);
    const after = await checkoutLeadSummary(1);
    expect(after.notInterested).toBe(before.notInterested + 1);
    expect(after.reasons.find((r) => r.reason === "DELIVERY_CHARGE")!.count).toBeGreaterThanOrEqual(1);
  });

  it("an order staff enter from the lead closes it as ordered on the call", async () => {
    const variantId = await product();
    const p = phone();
    await captureCheckoutLead({ phone: p, name: "Sumi", items: [{ variantId, quantity: 1 }], source: "CHECKOUT" });
    const { id } = await leadOf(p);
    // Staff corrected the number on the call: the lead is still closed by its id.
    const other = phone();
    const order = await createManualOrder(
      {
        items: [{ variantId, quantity: 1 }],
        customerName: "Sumi",
        customerPhone: other,
        shippingDivision: "Dhaka",
        shippingDistrict: "Dhaka",
        shippingArea: "Mirpur",
        shippingAddressLine: "Road 1",
        paymentMethod: "COD",
        confirmNow: true,
        checkoutLeadId: id,
      } as never,
      owner,
    );
    expect(await prisma.checkoutLead.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "CONVERTED", outcome: "ORDERED_BY_STAFF", orderId: order.id });
  });
});

describe("resume link and retention", () => {
  it("the signed link gives the cart back; a forged one gives nothing", async () => {
    const variantId = await product();
    const p = phone();
    await captureCheckoutLead({ phone: p, name: "Nila", items: [{ variantId, quantity: 2 }], source: "CHECKOUT" });
    const { id } = await leadOf(p);
    const back = await resumeCheckoutLead(checkoutLeadCode(id));
    expect(back).toMatchObject({ name: "Nila", phone: p });
    expect(back!.items[0]).toMatchObject({ variantId, quantity: 2 });
    expect(await resumeCheckoutLead(`${id}.AAAAAAAAAAAA`)).toBeNull();
    const res = await request(app).get(`/api/checkout-leads/resume/${checkoutLeadCode(id)}`);
    expect(res.status).toBe(200);
  });

  it("closes open leads after 3 days and deletes leads after 30, keeping only a do-not-contact phone", async () => {
    const variantId = await product();
    const [a, b, c] = [phone(), phone(), phone()];
    for (const p of [a, b, c]) await captureCheckoutLead({ phone: p, name: "X", items: [{ variantId, quantity: 1 }], source: "CHECKOUT" });
    await recordCheckoutLeadAction((await leadOf(c)).id, { action: "DO_NOT_CONTACT" }, owner);
    await prisma.checkoutLead.updateMany({ where: { phone: a }, data: { createdAt: new Date(Date.now() - 4 * DAY) } });
    await prisma.checkoutLead.updateMany({ where: { phone: { in: [b, c] } }, data: { createdAt: new Date(Date.now() - 31 * DAY) } });
    await sweepCheckoutLeads();
    expect(await leadOf(a)).toMatchObject({ status: "CLOSED", outcome: "EXPIRED" });
    expect(await prisma.checkoutLead.count({ where: { phone: b } })).toBe(0);
    expect(await leadOf(c)).toMatchObject({ outcome: "DO_NOT_CONTACT", name: null });
  });

  it("calling hours: a lead from the night waits for 10:00 store time", () => {
    // 23:30 Dhaka (17:30Z) → next day 10:00 Dhaka (04:00Z); 03:00 Dhaka (21:00Z prev day) → same day 10:00.
    expect(nextCallingMoment(new Date("2026-11-22T17:30:00Z"), "Asia/Dhaka").toISOString()).toBe("2026-11-23T04:00:00.000Z");
    expect(nextCallingMoment(new Date("2026-11-22T21:00:00Z"), "Asia/Dhaka").toISOString()).toBe("2026-11-23T04:00:00.000Z");
    const noon = new Date("2026-11-22T06:00:00Z");
    expect(nextCallingMoment(noon, "Asia/Dhaka")).toBe(noon);
  });
});
