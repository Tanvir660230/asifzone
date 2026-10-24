import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { PERMISSIONS } from "@clothing-brand/shared";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { signAccessToken } from "../../lib/jwt";
import { assertInventoryInvariants, cleanupFixtures, createStockedProduct, ownerId, placeOrder, purgeFinanceTables, RUN, stockOf } from "../../test-fixtures";
import type { FinanceActor } from "../finance/finance-audit";
import { getFinanceContext } from "../finance/finance-context";
import { ensureCommerceAccounting } from "../finance/commerce-setup.service";
import { ensurePurchasingAccounting } from "../finance/purchasing-setup.service";
import { updateBusinessSettings } from "../finance/chart.service";
import { postOpeningBalances, saveOpeningInventory } from "../finance/opening-balances.service";
import { approveCutover, draftCutover, postCutover } from "../finance/inventory-cutover.service";
import { approvePurchaseOrder, createPurchaseOrder, submitPurchaseOrder } from "../finance/purchase-orders.service";
import { createGoodsReceipt, postGoodsReceipt } from "../finance/goods-receipts.service";
import { createSupplier } from "../finance/suppliers.service";
import { processFinancialEvent } from "../finance/events.service";
import { runReconciliation } from "../finance/reconciliation.service";
import { ensureManufacturingSetup } from "../manufacturing/manufacturing-setup.service";
import { createMaterial } from "../manufacturing/materials.service";
import { approveBom, createBom } from "../manufacturing/boms.service";
import { quickRefill } from "../manufacturing/quick-refill.service";
import { receiveReturnedParcel, updateOrderStatus } from "../../modules/orders/order.service";
import { recordFill } from "./fill.service";
import { orderFillStatus, waitingLines } from "./fill-status.service";
import { setStockPolicy, stockHub } from "./stock-hub.service";
import { stockTrace } from "./trace.service";

// Inventory recovery phase 3 (2026-10-24): Stock › Filled as one guarded entry — the real recipe per bottle size, checked
// before anything is written, a double tap or a retry never takes the oil or the bottles twice, waste is recorded with
// its reason and costed into the bottles — plus which waiting orders' bottles are filled, the item trace, and caps kept
// size by size and colour by colour. Expected values are literals worked out by hand.

// The close step can be made to fail once, to prove a retry resumes instead of starting again.
const failClose = vi.hoisted(() => ({ once: false }));
vi.mock("../manufacturing/production-close.service", async (actual) => {
  const real = await actual<typeof import("../manufacturing/production-close.service")>();
  return {
    ...real,
    closeProductionOrder: async (...args: Parameters<typeof real.closeProductionOrder>) => {
      if (failClose.once) {
        failClose.once = false;
        throw Object.assign(new Error("simulated crash before the close"), { statusCode: 500 });
      }
      return real.closeProductionOrder(...args);
    },
  };
});

const CSRF = "vitest-csrf";
let OWNER: FinanceActor;
let admin = "";
let supplierId = "";
let oil = "";
let dryOil = "";
let btl6 = "";
let btl12 = "";
let box = "";
let attar: { id: string; v6: string; v12: string };
let dry: { id: string; v6: string };
let made: { id: string; v6: string };
let caps: { id: string; variants: string[] };

const as = (r: request.Test) => r.set("Cookie", [`access_token=${signAccessToken({ adminId: admin, role: "OWNER" })}`, `csrf_token=${CSRF}`]).set("X-CSRF-Token", CSRF);
const fill = (body: object, key: string) => as(request(app).post("/api/v1/finance/stock/fills")).set("Idempotency-Key", key).send(body);
const stocks = (ids: string[]) => Promise.all(ids.map(stockOf));
const moCount = () => prisma.productionOrder.count();
const entries = () => prisma.stockHubEntry.count({ where: { kind: "FILL" } });
let k = 0;
const key = (name: string) => `fill-${name}-${RUN}-${++k}`;

async function buy(variantId: string, qty: number, unitPrice: number) {
  const po = await createPurchaseOrder({ supplierId, lines: [{ lineType: "STOCK", variantId, qtyOrdered: qty, unitPrice }] } as never, OWNER);
  await submitPurchaseOrder(po.id, OWNER);
  const approved = await approvePurchaseOrder(po.id, OWNER);
  const grn = await createGoodsReceipt({ purchaseOrderId: po.id, lines: [{ purchaseOrderLineId: approved.lines[0]!.id, qtyAccepted: qty }] } as never, OWNER);
  await postGoodsReceipt(grn.id, {}, OWNER);
}
const material = async (name: string, unit: string) =>
  (await createMaterial({ name: `Vitest ${name} ${RUN}`, stockUnit: unit, variants: [{ sku: `FIL-${name.replace(/\W/g, "")}-${RUN}`, spec: name }] }, OWNER, { canSeeCost: true })).variants[0]!.id;

/** An attar with a 6 ml and a 12 ml size, each with its own recipe lines: oil per ml + its own bottle + a box. */
async function attarWith(oilId: string, sizes: 1 | 2) {
  const p = await createStockedProduct({ stocks: sizes === 2 ? [0, 0] : [0], basePrice: 350 });
  await prisma.product.update({ where: { id: p.product.id }, data: { fillToOrder: true } });
  const [v6, v12] = p.variants.map((v) => v.id);
  await prisma.productVariant.update({ where: { id: v6! }, data: { size: "6ml" } });
  if (v12) await prisma.productVariant.update({ where: { id: v12 }, data: { size: "12ml" } });
  const lines = [
    { materialVariantId: oilId, finishedVariantId: v6, qtyPerUnit: "6", wastagePct: "0" },
    { materialVariantId: btl6, finishedVariantId: v6, qtyPerUnit: "1", wastagePct: "0" },
    { materialVariantId: box, finishedVariantId: v6, qtyPerUnit: "1", wastagePct: "0" },
    ...(v12 ? [
      { materialVariantId: oilId, finishedVariantId: v12, qtyPerUnit: "12", wastagePct: "0" },
      { materialVariantId: btl12, finishedVariantId: v12, qtyPerUnit: "1", wastagePct: "0" },
      { materialVariantId: box, finishedVariantId: v12, qtyPerUnit: "1", wastagePct: "0" },
    ] : []),
  ];
  const bom = await createBom({ productId: p.product.id, lines } as never, OWNER);
  await approveBom(bom.id, OWNER);
  return { id: p.product.id, v6: v6!, v12: v12! };
}
async function postPending() {
  for (let round = 0; round < 10; round++) {
    const waiting = await prisma.financialEvent.findMany({ where: { status: { in: ["RECEIVED", "FAILED"] } }, select: { id: true } });
    if (!waiting.length) return;
    for (const e of waiting) await processFinancialEvent(e.id);
  }
}
async function booksMatch() {
  await postPending();
  const r = await runReconciliation({ checks: ["inventory.valuation_vs_ledger", "inventory.quantity_vs_valuation", "inventory.valuation_postings", "ledger.integrity"] }, OWNER);
  return Object.fromEntries(r.results.map((x) => [x.checkKey, x.status]));
}
const MATCHED = { "inventory.valuation_vs_ledger": "MATCHED", "inventory.quantity_vs_valuation": "MATCHED", "inventory.valuation_postings": "MATCHED", "ledger.integrity": "MATCHED" };

beforeAll(async () => {
  await purgeFinanceTables();
  admin = await ownerId();
  OWNER = { type: "ADMIN", adminId: admin, label: "owner@test", permissions: [...PERMISSIONS] };
  const ctx = await getFinanceContext();
  await ensureCommerceAccounting(OWNER);
  await ensurePurchasingAccounting(OWNER);
  await ensureManufacturingSetup(OWNER);
  await updateBusinessSettings({ openingDate: "2026-09-01", reason: "books start" }, OWNER);
  // caps: one design, two colours × two sizes, 5 each at ৳100
  const c = await createStockedProduct({ stocks: [5, 5, 5, 5], basePrice: 900 });
  caps = { id: c.product.id, variants: c.variants.map((v) => v.id) };
  await prisma.productVariant.update({ where: { id: caps.variants[2]! }, data: { size: "M", color: "White" } });
  await prisma.productVariant.update({ where: { id: caps.variants[3]! }, data: { size: "L", color: "White" } });
  await saveOpeningInventory(
    caps.variants.map((variantId, i) => ({ variantId, sku: `FIL-CAP-${i}`, name: "cap", quantity: 5, unitCost: 100, valuationStatus: "KNOWN", valuationMethod: "SUPPLIER_INVOICE", valuationSource: "INV", valuationDate: "2026-09-01", brandId: ctx.brand.id })) as never,
    OWNER,
  );
  await postOpeningBalances(OWNER);
  await draftCutover({}, OWNER);
  await approveCutover({ acknowledgeMissing: true }, OWNER);
  await postCutover(OWNER);
  supplierId = (await createSupplier({ legalName: "Vitest Fill Attar House" } as never, OWNER)).id;
  oil = await material("Fill oil", "ml");
  dryOil = await material("Fill dry oil", "ml");
  btl6 = await material("Fill bottle 6ml", "pcs");
  btl12 = await material("Fill bottle 12ml", "pcs");
  box = await material("Fill box", "pcs");
  await buy(oil, 1000, 5); // ৳5 a ml
  await buy(dryOil, 10, 5); // enough for one 6 ml bottle
  await buy(btl6, 50, 10);
  await buy(btl12, 50, 15);
  await buy(box, 200, 3);
  attar = await attarWith(oil, 2);
  dry = await attarWith(dryOil, 1);
  made = await attarWith(oil, 1);
});

afterAll(async () => {
  await purgeFinanceTables();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL finance.maintenance_purge = 'on'`);
    await tx.$executeRawUnsafe(`UPDATE "OrderItem" SET "costMovementId" = NULL WHERE "costMovementId" IS NOT NULL`);
    await tx.$executeRawUnsafe(`DELETE FROM "StockMovement" WHERE "variantId" IN (SELECT v.id FROM "ProductVariant" v JOIN "Product" p ON p.id = v."productId" WHERE p.kind = 'MATERIAL' AND p.name LIKE 'Vitest %')`);
    await tx.$executeRawUnsafe(`DELETE FROM "ProductVariant" WHERE "productId" IN (SELECT id FROM "Product" WHERE kind = 'MATERIAL' AND name LIKE 'Vitest %')`);
    await tx.$executeRawUnsafe(`DELETE FROM "Product" WHERE kind = 'MATERIAL' AND name LIKE 'Vitest %'`);
  });
  await cleanupFixtures();
});

describe("filling by the configured recipe", () => {
  it("FL-1: 5 × 6 ml take 30 ml oil, 5 small bottles, 5 boxes — the 12 ml bottles untouched; each bottle costs ৳43 (6×5 + 10 + 3)", async () => {
    const r = await fill({ variantId: attar.v6, quantity: 5 }, key("6ml"));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(await stocks([oil, btl6, btl12, box, attar.v6])).toEqual([970, 45, 50, 195, 5]);
    expect(r.body.fill).toMatchObject({ complete: true, quantity: 5, cost: 215, perBottle: 43, wasteReason: null });
    expect(r.body.fill.by).toBeTruthy();
    expect(r.body.fill.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.body.fill.materials).toEqual(expect.arrayContaining([expect.objectContaining({ used: 30, wasted: 0, value: 150 }), expect.objectContaining({ used: 5, value: 50 }), expect.objectContaining({ used: 5, value: 15 })]));
    expect(await prisma.inventoryCostState.findUniqueOrThrow({ where: { variantId: attar.v6 } })).toMatchObject({ valuedQty: 5 });
    expect(Number((await prisma.inventoryCostState.findUniqueOrThrow({ where: { variantId: attar.v6 } })).value)).toBe(215);
  });

  it("FL-2: 3 × 12 ml take 36 ml, 3 large bottles, 3 boxes; ৳78 a bottle (12×5 + 15 + 3)", async () => {
    const r = await fill({ variantId: attar.v12, quantity: 3 }, key("12ml"));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(await stocks([oil, btl6, btl12, box, attar.v12])).toEqual([934, 45, 47, 192, 3]);
    expect(r.body.fill).toMatchObject({ quantity: 3, cost: 234, perBottle: 78 });
  });

  it("FL-3: not enough oil — refused before anything is written, naming the oil", async () => {
    const [mos, ents, before] = [await moCount(), await entries(), await stocks([dryOil, btl6, box, dry.v6])];
    const r = await fill({ variantId: dry.v6, quantity: 2 }, key("dry"));
    expect(r.status).toBe(409);
    expect(r.body.details?.code).toBe("FILL_SHORT");
    expect(r.body.details.short).toEqual([expect.objectContaining({ needed: 12, inStock: 10, unit: "ml" })]);
    expect([await moCount(), await entries(), await stocks([dryOil, btl6, box, dry.v6])]).toEqual([mos, ents, before]);
  });

  it("FL-4: not enough empty bottles — refused, only the bottle named (the oil would do)", async () => {
    const [mos, before] = [await moCount(), await stocks([oil, btl12, box, attar.v12])];
    const r = await fill({ variantId: attar.v12, quantity: 48 }, key("btl"));
    expect(r.status).toBe(409);
    expect(r.body.details.short).toEqual([expect.objectContaining({ needed: 48, inStock: 47, unit: "pcs" })]);
    expect([await moCount(), await stocks([oil, btl12, box, attar.v12])]).toEqual([mos, before]);
  });

  it("FL-5: a size with no approved recipe is unconfigured — refused, nothing written, nothing invented", async () => {
    const p = await createStockedProduct({ stocks: [0], basePrice: 350 });
    await prisma.product.update({ where: { id: p.product.id }, data: { fillToOrder: true } });
    const [mos, ents] = [await moCount(), await entries()];
    const r = await fill({ variantId: p.variants[0]!.id, quantity: 1 }, key("norecipe"));
    expect(r.status).toBe(409);
    expect(r.body.details?.code).toBe("NO_RECIPE");
    expect([await moCount(), await entries()]).toEqual([mos, ents]);
    const t = await stockTrace(p.variants[0]!.id, { canSeeCost: true });
    expect(t).toMatchObject({ recipe: null, recipeMissing: true, makeable: 0 });
  });
});

describe("a fill is recorded once", () => {
  it("FL-6: the same request sent again replays — no second order, no oil or bottle taken again", async () => {
    const k1 = key("replay");
    expect((await fill({ variantId: attar.v6, quantity: 2 }, k1)).status).toBe(201);
    const [mos, after] = [await moCount(), await stocks([oil, btl6, box, attar.v6])];
    const again = await fill({ variantId: attar.v6, quantity: 2 }, k1);
    expect(again.status).toBe(200);
    expect(again.body.replayed).toBe(true);
    expect([await moCount(), await stocks([oil, btl6, box, attar.v6])]).toEqual([mos, after]);
  });

  it("FL-7: a double tap (two at once, one key) takes the materials once", async () => {
    const k2 = key("double");
    const [mos, before] = [await moCount(), await stocks([oil, btl6, box, attar.v6])];
    const both = await Promise.allSettled([recordFill({ variantId: attar.v6, quantity: 1 }, OWNER, k2), recordFill({ variantId: attar.v6, quantity: 1 }, OWNER, k2)]);
    const ok = both.filter((b) => b.status === "fulfilled");
    expect(ok.length).toBeGreaterThanOrEqual(1);
    for (const b of both) if (b.status === "rejected") expect((b.reason as { details?: { code?: string } }).details?.code).toBe("STOCK_ENTRY_IN_PROGRESS");
    expect(await moCount()).toBe(mos + 1);
    expect(await stocks([oil, btl6, box, attar.v6])).toEqual([before[0]! - 6, before[1]! - 1, before[2]! - 1, before[3]! + 1]);
  });

  it("FL-8: the same key for a different fill is refused", async () => {
    const k3 = key("reuse");
    expect((await fill({ variantId: attar.v6, quantity: 1 }, k3)).status).toBe(201);
    const r = await fill({ variantId: attar.v6, quantity: 2 }, k3);
    expect(r.status).toBe(409);
    expect(r.body.details?.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("FL-9: stopped half way (a crash before the close) — sending it again finishes it without taking anything twice", async () => {
    const k4 = key("resume");
    const before = await stocks([oil, btl12, box, attar.v12]);
    failClose.once = true;
    const first = await fill({ variantId: attar.v12, quantity: 2 }, k4);
    expect(first.status).toBe(409);
    expect(first.body.details?.code).toBe("FILL_STOPPED");
    const halfway = await stocks([oil, btl12, box, attar.v12]);
    expect(halfway).toEqual([before[0]! - 24, before[1]! - 2, before[2]! - 2, before[3]! + 2]);
    const second = await fill({ variantId: attar.v12, quantity: 2 }, k4);
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    expect(second.body.fill).toMatchObject({ complete: true, quantity: 2, perBottle: 78 });
    expect(await stocks([oil, btl12, box, attar.v12])).toEqual(halfway);
    expect((await prisma.productionOrder.findUniqueOrThrow({ where: { id: second.body.fill.productionOrderId } })).status).toBe("CLOSED");
  });

  it("FL-10: the old quick-refill endpoint goes through the same guard", async () => {
    const k5 = key("legacy");
    const before = await stocks([oil, btl6, attar.v6]);
    const a = await quickRefill({ variantId: attar.v6, quantity: 1 }, OWNER, k5);
    const b = await quickRefill({ variantId: attar.v6, quantity: 1 }, OWNER, k5);
    expect([a.replayed, b.replayed]).toEqual([false, true]);
    expect(b.order.id).toBe(a.order.id);
    expect(await stocks([oil, btl6, attar.v6])).toEqual([before[0]! - 6, before[1]! - 1, before[2]! + 1]);
    await expect(quickRefill({ variantId: dry.v6, quantity: 2 }, OWNER, key("legacy-short"))).rejects.toMatchObject({ details: { code: "FILL_SHORT" } });
  });
});

describe("waste", () => {
  it("FL-11: 3 ml spilt on top of 2 × 6 ml leaves stock too and is in the bottles' cost: (15×5 + 2×10 + 2×3) / 2 = ৳50.50", async () => {
    const before = await stocks([oil, btl6, box]);
    const r = await fill({ variantId: attar.v6, quantity: 2, wasted: [{ materialVariantId: oil, quantity: 3 }], wasteReason: "spilt while pouring" }, key("waste"));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(await stocks([oil, btl6, box])).toEqual([before[0]! - 15, before[1]! - 2, before[2]! - 2]);
    expect(r.body.fill).toMatchObject({ perBottle: 50.5, cost: 101, wasteReason: "spilt while pouring" });
    expect(r.body.fill.materials).toEqual(expect.arrayContaining([expect.objectContaining({ used: 12, wasted: 3 })]));
  });

  it("FL-12: waste needs its reason, and only a material of the recipe can be wasted", async () => {
    const noReason = await fill({ variantId: attar.v6, quantity: 1, wasted: [{ materialVariantId: oil, quantity: 1 }] }, key("waste-noreason"));
    expect(noReason.status).toBe(400);
    const strange = await fill({ variantId: attar.v6, quantity: 1, wasted: [{ materialVariantId: btl12, quantity: 1 }], wasteReason: "dropped" }, key("waste-strange"));
    expect(strange.status).toBe(400);
    expect(strange.body.details?.code).toBe("FILL_MATERIAL_NOT_IN_RECIPE");
  });
});

describe("Unlimited sales: owed bottles, filled later", () => {
  let first = "";
  let second = "";

  it("FL-13: with no filled bottles, orders of 2 and 3 go through — 5 owed, both awaiting filling, no material taken", async () => {
    expect((await setStockPolicy(made.id, { policy: "UNLIMITED", reason: "made to order" }, OWNER)).policy).toBe("UNLIMITED");
    const before = await stocks([oil, btl6, box]);
    first = (await placeOrder([{ variantId: made.v6, quantity: 2 }], { customerPhone: "01712000051" })).id;
    second = (await placeOrder([{ variantId: made.v6, quantity: 3 }], { customerPhone: "01712000052" })).id;
    expect(await stockOf(made.v6)).toBe(-5);
    expect(await stocks([oil, btl6, box])).toEqual(before);
    expect((await orderFillStatus(first)).lines).toEqual([expect.objectContaining({ units: 2, filled: 0, toFill: 2, status: "AWAITING_FILL" })]);
    expect((await orderFillStatus(second)).lines).toEqual([expect.objectContaining({ units: 3, filled: 0, toFill: 3, status: "AWAITING_FILL" })]);
    const hub = await stockHub({ canSeeCost: true });
    expect(hub.groups.find((g) => g.key === "FILL_TO_ORDER")!.items.find((i) => i.variantId === made.v6)!.policy).toMatchObject({ owed: 5 });
  });

  it("FL-14: filling 3 — the older order is ready, the newer one partly filled (1 of 3); the materials of 3 bottles are taken", async () => {
    const before = await stocks([oil, btl6, box]);
    expect((await fill({ variantId: made.v6, quantity: 3 }, key("owed-3"))).status).toBe(201);
    expect(await stockOf(made.v6)).toBe(-2);
    expect(await stocks([oil, btl6, box])).toEqual([before[0]! - 18, before[1]! - 3, before[2]! - 3]);
    expect((await orderFillStatus(first)).lines[0]).toMatchObject({ filled: 2, toFill: 0, status: "READY" });
    expect((await orderFillStatus(second)).lines[0]).toMatchObject({ filled: 1, toFill: 2, status: "PARTLY_FILLED" });
    expect(await prisma.inventoryCostState.findUniqueOrThrow({ where: { variantId: made.v6 } })).toMatchObject({ deficitQty: 2 });
  });

  it("FL-15: filling the last 2 — both ready, nothing owed; the trace tells the whole story", async () => {
    expect((await fill({ variantId: made.v6, quantity: 2 }, key("owed-2"))).status).toBe(201);
    expect((await waitingLines(prisma, [made.v6])).map((l) => l.status)).toEqual(["READY", "READY"]);
    const t = await stockTrace(made.v6, { canSeeCost: true });
    expect(t).toMatchObject({ kind: "FILL_TO_ORDER", stock: 0, waiting: 5, onShelf: 5, owed: 0, recipeMissing: false, policy: { policy: "UNLIMITED" } });
    expect(t.fills.map((f) => f.bottles)).toEqual([2, 3]);
    expect(t.fills[0]).toMatchObject({ status: "CLOSED", perBottle: 43 });
    expect(t.recipe!.lines.map((l) => [l.materialKind, l.perBottle])).toEqual(expect.arrayContaining([["RAW", 6], ["PACKAGING", 1], ["PACKAGING", 1]]));
    expect(t.recipe!.lines.find((l) => l.materialVariantId === oil)!.recentPurchases[0]).toMatchObject({ quantity: 1000, unitCost: 5 });
    expect(t.last90Days).toMatchObject({ sold: -5, filled: 5 });
    expect(t.valuation).toMatchObject({ deficitQty: 0 });
    expect(await booksMatch()).toEqual(MATCHED);
    await assertInventoryInvariants(made.v6);
  });

  it("FL-16: an order cancelled before it ships puts its bottles back; the next waiting order reads them", async () => {
    await updateOrderStatus(first, { status: "CANCELLED", note: "customer changed mind" }, admin);
    expect(await stockOf(made.v6)).toBe(2);
    expect((await orderFillStatus(second)).lines[0]).toMatchObject({ filled: 3, status: "READY" });
    expect((await orderFillStatus(first)).lines).toEqual([]);
  });
});

describe("caps: each size and colour on its own", () => {
  it("FL-17: a purchase of one size and colour moves only that variant; the bill total must match", async () => {
    const before = await stocks(caps.variants);
    const r = await as(request(app).post("/api/v1/finance/stock/purchases"))
      .set("Idempotency-Key", key("caps-buy"))
      .send({ supplierName: "Vitest cap supplier", documentTotal: 10, paidFrom: { ownerPocket: true }, lines: [{ variantId: caps.variants[3], quantity: 10, amount: 1000 }] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(await stocks(caps.variants)).toEqual([before[0], before[1], before[2], before[3]! + 10]);
    const mismatch = await as(request(app).post("/api/v1/finance/stock/purchases"))
      .set("Idempotency-Key", key("caps-mismatch"))
      .send({ supplierName: "Vitest cap supplier", documentTotal: 12, paidFrom: { ownerPocket: true }, lines: [{ variantId: caps.variants[2], quantity: 10, amount: 1000 }] });
    expect(mismatch.status).toBe(400);
    expect(await stocks(caps.variants)).toEqual([before[0], before[1], before[2], before[3]! + 10]);
  });

  it("FL-18: a sale, a cancellation and a parcel back each move only their own size / colour", async () => {
    const before = await stocks(caps.variants);
    const sale = await placeOrder([{ variantId: caps.variants[1]!, quantity: 2 }], { customerPhone: "01712000053" });
    expect(await stocks(caps.variants)).toEqual([before[0], before[1]! - 2, before[2], before[3]]);
    await updateOrderStatus(sale.id, { status: "CANCELLED", note: "duplicate" }, admin);
    expect(await stocks(caps.variants)).toEqual(before);
    const shipped = await placeOrder([{ variantId: caps.variants[2]!, quantity: 1 }], { customerPhone: "01712000054" });
    await updateOrderStatus(shipped.id, { status: "SHIPPED" }, admin);
    await updateOrderStatus(shipped.id, { status: "CANCELLED", note: "refused at the door" }, admin);
    expect(await stocks(caps.variants)).toEqual([before[0], before[1], before[2]! - 1, before[3]]);
    await receiveReturnedParcel(shipped.id, admin, {});
    expect(await stocks(caps.variants)).toEqual(before);
    // a cap can't be put on unlimited sales
    await expect(setStockPolicy(caps.id, { policy: "UNLIMITED", reason: "not for caps" }, OWNER)).rejects.toMatchObject({ details: { code: "STOCK_POLICY_NEEDS_FILL" } });
    for (const v of caps.variants) await assertInventoryInvariants(v);
  });

  it("FL-19: the stock page splits materials into raw (by volume) and packaging (in pieces); the books match", async () => {
    const hub = await stockHub({ canSeeCost: true });
    const mats = hub.groups.find((g) => g.key === "MATERIAL")!.items;
    const role = (id: string) => mats.find((m) => m.variantId === id)!.materialKind;
    expect([role(oil), role(dryOil), role(btl6), role(btl12), role(box)]).toEqual(["RAW", "RAW", "PACKAGING", "PACKAGING", "PACKAGING"]);
    expect(hub.groups.find((g) => g.key === "FINISHED")!.items.every((i) => i.materialKind === null)).toBe(true);
    expect(await booksMatch()).toEqual(MATCHED);
    for (const v of [attar.v6, attar.v12, made.v6, oil, btl6, btl12, box]) await assertInventoryInvariants(v);
  });
});
