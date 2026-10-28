import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { PERMISSIONS } from "@clothing-brand/shared";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { signAccessToken } from "../../lib/jwt";
import { cleanupFixtures, createStockedProduct, ownerId, purgeFinanceTables, RUN } from "../../test-fixtures";
import type { FinanceActor } from "../finance/finance-audit";
import { getFinanceContext } from "../finance/finance-context";
import { finishPurchase, recordPurchase, spreadByWeight } from "./purchase.service";

// Blueprint P1.4 simple mode (owner decisions Q7 = A, Q-F): before stock costing is live, Stock › Received goods records
// the purchase without booking it — stock in, catalog cost set from it unless unticked, the money a pending record.

const CSRF = "vitest-csrf";
let OWNER: FinanceActor;
let admin = "";
const api = () => {
  const cookie = [`access_token=${signAccessToken({ adminId: admin, role: "OWNER" })}`, `csrf_token=${CSRF}`];
  const auth = (r: request.Test) => r.set("Cookie", cookie).set("X-CSRF-Token", CSRF);
  return {
    get: (url: string) => auth(request(app).get(`/api/v1/finance${url}`)),
    post: (url: string, body: object = {}, key?: string) => {
      const r = auth(request(app).post(`/api/v1/finance${url}`));
      return (key ? r.set("Idempotency-Key", key) : r).send(body);
    },
  };
};
const stock = async (id: string) => (await prisma.productVariant.findUniqueOrThrow({ where: { id } })).stock;
const cost = async (id: string) => {
  const v = await prisma.productVariant.findUniqueOrThrow({ where: { id }, select: { costPrice: true } });
  return v.costPrice === null ? null : Number(v.costPrice);
};
const booked = async () => ({
  receipts: await prisma.goodsReceipt.count(),
  bills: await prisma.supplierInvoice.count(),
  movements: await prisma.treasuryMovement.count(),
  landed: await prisma.landedCost.count(),
  journals: await prisma.journalEntry.count(),
  events: await prisma.financialEvent.count(),
});

let cash = "";
let shirt = "";
let cap = "";

beforeAll(async () => {
  await purgeFinanceTables();
  admin = await ownerId();
  OWNER = { type: "ADMIN", adminId: admin, label: "owner@test", permissions: [...PERMISSIONS] };
  const { business } = await getFinanceContext();
  expect((await prisma.financeBusiness.findUniqueOrThrow({ where: { id: business.id } })).inventoryCostingActivatedAt).toBeNull();
  const fa = await api().post("/financial-accounts", { kind: "CASH", name: `Cash SP ${RUN}` });
  expect(fa.status, JSON.stringify(fa.body)).toBe(201);
  cash = fa.body.id;
  shirt = (await createStockedProduct({ stocks: [2], basePrice: 900 })).variants[0]!.id;
  cap = (await createStockedProduct({ stocks: [0], basePrice: 400 })).variants[0]!.id;
});

afterAll(async () => {
  await purgeFinanceTables();
  await cleanupFixtures();
});

const purchase = (extra: object = {}) => ({
  supplierName: `Bashundhara ${RUN}`,
  lines: [{ variantId: shirt, quantity: 4, amount: 1000 }, { variantId: cap, quantity: 10, amount: 3000 }],
  documentTotal: 14,
  extras: [{ description: "Rickshaw", amount: 100 }],
  paidFrom: { financialAccountId: cash },
  ...extra,
});

describe("Received goods before costing is live (P1.4 simple mode)", () => {
  it("raises stock and sets catalog costs with the extras spread by value; nothing is booked and the money is pending", async () => {
    const before = await booked();
    const r = await api().post("/stock/purchases", purchase(), `sp-simple-${RUN}`);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ receiptId: null, invoiceId: null, landedCostId: null, replayed: false });
    expect(r.body.purchase).toMatchObject({ mode: "SIMPLE", moneyPending: true, complete: true, pendingStep: null, receipt: null, invoice: null, paymentStatus: null, total: 4100 });
    expect(await stock(shirt)).toBe(6);
    expect(await stock(cap)).toBe(10);
    // ৳100 of extras by value: ৳25 to the shirts (৳1,000), ৳75 to the caps (৳3,000)
    expect(await cost(shirt)).toBe(256.25);
    expect(await cost(cap)).toBe(307.5);
    expect(r.body.purchase.catalogCosts).toEqual([{ variantId: shirt, before: null, after: 256.25 }, { variantId: cap, before: null, after: 307.5 }]);
    expect(await booked()).toEqual(before);
    const mv = await prisma.stockMovement.findMany({ where: { sourceType: "StockHubEntry", sourceId: r.body.purchase.id }, orderBy: { change: "asc" } });
    expect(mv.map((m) => [m.reason, m.change])).toEqual([["RESTOCK", 4], ["RESTOCK", 10]]);
  });

  it("a replay writes nothing twice", async () => {
    const r = await api().post("/stock/purchases", purchase(), `sp-simple-${RUN}`);
    expect(r.status).toBe(200);
    expect(r.body.replayed).toBe(true);
    expect(await stock(shirt)).toBe(6);
    expect(await prisma.stockMovement.count({ where: { sourceType: "StockHubEntry", sourceId: r.body.purchase.id } })).toBe(2);
  });

  it("looks like the purchase already entered: warned before saving, saved with its reason, never refused", async () => {
    const check = await api().post("/stock/purchases/duplicate-check", { supplierName: `bashundhara ${RUN}`, lines: [{ variantId: shirt, amount: 1000 }, { variantId: cap, amount: 3000 }] });
    expect(check.status, JSON.stringify(check.body)).toBe(200);
    expect(check.body.matches).toEqual([expect.objectContaining({ number: "Purchase (not in the books)", itemOverlap: 1, totalDifference: 0, total: 4000 })]);
    const r = await api().post("/stock/purchases", purchase({ duplicateReason: "second delivery", updateCatalogCost: false }), `sp-simple-dup-${RUN}`);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.purchase.duplicateMatches).toBe(1);
    const entry = await prisma.stockHubEntry.findUniqueOrThrow({ where: { id: r.body.purchase.id } });
    expect((entry.steps as { request: { duplicateReason: string } }).request.duplicateReason).toBe("second delivery");
    // unticked: the catalog costs stay as they were
    expect(await cost(shirt)).toBe(256.25);
    expect(await stock(shirt)).toBe(10);
  });

  it("the owner's own money is the owner's to record; setting catalog costs needs catalog.manage — refused before anything is written", async () => {
    const clerk: FinanceActor = { type: "ADMIN", adminId: admin, label: "clerk@test", permissions: ["purchasing.receive", "purchasing.read"] };
    await expect(recordPurchase(purchase({ paidFrom: { ownerPocket: true }, updateCatalogCost: false }), clerk, `sp-clerk-1-${RUN}`)).rejects.toMatchObject({ statusCode: 403 });
    await expect(recordPurchase(purchase(), clerk, `sp-clerk-2-${RUN}`)).rejects.toMatchObject({ statusCode: 403, details: { code: "STOCK_PURCHASE_PERMISSION" } });
    expect(await prisma.stockHubEntry.count({ where: { idempotencyKey: { in: [`purchase:sp-clerk-1-${RUN}`, `purchase:sp-clerk-2-${RUN}`] } } })).toBe(0);
    // unticked, a clerk records the goods (no money of the owner's, no catalog change)
    const r = await recordPurchase(purchase({ updateCatalogCost: false, lines: [{ variantId: cap, quantity: 1, amount: 300 }], documentTotal: 1, extras: [] }), clerk, `sp-clerk-3-${RUN}`);
    expect(r.purchase.mode).toBe("SIMPLE");
    expect(await stock(cap)).toBe(21);
  });

  it("the owner's own money is kept as who paid, without making his money account", async () => {
    const r = await recordPurchase(purchase({ paidFrom: { ownerPocket: true }, updateCatalogCost: false, lines: [{ variantId: cap, quantity: 1, amount: 300 }], documentTotal: 1, extras: [] }), OWNER, `sp-owner-${RUN}`);
    expect(r.purchase.paidFrom).toMatchObject({ kind: "OWNER", financialAccountId: null });
    expect(await prisma.financialAccount.count({ where: { name: { endsWith: "— own money" } } })).toBe(0);
  });

  it("there is nothing to finish, and the list says the money is not in the books", async () => {
    const list = (await api().get("/stock/purchases")).body.purchases as Array<{ mode: string; moneyPending: boolean }>;
    expect(list.length).toBeGreaterThanOrEqual(4);
    expect(list.every((p) => p.mode === "SIMPLE" && p.moneyPending)).toBe(true);
    const id = (await prisma.stockHubEntry.findFirstOrThrow({ where: { kind: "PURCHASE" } })).id;
    await expect(finishPurchase(id, {}, OWNER)).rejects.toMatchObject({ statusCode: 409, details: { code: "SIMPLE_PURCHASE" } });
  });

  it("refuses what isn't stock and a purchase dated in the future", async () => {
    const untracked = await createStockedProduct({ stocks: [0] });
    await prisma.product.update({ where: { id: untracked.product.id }, data: { trackInventory: false } });
    const r = await api().post("/stock/purchases", purchase({ lines: [{ variantId: untracked.variants[0]!.id, quantity: 1, amount: 10 }], documentTotal: 1, extras: [] }), `sp-untracked-${RUN}`);
    expect(r.body.details?.code).toBe("PURCHASE_UNTRACKED");
    const future = await api().post("/stock/purchases", purchase({ date: "2099-01-01" }), `sp-future-${RUN}`);
    expect(future.body.details?.code).toBe("PURCHASE_IN_FUTURE");
  });
});

describe("spreadByWeight", () => {
  it("splits exactly, by value, largest remainder first", () => {
    expect(spreadByWeight(100, [1000, 3000])).toEqual([25, 75]);
    expect(spreadByWeight(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(spreadByWeight(0, [5, 5])).toEqual([0, 0]);
    expect(spreadByWeight(7, [0, 0])).toEqual([0, 0]);
  });
});
