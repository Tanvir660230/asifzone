import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { overrideIntegrationsForTests } from "../../config/integration-overrides";
import { prisma } from "../../config/prisma";
import { asOwner, cleanupFixtures, createStockedProduct, placeOrder } from "../../test-fixtures";
import { bookOrderWithSteadfast, bookOrdersWithSteadfastBulk } from "./courier.service";

// Courier notes: store rules ticked on products/categories or triggered by a discount reach Steadfast's parcel note.

const realFetch = globalThis.fetch;
let restoreSteadfast: () => void = () => {};
const ruleIds: string[] = [];
let consignmentSeq = Math.floor(Date.now() / 1000) * 1000 + 500;

/** Stubs Steadfast and records the `note` of every parcel sent (single and bulk). */
function stubSteadfast() {
  const notes: Array<string | undefined> = [];
  globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
    const url = String(input);
    if (!url.includes("steadfast.invalid")) return realFetch(input as string, init as RequestInit);
    // Anything but a booking (the order's automatic delivery-score check) gets an empty answer.
    if (!url.includes("/create_order")) return new Response("{}", { status: 404 });
    const body = JSON.parse(String(init?.body));
    if (url.endsWith("/create_order/bulk-order")) {
      const payload = JSON.parse(body.data) as Array<{ invoice: string; note?: string }>;
      notes.push(...payload.map((p) => p.note));
      return new Response(JSON.stringify({ status: 200, data: payload.map((p) => ({ invoice: p.invoice, consignment_id: ++consignmentSeq, tracking_code: `TRK${consignmentSeq}`, status: "success" })) }), { status: 200 });
    }
    notes.push(body.note);
    consignmentSeq++;
    return new Response(JSON.stringify({ status: 200, consignment: { consignment_id: consignmentSeq, tracking_code: `TRK-N${consignmentSeq}`, status: "in_review", tracking_link: "https://t.invalid" } }), { status: 200 });
  }) as typeof fetch;
  return notes;
}

async function createRule(owner: Awaited<ReturnType<typeof asOwner>>, body: object) {
  const res = await owner.post("/api/catalog/courier-notes", body);
  expect(res.status).toBe(201);
  ruleIds.push(res.body.rule.id);
  return res.body.rule as { id: string; text: string };
}

let owner: Awaited<ReturnType<typeof asOwner>>;
let fragrance: { id: string; text: string };
let discount: { id: string; text: string };

beforeAll(async () => {
  owner = await asOwner();
  restoreSteadfast = overrideIntegrationsForTests({ STEADFAST_API_KEY: "test-key", STEADFAST_SECRET_KEY: "test-secret", STEADFAST_BASE_URL: "https://steadfast.invalid/api/v1" });
  fragrance = await createRule(owner, { name: "Vitest perfume", text: "পারফিউম — প্যাকেট খোলা যাবে না", trigger: "PRODUCT", sortOrder: 0 });
  // Threshold high enough that no other test file's orders trip it.
  discount = await createRule(owner, { name: "Vitest big discount", text: "বড় ডিসকাউন্ট — খুলে দেখানো যাবে না", trigger: "DISCOUNT", minDiscountPercent: 90, sortOrder: 1 });
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  restoreSteadfast();
  await prisma.courierNoteRule.deleteMany({ where: { id: { in: ruleIds } } });
  await cleanupFixtures();
  await prisma.$disconnect();
});

describe("courier-note rules", () => {
  it("rejects a discount rule without a threshold", async () => {
    const res = await owner.post("/api/catalog/courier-notes", { name: "x", text: "y", trigger: "DISCOUNT" });
    expect(res.status).toBe(400);
  });

  it("stores only rule ids that exist when a product is saved", async () => {
    const { product } = await createStockedProduct();
    const res = await owner.patch(`/api/products/${product.id}`, { courierNoteRuleIds: [fragrance.id, "no-such-rule", fragrance.id] });
    expect(res.status).toBe(200);
    const saved = await prisma.product.findUniqueOrThrow({ where: { id: product.id }, select: { courierNoteRuleIds: true } });
    expect(saved.courierNoteRuleIds).toEqual([fragrance.id]);
  });
});

describe("booking with Steadfast", () => {
  it("sends the ticked rule's text plus the customer's note, and records what was sent", async () => {
    const { product, variants } = await createStockedProduct();
    await prisma.product.update({ where: { id: product.id }, data: { courierNoteRuleIds: [fragrance.id] } });
    const order = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }], { notes: "অফিস টাইমে দেবেন" });

    const preview = await owner.get(`/api/orders/${order.id}/courier-note`);
    expect(preview.status).toBe(200);
    expect(preview.body.effective).toBe(`${fragrance.text} | গ্রাহকের নোট: অফিস টাইমে দেবেন`);

    const sent = stubSteadfast();
    await bookOrderWithSteadfast(order.id);
    expect(sent).toEqual([`${fragrance.text} | গ্রাহকের নোট: অফিস টাইমে দেবেন`]);
    const saved = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { courierNoteSent: true } });
    expect(saved.courierNoteSent).toBe(sent[0]);
  });

  it("adds the discount rule when a line sells far below its compare-at price (bulk booking)", async () => {
    const { product, variants } = await createStockedProduct({ basePrice: 100 });
    await prisma.product.update({ where: { id: product.id }, data: { compareAtPrice: 1000 } });
    const discounted = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
    const { variants: plain } = await createStockedProduct({ basePrice: 500 });
    const regular = await placeOrder([{ variantId: plain[0]!.id, quantity: 1 }]);

    const sent = stubSteadfast();
    const result = await bookOrdersWithSteadfastBulk([discounted.id, regular.id]);
    expect(result.booked).toHaveLength(2);
    const notes = await prisma.order.findMany({ where: { id: { in: [discounted.id, regular.id] } }, select: { id: true, courierNoteSent: true } });
    const byId = new Map(notes.map((n) => [n.id, n.courierNoteSent]));
    expect(byId.get(discounted.id)).toBe(discount.text);
    expect(byId.get(regular.id)).toBeNull();
    expect(sent).toContain(discount.text);
  });

  it("inherits rules from the product's category", async () => {
    const { product, variants } = await createStockedProduct();
    const category = await prisma.category.create({ data: { name: `Vitest CN ${Date.now()}`, slug: `vitest-cn-${Date.now()}`, courierNoteRuleIds: [fragrance.id] } });
    try {
      await prisma.product.update({ where: { id: product.id }, data: { categoryId: category.id } });
      const order = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
      const preview = await owner.get(`/api/orders/${order.id}/courier-note`);
      expect(preview.body.built).toBe(fragrance.text);
    } finally {
      await prisma.product.update({ where: { id: product.id }, data: { categoryId: (await prisma.category.findFirstOrThrow({ where: { deletedAt: null, NOT: { id: category.id } } })).id } });
      await prisma.category.delete({ where: { id: category.id } });
    }
  });

  it("sends staff's own wording instead, and freezes it once booked", async () => {
    const { product, variants } = await createStockedProduct();
    await prisma.product.update({ where: { id: product.id }, data: { courierNoteRuleIds: [fragrance.id] } });
    const order = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);

    expect((await owner.patch(`/api/orders/${order.id}/details`, { courierNote: "সন্ধ্যার পরে দেবেন" })).status).toBe(200);
    const sent = stubSteadfast();
    await bookOrderWithSteadfast(order.id);
    expect(sent).toEqual(["সন্ধ্যার পরে দেবেন"]);

    const change = await owner.patch(`/api/orders/${order.id}/details`, { courierNote: "অন্য কিছু" });
    expect(change.status).toBe(400);
    // Saving other details with the same note still works after booking.
    expect((await owner.patch(`/api/orders/${order.id}/details`, { courierNote: "সন্ধ্যার পরে দেবেন", adminNotes: "ok" })).status).toBe(200);
  });

  it("deleting a rule strips it from products", async () => {
    const temp = await createRule(owner, { name: "Vitest temp", text: "অস্থায়ী", trigger: "PRODUCT" });
    const { product } = await createStockedProduct();
    await prisma.product.update({ where: { id: product.id }, data: { courierNoteRuleIds: [fragrance.id, temp.id] } });
    expect((await owner.delete(`/api/catalog/courier-notes/${temp.id}`)).status).toBe(204);
    const saved = await prisma.product.findUniqueOrThrow({ where: { id: product.id }, select: { courierNoteRuleIds: true } });
    expect(saved.courierNoteRuleIds).toEqual([fragrance.id]);
  });
});
