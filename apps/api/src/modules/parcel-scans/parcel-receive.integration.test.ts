import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { permissionsForRole, type ParcelView, type ReceiveParcelInput } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { asOwner, assertInventoryInvariants, cleanupFixtures, createStockedProduct, ownerId, placeOrder, stockOf } from "../../test-fixtures";
import { changeOrderStatus } from "../orders/order.service";
import { getOrderPaymentSummary, settleCourierCollected } from "../../domain/payments/payment-ledger.service";
import { confirmBatch, createBatch, recordScan } from "./parcel-scan.service";
import { linkParcelCode, resolveParcelCode } from "./parcel-resolve.service";
import { correctParcelReceipt, getParcelView, receiveParcel } from "./parcel-receive.service";

// The unified scanner (docs/ORDER_OPERATIONS.md "Receive and inspect", owner decisions D1–D6): every code on a real parcel
// resolves; a parcel is received without a return request; only what is physically in hand becomes stock; the courier's
// money is never sales by default; duplicates, stale views and concurrent operators change nothing twice; corrections are
// compensating entries. After each scenario the stock ledger invariants (INV-1/2/3) are checked.

let owner: string;
let seq = 0;
const key = () => `rk-${Date.now().toString(36)}-${(seq++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
let viewer: { adminId: string; permissions: ReturnType<typeof permissionsForRole> };

beforeAll(async () => {
  owner = await ownerId();
  viewer = { adminId: owner, permissions: permissionsForRole("OWNER") };
});
afterAll(async () => {
  await prisma.parcelCodeAlias.deleteMany({ where: { createdByAdminId: owner, code: { startsWith: "PRX" } } });
  await cleanupFixtures();
  await prisma.$disconnect();
});

/** A booked, shipped COD order (as booking leaves it): our label barcode, a consignment id and Steadfast's tracking link. */
async function shipped(quantity = 1, opts: { stock?: number; price?: number; lines?: number } = {}) {
  const { variants } = await createStockedProduct({ stocks: Array.from({ length: opts.lines ?? 1 }, () => opts.stock ?? 20), basePrice: opts.price ?? 500 });
  const order = await placeOrder(variants.map((v) => ({ variantId: v.id, quantity })));
  const tag = `${Date.now().toString(36)}${(seq++).toString(36)}`.toUpperCase();
  const consignment = `7${Date.now().toString().slice(-8)}${seq % 10}`;
  await changeOrderStatus(order.id, { status: "CONFIRMED", note: null }, owner);
  await prisma.order.update({
    where: { id: order.id },
    data: { trackingNumber: `SFR${tag}`, courierConsignmentId: consignment, courierBookedAt: new Date(), courierTrackingLink: `https://steadfast.com.bd/tl/Tk${tag}xYz` },
  });
  await changeOrderStatus(order.id, { status: "PACKED", note: null }, owner);
  await changeOrderStatus(order.id, { status: "SHIPPED", note: null }, owner);
  const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: { orderBy: { id: "asc" } } } });
  return { ...o, variantIds: variants.map((v) => v.id) };
}

const view = (orderId: string) => getParcelView(orderId, viewer);
async function receive(orderId: string, body: Omit<ReceiveParcelInput, "orderId" | "version"> & { version?: string }, k = key(), who = viewer) {
  const v = body.version ?? (await view(orderId)).version;
  return receiveParcel({ ...body, orderId, version: v } as ReceiveParcelInput, who, k);
}
const line = (orderItemId: string, f: Partial<Record<"kept" | "good" | "damaged" | "missing" | "wrong" | "other", number>> & { note?: string } = {}) => ({
  orderItemId,
  kept: 0,
  good: 0,
  damaged: 0,
  missing: 0,
  wrong: 0,
  other: 0,
  ...f,
});
const cancelledSms = (orderId: string) => prisma.outboxEvent.count({ where: { aggregateId: orderId, consumer: "customer-order-sms", payload: { path: ["touchpoint"], equals: "CANCELLED" } } });

describe("every code on a real parcel resolves", () => {
  it("Steadfast's return slip and label barcodes, its QR link, our label and our order number name the parcel; anything else is unknown", async () => {
    const o = await shipped();
    const slip = `003-0102-001-00${o.courierConsignmentId}`;
    expect(await resolveParcelCode(slip, "RETURN")).toMatchObject({ kind: "ORDER", orderId: o.id, matchedBy: "STEADFAST_SLIP" });
    expect(await resolveParcelCode(`002-0356-001-00${o.courierConsignmentId}`, "DISPATCH")).toMatchObject({ kind: "ORDER", orderId: o.id, matchedBy: "STEADFAST_SLIP" });
    expect(await resolveParcelCode(o.courierTrackingLink!, "RETURN")).toMatchObject({ kind: "ORDER", orderId: o.id, matchedBy: "STEADFAST_LINK" });
    expect(await resolveParcelCode(o.trackingNumber!, "RETURN")).toMatchObject({ orderId: o.id, matchedBy: "TRACKING" });
    expect(await resolveParcelCode(o.orderNumber.toLowerCase(), "RETURN")).toMatchObject({ orderId: o.id, matchedBy: "ORDER_NUMBER" });
    expect(await resolveParcelCode(o.courierConsignmentId!, "RETURN")).toMatchObject({ orderId: o.id, matchedBy: "CONSIGNMENT" });
    // Another store's parcel (its own database) or a stranger's sticker: unknown, nothing written.
    const before = await prisma.parcelScanEvent.count();
    expect(await resolveParcelCode("003-0102-001-00999999999", "RETURN")).toMatchObject({ kind: "UNKNOWN", orderId: null });
    expect(await prisma.parcelScanEvent.count()).toBe(before);
  });

  it("a batch return scan of the slip is accepted and says how it matched", async () => {
    const o = await shipped();
    await changeOrderStatus(o.id, { status: "CANCELLED", note: "Customer refused" }, owner);
    const batch = await createBatch(owner, "RETURN");
    const ev = await recordScan(batch.id, owner, { code: `003-0102-001-00${o.courierConsignmentId}`, clientScanId: key().replace(/[^A-Za-z0-9_-]/g, "") });
    expect(ev).toMatchObject({ result: "ACCEPTED", orderId: o.id, resolvedBy: "STEADFAST_SLIP" });
    await confirmBatch(batch.id, owner);
  });

  it("a product code in several parcels lists them all and never picks one — even when only one matches", async () => {
    const { variants } = await createStockedProduct({ stocks: [20], basePrice: 300 });
    const sku = (await prisma.productVariant.findUniqueOrThrow({ where: { id: variants[0]!.id } })).sku;
    const mk = async () => {
      const ord = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
      await changeOrderStatus(ord.id, { status: "CONFIRMED", note: null }, owner);
      await prisma.order.update({ where: { id: ord.id }, data: { courierConsignmentId: `6${Date.now()}${seq++}`, courierBookedAt: new Date() } });
      await changeOrderStatus(ord.id, { status: "SHIPPED", note: null }, owner);
      return ord;
    };
    const a = await mk();
    const one = await resolveParcelCode(sku, "RETURN");
    expect(one).toMatchObject({ kind: "CANDIDATES", matchedBy: "PRODUCT", orderId: null });
    expect(one.candidates.map((c) => c.orderId)).toEqual([a.id]);
    const b = await mk();
    const two = await resolveParcelCode(sku.toLowerCase(), "RETURN");
    expect(two.kind).toBe("CANDIDATES");
    expect(two.candidates.map((c) => c.orderId).sort()).toEqual([a.id, b.id].sort());
    // The phone on the order lists its parcels the same way.
    const phone = (await prisma.order.findUniqueOrThrow({ where: { id: a.id } })).customerPhone;
    expect((await resolveParcelCode(phone, "RETURN")).candidates.map((c) => c.orderId)).toContain(a.id);
  });

  it("a code linked by hand resolves next time; a code already naming another order can't be linked", async () => {
    const o = await shipped();
    const other = await shipped();
    const code = `PRX-STICKER-${Date.now()}`;
    expect((await resolveParcelCode(code, "RETURN")).kind).toBe("UNKNOWN");
    await linkParcelCode(code, o.id, owner);
    expect(await resolveParcelCode(code.toLowerCase(), "RETURN")).toMatchObject({ kind: "ORDER", orderId: o.id, matchedBy: "ALIAS" });
    await expect(linkParcelCode(code, other.id, owner)).rejects.toMatchObject({ statusCode: 409 });
    await expect(linkParcelCode(other.trackingNumber!, o.id, owner)).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("receiving a parcel with no return request", () => {
  it("kept nothing: cancelled without the customer SMS, only what is in hand goes back, once", async () => {
    const o = await shipped(1);
    const vid = o.variantIds[0]!;
    const stock = await stockOf(vid);
    const card = await view(o.id);
    expect(card).toMatchObject({ state: "READY_FOR_DISPATCH", receive: { mode: "DECIDE_OUTCOME", awaitingUnits: 1 } });

    const k = key();
    const r = await receive(o.id, { outcome: "FULL_RETURN", code: `003-0102-001-00${o.courierConsignmentId}`, lines: [line(o.items[0]!.id, { good: 1 })] }, k);
    expect(r.receipt).toMatchObject({ outcome: "FULL_RETURN", statusBefore: "SHIPPED", statusAfter: "CANCELLED" });
    expect(await stockOf(vid)).toBe(stock + 1);
    expect(await cancelledSms(o.id)).toBe(0);
    const after = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(after.receivedBackAt).not.toBeNull();
    expect(after.returnInspectedAt).not.toBeNull();
    expect(r.parcel.receive.mode).toBe("NOTHING");

    // The same confirm again (retry, double click): the first receipt, nothing more.
    const again = await receive(o.id, { outcome: "FULL_RETURN", version: card.version, lines: [line(o.items[0]!.id, { good: 1 })] }, k);
    expect(again).toMatchObject({ replayed: true, receipt: { id: r.receipt.id } });
    // A second operator working from the old card: refused, says who got there first.
    await expect(receive(o.id, { outcome: "FULL_RETURN", version: card.version, lines: [line(o.items[0]!.id, { good: 1 })] })).rejects.toMatchObject({ statusCode: 409, details: { code: "PARCEL_CHANGED" } });
    // A fresh card: nothing left to receive.
    await expect(receive(o.id, { lines: [line(o.items[0]!.id, { good: 1 })] })).rejects.toMatchObject({ statusCode: 409, details: { code: "NOTHING_TO_RECEIVE" } });
    expect(await stockOf(vid)).toBe(stock + 1);
    expect(await prisma.parcelReceipt.count({ where: { orderId: o.id } })).toBe(1);
    await assertInventoryInvariants(vid);
  });

  it("five caps: 2 good, 1 damaged, 2 missing — 2 sellable, 1 written off, 2 still waiting; the 2 arriving later close it", async () => {
    const o = await shipped(5);
    const vid = o.variantIds[0]!;
    const stock = await stockOf(vid);
    await receive(o.id, { outcome: "FULL_RETURN", lines: [line(o.items[0]!.id, { good: 2, damaged: 1, missing: 2 })] });
    expect(await stockOf(vid)).toBe(stock + 2);
    const item = await prisma.orderItem.findUniqueOrThrow({ where: { id: o.items[0]!.id } });
    expect(item.restockedQuantity).toBe(3);
    expect(await prisma.stockMovement.count({ where: { variantId: vid, reason: "DAMAGED", sourceId: o.id } })).toBe(1);
    const mid = await view(o.id);
    expect(mid.receive).toMatchObject({ mode: "INSPECT", awaitingUnits: 2 });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).returnInspectedAt).toBeNull(); // still "To inspect"

    await receive(o.id, { lines: [line(o.items[0]!.id, { good: 2 })] });
    expect(await stockOf(vid)).toBe(stock + 4);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).returnInspectedAt).not.toBeNull();
    await assertInventoryInvariants(vid);
  });

  it("more than can come back, or nothing entered, is refused and changes nothing", async () => {
    const o = await shipped(2);
    const vid = o.variantIds[0]!;
    const stock = await stockOf(vid);
    await expect(receive(o.id, { outcome: "FULL_RETURN", lines: [line(o.items[0]!.id, { good: 2, missing: 1 })] })).rejects.toMatchObject({ statusCode: 400, details: { code: "MORE_THAN_OUTSTANDING" } });
    await expect(receive(o.id, { outcome: "FULL_RETURN", lines: [line(o.items[0]!.id)] })).rejects.toMatchObject({ statusCode: 400, details: { code: "NOTHING_ENTERED" } });
    await expect(receive(o.id, { lines: [line(o.items[0]!.id, { good: 1 })] })).rejects.toMatchObject({ details: { code: "OUTCOME_REQUIRED" } });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("SHIPPED");
    expect(await stockOf(vid)).toBe(stock);
  });

  it("a wrong item back leaves the ordered unit waiting and says what came", async () => {
    const o = await shipped(1);
    const vid = o.variantIds[0]!;
    const stock = await stockOf(vid);
    await receive(o.id, { outcome: "FULL_RETURN", lines: [line(o.items[0]!.id, { wrong: 1, note: "a white cap instead of black" })] });
    expect(await stockOf(vid)).toBe(stock);
    expect((await view(o.id)).receive).toMatchObject({ mode: "INSPECT", awaitingUnits: 1 });
    const notes = await prisma.orderStatusHistory.findMany({ where: { orderId: o.id }, select: { note: true } });
    expect(notes.some((n) => n.note?.includes("a white cap instead of black"))).toBe(true);
  });

  it("two operators confirming the same parcel at once: one receipt, stock back once", async () => {
    const o = await shipped(1);
    const vid = o.variantIds[0]!;
    const stock = await stockOf(vid);
    const { version } = await view(o.id);
    const body = { version, outcome: "FULL_RETURN" as const, lines: [line(o.items[0]!.id, { good: 1 })] };
    const results = await Promise.allSettled([receive(o.id, body), receive(o.id, body)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { statusCode: 409 } });
    expect(await stockOf(vid)).toBe(stock + 1);
    await assertInventoryInvariants(vid);
  });
});

describe("partial delivery", () => {
  it("ordered 5, kept 2, 3 back: the 2 stay sold, the 3 come back, nothing is cancelled", async () => {
    const o = await shipped(5);
    const vid = o.variantIds[0]!;
    const stock = await stockOf(vid);
    const r = await receive(o.id, { outcome: "PARTIAL", lines: [line(o.items[0]!.id, { kept: 2, good: 3 })] });
    expect(r.receipt).toMatchObject({ statusAfter: "PARTIALLY_DELIVERED", outcome: "PARTIAL" });
    const item = await prisma.orderItem.findUniqueOrThrow({ where: { id: o.items[0]!.id } });
    expect([item.returnedQuantity, item.restockedQuantity]).toEqual([3, 3]);
    expect(await stockOf(vid)).toBe(stock + 3);
    const lineView = r.parcel.lines[0]!;
    expect(lineView).toMatchObject({ ordered: 5, delivered: 2, returned: 3, received: 3, awaiting: 0 });
    expect(await prisma.returnRequest.count({ where: { orderId: o.id, status: "APPROVED" } })).toBe(1);
    await assertInventoryInvariants(vid);
  });

  it("the courier said partly delivered and the customer kept nothing: reconciled here, Returned, Steadfast's collection settles as the return charge", async () => {
    const o = await shipped(2);
    const vid = o.variantIds[0]!;
    const stock = await stockOf(vid);
    await changeOrderStatus(o.id, { status: "PARTIALLY_DELIVERED", note: "Steadfast delivery status: partial_delivered" }, owner);
    await prisma.order.update({ where: { id: o.id }, data: { courierCollectedAmount: 100, courierCollectedAt: new Date() } });
    expect((await view(o.id)).receive.mode).toBe("RECONCILE");
    const r = await receive(o.id, { lines: [line(o.items[0]!.id, { good: 2 })] });
    expect(r.receipt.statusAfter).toBe("RETURNED");
    expect(await stockOf(vid)).toBe(stock + 2);
    const pay = await getOrderPaymentSummary(o.id);
    expect(pay.returnCharge).toBe(100);
    expect(pay.paid).toBe(0);
    await assertInventoryInvariants(vid);
  });
});

describe("the courier's money", () => {
  it("expected ৳total, got ৳100 on a refused parcel: a reason is required, then it is the return charge — not sales", async () => {
    const o = await shipped(2, { price: 999 });
    const vid = o.variantIds[0]!;
    const stock = await stockOf(vid);
    const card = await view(o.id);
    expect(card.money?.expectedCod).toBe(Number(o.total));
    // No reason: refused, and the whole receipt is undone with it.
    await expect(receive(o.id, { outcome: "FULL_RETURN", lines: [line(o.items[0]!.id, { good: 2 })], money: { actualCollected: 100 } })).rejects.toMatchObject({ details: { code: "REASON_REQUIRED" } });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("SHIPPED");
    expect(await stockOf(vid)).toBe(stock);

    await receive(o.id, { outcome: "FULL_RETURN", lines: [line(o.items[0]!.id, { good: 2 })], money: { actualCollected: 100, courierCharge: 80, reason: "COURIER_CHARGE_ONLY" } });
    const pay = await getOrderPaymentSummary(o.id);
    expect([pay.paid, pay.returnCharge]).toEqual([0, 100]);
    const rc = await prisma.payment.findMany({ where: { orderId: o.id, status: "SUCCEEDED" } });
    expect(rc.map((p) => [p.purpose, Number(p.amount)])).toEqual([["RETURN_CHARGE", 100]]);
    const leg = await prisma.shipment.findFirst({ where: { orderId: o.id, trackedByCourier: true } });
    expect(leg && Number(leg.actualCharge)).toBe(80);
    // Steadfast's own figure arriving later is not counted again.
    await prisma.order.update({ where: { id: o.id }, data: { courierCollectedAmount: 100 } });
    expect(await settleCourierCollected(o.id)).toBe("SKIPPED");
    expect((await getOrderPaymentSummary(o.id)).returnCharge).toBe(100);
  });

  it("kept some: the money pays for what they kept first, the rest is the return charge; a second recording is refused", async () => {
    const o = await shipped(2, { price: 500 });
    await receive(o.id, { outcome: "PARTIAL", lines: [line(o.items[0]!.id, { kept: 1, good: 1 })] });
    const due = (await getOrderPaymentSummary(o.id)).amountDue;
    expect(due).toBeGreaterThan(0);
    // Kept 1 of 4; 1 back now, 2 missing. The money comes with the next parcel; a third can't record money again.
    const o2 = await shipped(4, { price: 400 });
    const r = await receive(o2.id, { outcome: "PARTIAL", lines: [line(o2.items[0]!.id, { kept: 1, good: 1, missing: 2 })], money: { actualCollected: 0, reason: "PARTIAL_DELIVERY" } });
    expect(r.receipt.statusAfter).toBe("PARTIALLY_DELIVERED");
    const due2 = (await getOrderPaymentSummary(o2.id)).amountDue;
    expect(due2).toBeGreaterThan(0);
    const done = await receive(o2.id, { lines: [line(o2.items[0]!.id, { good: 1 })], money: { actualCollected: due2 + 60, reason: "PARTIAL_DELIVERY" } });
    const pay = await getOrderPaymentSummary(o2.id);
    expect([pay.paid, pay.returnCharge, pay.amountDue]).toEqual([due2, 60, 0]);
    expect(done.receipt.actualCollected).toBe(due2 + 60);
    await expect(receive(o2.id, { lines: [line(o2.items[0]!.id, { good: 1 })], money: { actualCollected: 10, reason: "OTHER" } })).rejects.toMatchObject({
      statusCode: 409,
      details: { code: "MONEY_ALREADY_RECORDED" },
    });
    expect((await view(o2.id)).receive.awaitingUnits).toBe(1);
  });

  it("without the Payments permission money can't be recorded — and the parcel isn't received either", async () => {
    const o = await shipped(1);
    const noMoney = { ...viewer, permissions: viewer.permissions.filter((p) => p !== "payments.record") };
    await expect(receive(o.id, { outcome: "FULL_RETURN", lines: [line(o.items[0]!.id, { good: 1 })], money: { actualCollected: 100, reason: "COURIER_CHARGE_ONLY" } }, key(), noMoney)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("SHIPPED");
    const card = await getParcelView(o.id, { ...noMoney, permissions: noMoney.permissions.filter((p) => p !== "payments.read") });
    expect(card.money).toBeNull();
  });
});

describe("other states", () => {
  it("cancelled after shipping: inspection only; cancelled before shipping or delivered: nothing to receive", async () => {
    const o = await shipped(1);
    await changeOrderStatus(o.id, { status: "CANCELLED", note: "Customer refused at the door" }, owner);
    expect((await view(o.id)).receive.mode).toBe("INSPECT");
    await receive(o.id, { lines: [line(o.items[0]!.id, { good: 1 })] });
    await assertInventoryInvariants(o.variantIds[0]!);

    const { variants } = await createStockedProduct({ stocks: [5] });
    const early = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
    await changeOrderStatus(early.id, { status: "CANCELLED", note: "Customer changed their mind" }, owner);
    expect((await view(early.id)).receive.mode).toBe("NOTHING");

    const d = await shipped(1);
    await changeOrderStatus(d.id, { status: "DELIVERED", note: null }, owner);
    const card = await view(d.id);
    expect(card).toMatchObject({ state: "DELIVERED", receive: { mode: "NOTHING" } });
    await expect(receive(d.id, { lines: [line(d.items[0]!.id, { good: 1 })] })).rejects.toMatchObject({ statusCode: 409 });
  });

  it("a scanned-back refused parcel the courier later reports with a collection settles it as the return charge", async () => {
    const o = await shipped(1);
    await receive(o.id, { outcome: "FULL_RETURN", lines: [line(o.items[0]!.id, { good: 1 })] });
    await prisma.order.update({ where: { id: o.id }, data: { courierCollectedAmount: 120, courierCollectedAt: new Date() } });
    expect(await settleCourierCollected(o.id)).toBe("SETTLED");
    expect((await getOrderPaymentSummary(o.id)).returnCharge).toBe(120);
  });
});

describe("corrections", () => {
  it("good ↔ damaged and good → never there, by compensating entries; the ledger stays whole", async () => {
    const o = await shipped(4);
    const vid = o.variantIds[0]!;
    const stock = await stockOf(vid);
    const r = await receive(o.id, { outcome: "FULL_RETURN", lines: [line(o.items[0]!.id, { good: 3, damaged: 1 })] });
    expect(await stockOf(vid)).toBe(stock + 3);

    const k = key();
    await correctParcelReceipt(r.receipt.id, { reason: "one good cap was torn", lines: [{ orderItemId: o.items[0]!.id, from: "GOOD", to: "DAMAGED", quantity: 1 }] }, viewer, k);
    expect(await stockOf(vid)).toBe(stock + 2);
    // Replayed: nothing more.
    await correctParcelReceipt(r.receipt.id, { reason: "one good cap was torn", lines: [{ orderItemId: o.items[0]!.id, from: "GOOD", to: "DAMAGED", quantity: 1 }] }, viewer, k);
    expect(await stockOf(vid)).toBe(stock + 2);

    await correctParcelReceipt(r.receipt.id, { reason: "the damaged one was only dusty", lines: [{ orderItemId: o.items[0]!.id, from: "DAMAGED", to: "GOOD", quantity: 1 }] }, viewer);
    expect(await stockOf(vid)).toBe(stock + 3);

    const fixed = await correctParcelReceipt(r.receipt.id, { reason: "counted one too many", lines: [{ orderItemId: o.items[0]!.id, from: "GOOD", to: "UNRESOLVED", quantity: 1 }] }, viewer);
    expect(await stockOf(vid)).toBe(stock + 2);
    expect(fixed.parcel.receive).toMatchObject({ mode: "INSPECT", awaitingUnits: 1 });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).returnInspectedAt).toBeNull();

    await expect(
      correctParcelReceipt(r.receipt.id, { reason: "too many", lines: [{ orderItemId: o.items[0]!.id, from: "GOOD", to: "DAMAGED", quantity: 5 }] }, viewer),
    ).rejects.toMatchObject({ details: { code: "MORE_THAN_RECEIVED" } });
    expect(await prisma.parcelReceipt.count({ where: { correctsReceiptId: r.receipt.id } })).toBe(3);
    await assertInventoryInvariants(vid);
  });
});

describe("HTTP", () => {
  it("resolve, the parcel card and receive — the receive needs an Idempotency-Key", async () => {
    const agent = await asOwner();
    const o = await shipped(1);
    const res = await agent.post("/api/parcel-scans/resolve", { code: `003-0102-001-00${o.courierConsignmentId}`, mode: "RETURN" });
    expect(res.body).toMatchObject({ kind: "ORDER", orderId: o.id });
    const card = (await agent.get(`/api/parcel-scans/parcels/${o.id}`)).body as ParcelView;
    expect(card.receive.mode).toBe("DECIDE_OUTCOME");
    const body = { orderId: o.id, version: card.version, outcome: "FULL_RETURN", lines: [{ orderItemId: o.items[0]!.id, good: 1 }] };
    expect((await agent.post("/api/parcel-scans/receive", body)).status).toBe(400);
    const k = key();
    const first = await agent.post("/api/parcel-scans/receive", body).set("Idempotency-Key", k);
    expect(first.status).toBe(201);
    const again = await agent.post("/api/parcel-scans/receive", body).set("Idempotency-Key", k);
    expect([again.status, again.body.receipt.id]).toEqual([200, first.body.receipt.id]);
  });
});
