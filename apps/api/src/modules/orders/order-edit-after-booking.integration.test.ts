import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "../../config/prisma";
import { cleanupFixtures, createStockedProduct, ownerId, placeOrder } from "../../test-fixtures";
import { markCourierUpdateDone, updateOrderDetails } from "./order.service";
import { applyOrderModification, previewOrderModification } from "./order-modification.service";

// Owner 2026-11-25: a parcel shipped with a wrong number must be fixable. Steadfast has no API to edit a consignment, so
// the change is saved and the order is flagged "tell the courier" until staff mark it done; the customer gets the
// current status SMS on the corrected number, and a guest's order follows that number to its customer.

let seq = 0;
const phone = () => `0171${String(Date.now()).slice(-4)}${String(++seq).padStart(3, "0")}`.slice(0, 11);

afterAll(async () => {
  await cleanupFixtures();
  await prisma.$disconnect();
});

async function bookedShippedOrder() {
  const { variants } = await createStockedProduct({ stocks: [5] });
  const order = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }], { customerPhone: phone() });
  await prisma.order.update({ where: { id: order.id }, data: { status: "SHIPPED", courierConsignmentId: `CN-${order.id}`, courierBookedAt: new Date() } });
  return order;
}

describe("changing customer details after the courier is booked", () => {
  it("saves the new phone and address, flags the order for the courier and re-sends the shipped SMS to the new number", async () => {
    const order = await bookedShippedOrder();
    const owner = await ownerId();
    const newPhone = phone();
    const updated = await updateOrderDetails(order.id, { customerPhone: newPhone, shippingAddressLine: "House 9, Road 2, Demra, Dhaka" }, owner);

    expect(updated).toMatchObject({ customerPhone: newPhone, shippingAddressLine: "House 9, Road 2, Demra, Dhaka", courierUpdateNeeded: true });
    expect(updated.courierUpdateNote).toContain(newPhone);
    const sms = await prisma.outboxEvent.findMany({ where: { consumer: "customer-order-sms", aggregateId: order.id, eventKey: { startsWith: "phone-change:" } } });
    expect(sms).toHaveLength(1);
    expect(sms[0]!.payload).toMatchObject({ touchpoint: "SHIPPED" });

    const done = await markCourierUpdateDone(order.id, owner);
    expect(done.courierUpdateNeeded).toBe(false);
    expect(done.customerPhone).toBe(newPhone);
  });

  it("a guest's order moves to the customer of the corrected number", async () => {
    const order = await bookedShippedOrder();
    const before = (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).customerId;
    const newPhone = phone();
    const updated = await updateOrderDetails(order.id, { customerPhone: newPhone });
    expect(updated.customerId).not.toBe(before);
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: updated.customerId! } });
    expect(customer.phone).toBe(newPhone);
  });

  it("an address-only change before booking raises no courier flag and sends no SMS", async () => {
    const { variants } = await createStockedProduct({ stocks: [5] });
    const order = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }], { customerPhone: phone() });
    const updated = await updateOrderDetails(order.id, { shippingAddressLine: "House 1, Road 1, Mirpur 10, Dhaka" });
    expect(updated.courierUpdateNeeded).toBe(false);
    expect(await prisma.outboxEvent.count({ where: { aggregateId: order.id, eventKey: { startsWith: "phone-change:" } } })).toBe(0);
  });
});

describe("changing the items of a booked order (owner 2026-11-26)", () => {
  it("staff can swap the size: stock follows, the courier is told what the parcel holds; COD only when it changes", async () => {
    const { variants } = await createStockedProduct({ stocks: [5, 5], basePrice: 1000 });
    const other = await createStockedProduct({ stocks: [5], basePrice: 400 });
    const [m, l] = [variants[0]!, variants[1]!];
    const order = await placeOrder([{ variantId: m.id, quantity: 1 }], { customerPhone: phone() });
    await prisma.order.update({ where: { id: order.id }, data: { status: "PROCESSING", courierConsignmentId: `CN-${order.id}`, courierBookedAt: new Date() } });
    const admin = { type: "ADMIN" as const, adminId: await ownerId() };

    await applyOrderModification(order.id, { items: [{ variantId: l.id, quantity: 1 }] }, admin);
    let after = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
    expect(after.items.map((i) => i.variantId)).toEqual([l.id]);
    expect(after.courierConsignmentId).toBe(`CN-${order.id}`);
    expect(after.courierUpdateNeeded).toBe(true);
    expect(after.courierUpdateNote).toMatch(/^Parcel now: .+×1\.$/);
    expect(after.courierUpdateNote).not.toContain("COD");

    await applyOrderModification(order.id, { items: [{ variantId: l.id, quantity: 1 }, { variantId: other.variants[0]!.id, quantity: 1 }] }, admin);
    after = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
    expect(after.courierUpdateNote!.match(/Parcel now/g)).toHaveLength(1);
    expect(after.courierUpdateNote).toContain(`COD now ৳${Number(after.total).toLocaleString("en-US")}`);

    // The customer can no longer change it online.
    await expect(previewOrderModification(order.id, { items: [{ variantId: m.id, quantity: 1 }] }, { type: "CUSTOMER", customerId: after.customerId! })).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("a second phone number", () => {
  it("is kept from checkout (not when it repeats the main number) and can be added after booking, flagging the courier", async () => {
    const { variants } = await createStockedProduct({ stocks: [5] });
    const main = phone();
    const alt = phone();
    const order = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }], { customerPhone: main, altPhone: alt } as never);
    expect(order.altPhone).toBe(alt);
    const same = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }], { customerPhone: main, altPhone: main } as never);
    expect(same.altPhone).toBeNull();

    await prisma.order.update({ where: { id: same.id }, data: { courierConsignmentId: `CN-${same.id}` } });
    const updated = await updateOrderDetails(same.id, { altPhone: alt });
    expect(updated).toMatchObject({ altPhone: alt, courierUpdateNeeded: true });
    expect(updated.courierUpdateNote).toContain(alt);
  });
});
