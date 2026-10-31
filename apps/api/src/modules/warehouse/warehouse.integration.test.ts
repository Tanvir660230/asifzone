import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { prisma } from "../../config/prisma";
import { asOwner, cleanupFixtures, createStockedProduct, ownerId, placeOrder, stockOf } from "../../test-fixtures";
import { changeOrderStatus } from "../orders/order.service";
import { buildPickList, listPrintRuns, listProductLabelVariants, recordPrintRun } from "./warehouse.service";

// Warehouse Operations §3 — picking and printing. Acceptance: units are grouped by variant across orders and split back
// per order; orders the warehouse mustn't pick are listed as skipped, never dropped; a print is recorded once per
// clientRunId (retries and races included) and knows a reprint; a courier-label reprint needs a reason; print history is
// append-only; nothing here touches stock, status, handover or money.

let owner: string;
let seq = 0;
const runId = () => `wh${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 8)}`;

beforeAll(async () => {
  owner = await ownerId();
});
afterAll(async () => {
  await cleanupFixtures();
  await prisma.$disconnect();
});

async function confirmed(items: Array<{ variantId: string; quantity: number }>) {
  const o = await placeOrder(items);
  await changeOrderStatus(o.id, { status: "CONFIRMED", note: null }, owner);
  return o;
}

describe("pick list", () => {
  it("groups units by variant across orders, splits them back per order, and skips what isn't the warehouse's to pick", async () => {
    const { variants } = await createStockedProduct({ stocks: [40, 40], basePrice: 300 });
    const [a, b] = [variants[0]!.id, variants[1]!.id];
    const o1 = await confirmed([{ variantId: a, quantity: 2 }, { variantId: b, quantity: 1 }]);
    const o2 = await confirmed([{ variantId: a, quantity: 3 }]);
    const pending = await placeOrder([{ variantId: b, quantity: 1 }]);
    const left = await confirmed([{ variantId: a, quantity: 1 }]);
    await prisma.order.update({ where: { id: left.id }, data: { handedOverAt: new Date() } });
    const trashed = await confirmed([{ variantId: a, quantity: 1 }]);
    await prisma.order.update({ where: { id: trashed.id }, data: { deletedAt: new Date() } });
    const stockBefore = [await stockOf(a), await stockOf(b)];
    const statusBefore = await prisma.order.findMany({ where: { id: { in: [o1.id, o2.id] } }, select: { id: true, status: true, updatedAt: true }, orderBy: { id: "asc" } });

    const pick = await buildPickList([o1.id, o2.id, pending.id, left.id, trashed.id, "no-such-order", o1.id]);

    expect(pick.totals).toEqual({ orders: 2, units: 6, products: 2 });
    const lineA = pick.lines.find((l) => l.variantId === a)!;
    expect(lineA.quantity).toBe(5);
    expect(lineA.orders).toEqual([
      { orderId: o1.id, orderNumber: o1.orderNumber, quantity: 2 },
      { orderId: o2.id, orderNumber: o2.orderNumber, quantity: 3 },
    ]);
    expect(lineA.stockOnHand).toBe(stockBefore[0]);
    expect(pick.lines.find((l) => l.variantId === b)!.quantity).toBe(1);
    expect(pick.sheets.map((s) => [s.orderNumber, s.totalUnits])).toEqual([
      [o1.orderNumber, 3],
      [o2.orderNumber, 3],
    ]);
    expect(Object.fromEntries(pick.skipped.map((s) => [s.orderId, s.reason]))).toEqual({
      [pending.id]: "NOT_CONFIRMED",
      [left.id]: "ALREADY_LEFT",
      [trashed.id]: "IN_TRASH",
      "no-such-order": "NOT_FOUND",
    });
    // Reading a pick list changes nothing.
    expect([await stockOf(a), await stockOf(b)]).toEqual(stockBefore);
    expect(await prisma.order.findMany({ where: { id: { in: [o1.id, o2.id] } }, select: { id: true, status: true, updatedAt: true }, orderBy: { id: "asc" } })).toEqual(statusBefore);
  });

  it("sorts sizes the way the shelf is laid out, not alphabetically", async () => {
    const { variants } = await createStockedProduct({ stocks: [10, 10, 10], basePrice: 300 });
    const sizes = ["XL", "S", "M"];
    for (const [i, v] of variants.entries()) await prisma.productVariant.update({ where: { id: v.id }, data: { size: sizes[i]!, color: `Sort${i}` } });
    const o = await confirmed(variants.map((v) => ({ variantId: v.id, quantity: 1 })));
    const pick = await buildPickList([o.id]);
    expect(pick.lines.map((l) => l.size)).toEqual(["S", "M", "XL"]);
  });
});

describe("print log", () => {
  it("records a first print, knows a reprint per order, and needs a reason to reprint courier labels", async () => {
    const { variants } = await createStockedProduct({ stocks: [20], basePrice: 300 });
    const o1 = await confirmed([{ variantId: variants[0]!.id, quantity: 2 }]);
    const o2 = await confirmed([{ variantId: variants[0]!.id, quantity: 1 }]);

    const first = await recordPrintRun(owner, { kind: "PACKING_SHEET", clientRunId: runId(), orderIds: [o1.id], variants: [], copies: 1 });
    expect(first.created).toBe(true);
    expect(first.run).toMatchObject({ reprint: false, orderCount: 1, unitCount: 2 });

    const second = await recordPrintRun(owner, { kind: "PACKING_SHEET", clientRunId: runId(), orderIds: [o1.id, o2.id], variants: [], copies: 1 });
    expect(second.run.reprint).toBe(true);
    expect(Object.fromEntries(second.run.items.map((i) => [i.orderId, i.reprint]))).toEqual({ [o1.id]: true, [o2.id]: false });

    // Another kind is its own history: the first courier label for o1 is not a reprint.
    await recordPrintRun(owner, { kind: "COURIER_LABEL", clientRunId: runId(), orderIds: [o1.id], variants: [], copies: 1 });
    await expect(recordPrintRun(owner, { kind: "COURIER_LABEL", clientRunId: runId(), orderIds: [o1.id], variants: [], copies: 1 })).rejects.toThrow(/say why/);
    const withReason = await recordPrintRun(owner, { kind: "COURIER_LABEL", clientRunId: runId(), orderIds: [o1.id], variants: [], copies: 1, reason: "Label tore" });
    expect(withReason.run).toMatchObject({ reprint: true, reason: "Label tore" });

    const pick = await buildPickList([o1.id]);
    expect(pick.sheets[0]!.printed.counts).toEqual({ PACKING_SHEET: 2, COURIER_LABEL: 2 });
    expect((await listPrintRuns({ orderId: o1.id, limit: 10 })).map((r) => r.kind)).toEqual(["COURIER_LABEL", "COURIER_LABEL", "PACKING_SHEET", "PACKING_SHEET"]);
  });

  it("is one run per clientRunId — a retry and a race both get the run already recorded", async () => {
    const { variants } = await createStockedProduct({ stocks: [20], basePrice: 300 });
    const o = await confirmed([{ variantId: variants[0]!.id, quantity: 1 }]);
    const id = runId();
    const input = { kind: "PICK_LIST" as const, clientRunId: id, orderIds: [o.id], variants: [], copies: 1 };
    const raced = await Promise.all([recordPrintRun(owner, input), recordPrintRun(owner, input), recordPrintRun(owner, input)]);
    expect(new Set(raced.map((r) => r.run.id)).size).toBe(1);
    expect(raced.filter((r) => r.created)).toHaveLength(1);
    const retry = await recordPrintRun(owner, input);
    expect(retry).toMatchObject({ created: false, run: { id: raced[0]!.run.id } });
    expect(await prisma.printRun.count({ where: { clientRunId: id } })).toBe(1);
  });

  it("is append-only and never changes the order, its stock or its money", async () => {
    const { variants } = await createStockedProduct({ stocks: [20], basePrice: 300 });
    const o = await confirmed([{ variantId: variants[0]!.id, quantity: 1 }]);
    const before = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    const stock = await stockOf(variants[0]!.id);
    const { run } = await recordPrintRun(owner, { kind: "MANIFEST", clientRunId: runId(), orderIds: [o.id], variants: [], copies: 1 });

    await expect(prisma.printRun.update({ where: { id: run.id }, data: { reason: "edited" } })).rejects.toThrow(/append-only/);
    await expect(prisma.printRunItem.deleteMany({ where: { printRunId: run.id } })).rejects.toThrow(/append-only/);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).toEqual(before);
    expect(await stockOf(variants[0]!.id)).toBe(stock);
  });

  it("refuses ids from nowhere and product labels without products", async () => {
    await expect(recordPrintRun(owner, { kind: "PICK_LIST", clientRunId: runId(), orderIds: ["nope"], variants: [], copies: 1 })).rejects.toThrow(/don't exist/);
    const api = await asOwner();
    const res = await api.post("/api/warehouse/print-runs", { kind: "PRODUCT_LABEL", clientRunId: runId(), orderIds: ["x"] });
    expect(res.status).toBe(400);
  });
});

describe("product labels", () => {
  it("reads the variant's own barcode, else its SKU, and records labels per variant", async () => {
    const { variants } = await createStockedProduct({ stocks: [5, 5], basePrice: 450 });
    await prisma.productVariant.update({ where: { id: variants[0]!.id }, data: { barcode: `BC${Date.now()}` } });
    const rows = await listProductLabelVariants({ variantIds: variants.map((v) => v.id), limit: 10 });
    const own = rows.find((r) => r.variantId === variants[0]!.id)!;
    const sku = rows.find((r) => r.variantId === variants[1]!.id)!;
    expect(own.code).toBe(own.barcode);
    expect(sku.code).toBe(sku.sku);
    const { run } = await recordPrintRun(owner, { kind: "PRODUCT_LABEL", clientRunId: runId(), orderIds: [], variants: [{ variantId: own.variantId, quantity: 12 }], copies: 1 });
    expect(run).toMatchObject({ unitCount: 12, orderCount: 0, reprint: false });
  });
});

describe("routes", () => {
  it("serves the pick list and the print log over HTTP", async () => {
    const { variants } = await createStockedProduct({ stocks: [5], basePrice: 450 });
    const o = await confirmed([{ variantId: variants[0]!.id, quantity: 1 }]);
    const api = await asOwner();
    const pick = await api.post("/api/warehouse/pick-list", { orderIds: [o.id] });
    expect(pick.status).toBe(200);
    expect(pick.body.totals.units).toBe(1);
    const id = runId();
    const created = await api.post("/api/warehouse/print-runs", { kind: "PICK_LIST", clientRunId: id, orderIds: [o.id] });
    expect(created.status).toBe(201);
    const replay = await api.post("/api/warehouse/print-runs", { kind: "PICK_LIST", clientRunId: id, orderIds: [o.id] });
    expect(replay.status).toBe(200);
    expect(replay.body.run.id).toBe(created.body.run.id);
  });
});

describe("printing two kinds at once", () => {
  it("“Print both” — a pick list and packing sheets for the same orders sent together — records both", async () => {
    const { variants } = await createStockedProduct({ stocks: [30], basePrice: 300 });
    const orders = await Promise.all(Array.from({ length: 6 }, () => confirmed([{ variantId: variants[0]!.id, quantity: 1 }])));
    const ids = orders.map((o) => o.id);
    const [pick, sheets] = await Promise.all([
      recordPrintRun(owner, { kind: "PICK_LIST", clientRunId: runId(), orderIds: ids, variants: [], copies: 1 }),
      recordPrintRun(owner, { kind: "PACKING_SHEET", clientRunId: runId(), orderIds: ids, variants: [], copies: 1 }),
    ]);
    expect([pick.created, sheets.created]).toEqual([true, true]);
    expect((await buildPickList([ids[0]!])).sheets[0]!.printed.counts).toEqual({ PICK_LIST: 1, PACKING_SHEET: 1 });
  });
});
