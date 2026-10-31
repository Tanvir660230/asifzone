import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { ORDER_QUEUE_FILTERS, scanCodeCandidates, scannedPhone } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { asOwner, cleanupFixtures, createStockedProduct, ownerId, placeOrder, stockOf } from "../../test-fixtures";
import { changeOrderStatus, listOrders, receiveReturnedParcel } from "../orders/order.service";
import { cancelBatch, confirmBatch, createBatch, handOverFromList, recordScan, resolveScanCode, voidScan } from "./parcel-scan.service";

// Order Operations plan, phase 4 — dispatch and return scanning. Acceptance: duplicate / already-processed / unknown /
// ineligible each get their own answer and change nothing; one parcel on two devices is accepted once; the same
// clientScanId is one row; confirming is all-or-nothing; a scan never touches stock, money or the order's status;
// stock comes back only through inspection.

let owner: string;
let seq = 0;
const scanId = () => `t${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 8)}`;

beforeAll(async () => {
  owner = await ownerId();
});
afterAll(async () => {
  await prisma.parcelScanEvent.deleteMany({ where: { adminId: owner, code: { startsWith: "PST" } } });
  await cleanupFixtures();
  await prisma.$disconnect();
});

/** A booked, shipped order (as booking leaves it since D-AA3), with our label barcode and a consignment id. */
async function bookedOrder(stock = 5) {
  const { variants } = await createStockedProduct({ stocks: [stock], basePrice: 500 });
  const order = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
  const tag = `${Date.now().toString(36)}${(seq++).toString(36)}`.toUpperCase();
  await changeOrderStatus(order.id, { status: "CONFIRMED", note: null }, owner);
  const updated = await prisma.order.update({
    where: { id: order.id },
    data: { trackingNumber: `PST${tag}`, courierConsignmentId: `9${Date.now()}${seq}`, courierBookedAt: new Date() },
  });
  await changeOrderStatus(order.id, { status: "PACKED", note: null }, owner);
  await changeOrderStatus(order.id, { status: "SHIPPED", note: null }, owner);
  return { ...updated, variantId: variants[0]!.id };
}
const scan = (batchId: string, code: string, clientScanId = scanId()) => recordScan(batchId, owner, { code, clientScanId });

describe("resolving codes", () => {
  it("knows our label barcode, the consignment id, the order number and a URL carrying one; nothing else", async () => {
    const o = await bookedOrder();
    expect((await resolveScanCode(o.trackingNumber!))?.id).toBe(o.id);
    expect((await resolveScanCode(` ${o.courierConsignmentId}\r\n`))?.id).toBe(o.id);
    expect((await resolveScanCode(o.orderNumber.toLowerCase()))?.id).toBe(o.id);
    expect((await resolveScanCode(`https://shop.example/track?code=${o.trackingNumber}&x=1`))?.id).toBe(o.id);
    expect(await resolveScanCode("SFX-UNKNOWN-STICKER-0001")).toBeNull();
    expect(scanCodeCandidates("https://x.example/t/AZT123?o=ORD-1#top")).toEqual(["https://x.example/t/AZT123?o=ORD-1#top", "ORD-1", "AZT123"]);
  });

  it("knows Steadfast's return-slip and label barcodes, which end in the zero-padded consignment id", async () => {
    const o = await bookedOrder();
    expect((await resolveScanCode(`003-0102-001-00${o.courierConsignmentId}`))?.id).toBe(o.id);
    expect(scanCodeCandidates("003-0102-001-00313808106")).toEqual(["003-0102-001-00313808106", "313808106"]);
    expect(scanCodeCandidates("002-0356-001-00311971298")).toEqual(["002-0356-001-00311971298", "311971298"]);
    expect(scanCodeCandidates("ORD-20261027-QQGXH3")).toEqual(["ORD-20261027-QQGXH3"]);
    expect([scannedPhone("01911133943"), scannedPhone("+8801911133943"), scannedPhone("0191113394"), scannedPhone("SFR261028")]).toEqual(["01911133943", "01911133943", null, null]);
  });
});

describe("dispatch scanning", () => {
  it("accepts once, answers duplicates and replays, and the handover changes no stock, money or status", async () => {
    const o = await bookedOrder();
    const before = { stock: await stockOf(o.variantId), order: await prisma.order.findUniqueOrThrow({ where: { id: o.id } }) };
    const batch = await createBatch(owner, "DISPATCH");

    const id = scanId();
    const first = await scan(batch.id, o.trackingNumber!, id);
    expect(first).toMatchObject({ result: "ACCEPTED", orderId: o.id });
    expect((await scan(batch.id, o.courierConsignmentId!)).result).toBe("DUPLICATE");
    const replay = await scan(batch.id, o.trackingNumber!, id);
    expect(replay.id).toBe(first.id);
    expect(await prisma.parcelScanEvent.count({ where: { clientScanId: id } })).toBe(1);
    expect((await scan(batch.id, "NOPE-12345")).result).toBe("INVALID");

    const done = await confirmBatch(batch.id, owner);
    expect(done).toMatchObject({ status: "CONFIRMED", accepted: 1 });
    const after = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(after.handedOverAt).not.toBeNull();
    expect(after.handedOverByAdminId).toBe(owner);
    expect(after.status).toBe(before.order.status);
    expect(after.paymentStatus).toBe(before.order.paymentStatus);
    expect(await stockOf(o.variantId)).toBe(before.stock);
    // Confirming again is a no-op; a later scan of the same parcel says it was already handed over.
    expect((await confirmBatch(batch.id, owner)).status).toBe("CONFIRMED");
    const later = await createBatch(owner, "DISPATCH");
    expect(await scan(later.id, o.trackingNumber!)).toMatchObject({ result: "ALREADY_PROCESSED" });
    await cancelBatch(later.id);
  });

  it("refuses unbooked, unconfirmed, cancelled and trashed orders without changing them", async () => {
    const { variants } = await createStockedProduct({ stocks: [5], basePrice: 500 });
    const pending = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
    const cancelled = await bookedOrder();
    await prisma.order.update({ where: { id: cancelled.id }, data: { status: "CANCELLED" } });
    const trashed = await bookedOrder();
    await prisma.order.update({ where: { id: trashed.id }, data: { deletedAt: new Date() } });
    const batch = await createBatch(owner, "DISPATCH");
    expect((await scan(batch.id, pending.orderNumber)).result).toBe("INELIGIBLE");
    expect((await scan(batch.id, cancelled.trackingNumber!)).result).toBe("INELIGIBLE");
    expect((await scan(batch.id, trashed.trackingNumber!)).result).toBe("INELIGIBLE");
    await expect(confirmBatch(batch.id, owner)).rejects.toMatchObject({ statusCode: 400 });
    await cancelBatch(batch.id);
  });

  it("the same parcel scanned on two devices at once is accepted exactly once", async () => {
    const o = await bookedOrder();
    const [a, b] = await Promise.all([createBatch(owner, "DISPATCH"), createBatch(owner, "DISPATCH")]);
    const results = await Promise.all([scan(a.id, o.trackingNumber!), scan(b.id, o.trackingNumber!)]);
    expect(results.filter((r) => r.result === "ACCEPTED")).toHaveLength(1);
    await cancelBatch(a.id);
    await cancelBatch(b.id);
  });

  it("confirming is all-or-nothing: a parcel cancelled since its scan stops the batch and nothing is written", async () => {
    const ok = await bookedOrder();
    const changed = await bookedOrder();
    const batch = await createBatch(owner, "DISPATCH");
    await scan(batch.id, ok.trackingNumber!);
    const bad = await scan(batch.id, changed.trackingNumber!);
    await prisma.order.update({ where: { id: changed.id }, data: { status: "CANCELLED" } });
    await expect(confirmBatch(batch.id, owner)).rejects.toMatchObject({ statusCode: 409 });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: ok.id } })).handedOverAt).toBeNull();
    // Remove the stale scan, confirm the rest.
    await voidScan(batch.id, bad.id);
    expect((await confirmBatch(batch.id, owner)).accepted).toBe(1);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: ok.id } })).handedOverAt).not.toBeNull();
  });

  it("with shippedSmsTrigger = HANDOVER the shipped SMS waits for the handover scan and goes once", async () => {
    const { variants } = await createStockedProduct({ stocks: [5], basePrice: 500 });
    const order = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
    await changeOrderStatus(order.id, { status: "PACKED", note: null }, owner);
    await prisma.order.update({ where: { id: order.id }, data: { trackingNumber: `PSTSMS${seq++}${Date.now()}`, courierConsignmentId: `8${Date.now()}`, courierBookedAt: new Date() } });
    await changeOrderStatus(order.id, { status: "SHIPPED", note: null }, owner, { deferShippedSms: true });
    const shippedSms = () => prisma.outboxEvent.count({ where: { aggregateId: order.id, consumer: "customer-order-sms", payload: { path: ["touchpoint"], equals: "SHIPPED" } } });
    expect(await shippedSms()).toBe(0);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).shippedSmsDeferred).toBe(true);

    const batch = await createBatch(owner, "DISPATCH");
    await scan(batch.id, order.orderNumber);
    await confirmBatch(batch.id, owner);
    expect(await shippedSms()).toBe(1);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).shippedSmsDeferred).toBe(false);
  });
});

describe("return scanning", () => {
  it("a return scan records the receipt only; stock comes back at inspection, once", async () => {
    const o = await bookedOrder();
    await changeOrderStatus(o.id, { status: "CANCELLED", note: "Customer refused the parcel" }, owner);
    const stockAfterCancel = await stockOf(o.variantId);
    const inQueue = async (q: "comingBack" | "inspectionPending" | "scanDiscrepancy") =>
      (await listOrders({ ...ORDER_QUEUE_FILTERS[q], search: o.orderNumber, page: 1, pageSize: 25 } as never)).items.some((x) => x.id === o.id);
    expect(await inQueue("comingBack")).toBe(true);

    const batch = await createBatch(owner, "RETURN");
    expect(await scan(batch.id, o.trackingNumber!)).toMatchObject({ result: "ACCEPTED", discrepancy: false });
    await confirmBatch(batch.id, owner);
    const received = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(received.receivedBackAt).not.toBeNull();
    expect(received.status).toBe("CANCELLED");
    expect(await stockOf(o.variantId)).toBe(stockAfterCancel); // still not sellable
    expect(await inQueue("comingBack")).toBe(false);
    expect(await inQueue("inspectionPending")).toBe(true);

    // Inspection (returns.manage) is the restock, exactly once.
    await receiveReturnedParcel(o.id, owner, {});
    expect(await stockOf(o.variantId)).toBe(stockAfterCancel + 1);
    expect(await inQueue("inspectionPending")).toBe(false);
    await expect(receiveReturnedParcel(o.id, owner, {})).rejects.toMatchObject({ statusCode: 409 });
    expect(await stockOf(o.variantId)).toBe(stockAfterCancel + 1);
  });

  it("a parcel back that nothing says should be is accepted, flagged and held as a discrepancy — stock unchanged", async () => {
    const o = await bookedOrder();
    const stock = await stockOf(o.variantId);
    const batch = await createBatch(owner, "RETURN");
    expect(await scan(batch.id, o.trackingNumber!)).toMatchObject({ result: "ACCEPTED", discrepancy: true });
    await confirmBatch(batch.id, owner);
    const list = await listOrders({ ...ORDER_QUEUE_FILTERS.scanDiscrepancy, search: o.orderNumber, page: 1, pageSize: 25 } as never);
    expect(list.items.map((x) => x.id)).toContain(o.id);
    expect(await stockOf(o.variantId)).toBe(stock);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("SHIPPED");
  });
});

describe("HTTP", () => {
  it("serves the scanning flow under parcels.scan", async () => {
    const agent = await asOwner();
    const o = await bookedOrder();
    const created = await agent.post("/api/parcel-scans/batches", { kind: "DISPATCH" });
    expect(created.status).toBe(201);
    expect((await agent.get("/api/parcel-scans/batches/current?kind=DISPATCH")).body.batch.id).toBe(created.body.id);
    const s = await agent.post(`/api/parcel-scans/batches/${created.body.id}/scans`, { code: o.trackingNumber, clientScanId: scanId() });
    expect(s.status).toBe(201);
    expect((await agent.post(`/api/parcel-scans/batches/${created.body.id}/scans`, { code: "x", clientScanId: "bad id!" })).status).toBe(400);
    expect((await agent.post(`/api/parcel-scans/batches/${created.body.id}/confirm`)).body.status).toBe("CONFIRMED");
    expect((await agent.get("/api/parcel-scans/summary")).body.handedOverToday).toBeGreaterThanOrEqual(1);
  });
});

describe("the rider took these — from the list, no scanner", () => {
  it("twenty booked, twelve picked: twelve handed over through one dispatch batch, the rest untouched; a repeat and an unbooked order change nothing", async () => {
    const booked = await Promise.all(Array.from({ length: 20 }, () => bookedOrder()));
    const taken = booked.slice(0, 12);
    const unbooked = await placeOrder([{ variantId: taken[0]!.variantId, quantity: 1 }]);
    const stock = await stockOf(taken[0]!.variantId);

    const r = await handOverFromList(owner, [...taken.map((o) => o.id), unbooked.id], "Rider Karim, evening pickup");
    expect(r.handedOver).toBe(12);
    expect(r.skipped.map((s) => s.orderNumber)).toEqual([unbooked.orderNumber]);
    const after = await prisma.order.findMany({ where: { id: { in: booked.map((o) => o.id) } }, select: { id: true, handedOverAt: true, handedOverBatchId: true, status: true } });
    expect(after.filter((o) => o.handedOverAt).map((o) => o.id).sort()).toEqual(taken.map((o) => o.id).sort());
    expect(new Set(after.filter((o) => o.handedOverAt).map((o) => o.handedOverBatchId))).toEqual(new Set([r.batchId]));
    expect(after.every((o) => o.status === "SHIPPED")).toBe(true);
    expect(await stockOf(taken[0]!.variantId)).toBe(stock);
    const batch = await prisma.parcelScanBatch.findUniqueOrThrow({ where: { id: r.batchId! } });
    expect(batch).toMatchObject({ status: "CONFIRMED", kind: "DISPATCH" });
    expect(batch.note).toMatch(/not scanned.*Rider Karim/);

    // Pressed again: everything is already handed over — nothing new, no empty batch left open.
    const again = await handOverFromList(owner, taken.map((o) => o.id));
    expect(again).toMatchObject({ handedOver: 0, batchId: null });
    expect(again.skipped).toHaveLength(12);
    expect(await prisma.parcelScanBatch.count({ where: { createdByAdminId: owner, status: "OPEN", note: { contains: "not scanned" } } })).toBe(0);
  });
});
