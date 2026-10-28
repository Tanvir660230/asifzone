import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { PERMISSIONS } from "@clothing-brand/shared";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { signAccessToken } from "../../lib/jwt";
import { cleanupFixtures, createStockedProduct, ownerId, purgeFinanceTables, RUN } from "../../test-fixtures";
import type { FinanceActor } from "../finance/finance-audit";
import { getFinanceContext } from "../finance/finance-context";
import { ensureCommerceAccounting } from "../finance/commerce-setup.service";
import { ensurePurchasingAccounting } from "../finance/purchasing-setup.service";
import { updateBusinessSettings } from "../finance/chart.service";
import { postOpeningBalances, saveOpeningInventory } from "../finance/opening-balances.service";
import { approveCutover, draftCutover, postCutover } from "../finance/inventory-cutover.service";
import { processFinancialEvent } from "../finance/events.service";
import { runReconciliation } from "../finance/reconciliation.service";
import { ownerMoney } from "../finance/partner-profit.service";
import { getSupplierInvoice } from "../finance/supplier-invoices.service";
import { createGoodsReceipt } from "../finance/goods-receipts.service";
import { ensureManufacturingSetup } from "../manufacturing/manufacturing-setup.service";
import { createMaterial } from "../manufacturing/materials.service";
import { changePeriodStatus } from "../finance/periods.service";
import { createSupplier, setSupplierStatus } from "../finance/suppliers.service";
import { financeError } from "../finance/finance-values";
import { finishPurchase, listPurchases, recordPurchase } from "./purchase.service";

// Test seams: run something just before the purchase creates its receipt / pays its bill (the real call follows).
const hooks = vi.hoisted(() => ({ beforeReceipt: null as null | (() => Promise<void>), beforePayment: null as null | (() => Promise<void>) }));
vi.mock("../finance/goods-receipts.service", async (orig) => {
  const real = await orig<typeof import("../finance/goods-receipts.service")>();
  return {
    ...real,
    createGoodsReceipt: async (...a: Parameters<typeof real.createGoodsReceipt>) => {
      const h = hooks.beforeReceipt;
      hooks.beforeReceipt = null;
      if (h) await h();
      return real.createGoodsReceipt(...a);
    },
  };
});
vi.mock("../finance/supplier-payments.service", async (orig) => {
  const real = await orig<typeof import("../finance/supplier-payments.service")>();
  return {
    ...real,
    paySupplier: async (...a: Parameters<typeof real.paySupplier>) => {
      const h = hooks.beforePayment;
      hooks.beforePayment = null;
      if (h) await h();
      return real.paySupplier(...a);
    },
  };
});

// Stock hub Task 5 (docs/STOCK_HUB.md §2 "Bought"): one form → a direct goods receipt, a bill matched to it, its payment
// (from an account, or the owner's own money booked as capital first) and the extras as a landed cost spread by value.

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
const avg = async (id: string) => Number((await prisma.inventoryCostState.findUniqueOrThrow({ where: { variantId: id } })).avgUnitCost);
const balance = async (id: string) => (await api().get(`/financial-accounts/${id}`)).body.currentBalance as number;
const counts = async () => ({
  receipts: await prisma.goodsReceipt.count(),
  bills: await prisma.supplierInvoice.count(),
  movements: await prisma.treasuryMovement.count(),
  landed: await prisma.landedCost.count(),
});
async function postPending() {
  for (let round = 0; round < 10; round++) {
    const waiting = await prisma.financialEvent.findMany({ where: { status: { in: ["RECEIVED", "FAILED"] } }, select: { id: true } });
    if (!waiting.length) return;
    for (const e of waiting) await processFinancialEvent(e.id);
  }
}
const CHECKS = ["ledger.integrity", "treasury.integrity", "events.unposted", "inventory.valuation_vs_ledger", "inventory.quantity_vs_valuation", "inventory.valuation_postings", "purchasing.grni", "payables.subledger"];
async function booksMatch() {
  await postPending();
  const r = await runReconciliation({ checks: CHECKS }, OWNER);
  expect(Object.fromEntries(r.results.map((x) => [x.checkKey, x.status]))).toEqual(Object.fromEntries(CHECKS.map((c) => [c, "MATCHED"])));
}

let bank = "";
let bkash = "";
let cashBox = "";
let oil = "";
let bottle = "";
let cap = "";

beforeAll(async () => {
  await purgeFinanceTables();
  admin = await ownerId();
  OWNER = { type: "ADMIN", adminId: admin, label: "owner@test", permissions: [...PERMISSIONS] };
  const ctx = await getFinanceContext();
  await ensureCommerceAccounting(OWNER);
  await ensurePurchasingAccounting(OWNER);
  await ensureManufacturingSetup(OWNER);
  await updateBusinessSettings({ openingDate: "2026-09-01", reason: "books start" }, OWNER);
  const seed = await createStockedProduct({ stocks: [5], basePrice: 1000 });
  await saveOpeningInventory([{ variantId: seed.variants[0]!.id, sku: "SH-SEED", name: "seed", quantity: 5, unitCost: 100, valuationStatus: "KNOWN", valuationMethod: "SUPPLIER_INVOICE", valuationSource: "INV", valuationDate: "2026-09-01", brandId: ctx.brand.id }], OWNER);
  await postOpeningBalances(OWNER);
  const material = async (name: string, unit: string) => (await createMaterial({ name: `Vitest ${name} ${RUN}`, stockUnit: unit, variants: [{ sku: `SHP-${name.replace(/\W/g, "")}-${RUN}`, spec: name }] }, OWNER, { canSeeCost: true })).variants[0]!.id;
  oil = await material("Azhaar oil", "ml");
  bottle = await material("Bottle 6ml", "pcs");
  cap = (await createStockedProduct({ stocks: [0], basePrice: 900 })).variants[0]!.id;
  const account = async (body: object) => {
    const r = await api().post("/financial-accounts", body);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.id as string;
  };
  bank = await account({ kind: "BANK", name: `Bank SH ${RUN}`, openingBalance: { amount: 50000, date: "2026-09-01" } });
  bkash = await account({ kind: "MOBILE_WALLET", name: `bKash SH ${RUN}`, provider: "bKash", openingBalance: { amount: 100, date: "2026-09-01" } });
  cashBox = await account({ kind: "CASH", name: `Cash box SH ${RUN}` });
});

afterAll(async () => {
  await purgeFinanceTables();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL finance.maintenance_purge = 'on'`);
    await tx.$executeRawUnsafe(`DELETE FROM "StockMovement" WHERE "variantId" IN (SELECT v.id FROM "ProductVariant" v JOIN "Product" p ON p.id = v."productId" WHERE p.kind = 'MATERIAL' AND p.name LIKE 'Vitest %')`);
    await tx.$executeRawUnsafe(`DELETE FROM "ProductVariant" WHERE "productId" IN (SELECT id FROM "Product" WHERE kind = 'MATERIAL' AND name LIKE 'Vitest %')`);
    await tx.$executeRawUnsafe(`DELETE FROM "Product" WHERE kind = 'MATERIAL' AND name LIKE 'Vitest %'`);
  });
  await cleanupFixtures();
});

const oilPurchase = (paidFrom: object, extras = [{ description: "Transport", amount: 400 }]) => ({ lines: [{ variantId: oil, quantity: 500, amount: 12000 }], documentTotal: 500, extras, paidFrom });

describe("Bought — before go-live", () => {
  // Before costing is live a purchase is recorded in simple mode, never booked (blueprint P1.4, Q-F) — covered with its own
  // data in simple-purchase.integration.test.ts; nothing is recorded here, so the oil's valuation below starts at zero.

  it("go-live: the valuation cutover activates costing", async () => {
    await draftCutover({}, OWNER);
    await approveCutover({ acknowledgeMissing: true }, OWNER);
    await postCutover(OWNER);
  });
});

describe("Bought", () => {
  let first: { receiptId: string; invoiceId: string; landedCostId: string | null };

  it("bought oil raises stock and average cost: 500 ml for ৳12,000 + ৳400 transport → ৳24.80 a ml", async () => {
    const bankBefore = await balance(bank);
    const r = await api().post("/stock/purchases", oilPurchase({ financialAccountId: bank }), `sp-oil-${RUN}`);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ replayed: false, receiptId: expect.any(String), invoiceId: expect.any(String), landedCostId: expect.any(String) });
    first = r.body;
    expect(await stock(oil)).toBe(500);
    expect(await avg(oil)).toBe(24.8);
    expect(await balance(bank)).toBe(bankBefore - 12400);
    const receipt = await prisma.goodsReceipt.findUniqueOrThrow({ where: { id: first.receiptId }, include: { supplier: true } });
    expect(receipt).toMatchObject({ status: "POSTED", directReason: "Bought — stock hub" });
    expect(receipt.supplier.displayName).toBe("Local market");
    const bill = await getSupplierInvoice(first.invoiceId);
    expect(bill).toMatchObject({ status: "POSTED", total: 12000, outstanding: 0 });
    expect(r.body.purchase).toMatchObject({ supplier: { name: "Local market" }, goods: 12000, extras: 400, total: 12400, paidFrom: { kind: "ACCOUNT", financialAccountId: bank }, complete: true });
    await booksMatch();
  });

  it("replayed purchase writes once: the same request again, and a double tap, write one receipt, one bill, one payment", async () => {
    const before = await counts();
    const again = await api().post("/stock/purchases", oilPurchase({ financialAccountId: bank }), `sp-oil-${RUN}`);
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(again.body).toMatchObject({ replayed: true, receiptId: first.receiptId, invoiceId: first.invoiceId, landedCostId: first.landedCostId });
    expect(await counts()).toEqual(before);
    expect(await stock(oil)).toBe(500);

    // a double tap: two requests with one key at the same moment
    const body = { lines: [{ variantId: bottle, quantity: 166, amount: 8300 }], documentTotal: 166, paidFrom: { financialAccountId: bank } };
    const [a, b] = await Promise.all([api().post("/stock/purchases", body, `sp-tap-${RUN}`), api().post("/stock/purchases", body, `sp-tap-${RUN}`)]);
    expect([a.status, b.status].sort(), JSON.stringify([a.body, b.body])).toEqual(expect.arrayContaining([201]));
    for (const x of [a, b]) expect([200, 201, 409]).toContain(x.status);
    const settled = await api().post("/stock/purchases", body, `sp-tap-${RUN}`);
    expect(settled.body.replayed).toBe(true);
    expect(await counts()).toMatchObject({ receipts: before.receipts + 1, bills: before.bills + 1, movements: before.movements + 1 });
    expect(await stock(bottle)).toBe(166);
    expect(await avg(bottle)).toBe(50);

    // the same key for a different purchase is refused
    const other = await api().post("/stock/purchases", { ...body, lines: [{ variantId: bottle, quantity: 1, amount: 50 }], documentTotal: 1 }, `sp-tap-${RUN}`);
    expect(other.status).toBe(409);
    expect(other.body.details?.code).toBe("IDEMPOTENCY_KEY_REUSED");
    await booksMatch();
  });

  it("paid from bKash lowers its balance; a payment refused mid-way resumes on retry without writing twice", async () => {
    const body = { supplierName: "Chawkbazar Bottle House", reference: "INV-77", lines: [{ variantId: cap, quantity: 3, amount: 1000 }], documentTotal: 3, paidFrom: { financialAccountId: bkash } };
    const before = await counts();
    // not enough in the wallet: refused before anything is written (no goods in without their payment)
    const short = await api().post("/stock/purchases", body, `sp-bkash-${RUN}`);
    expect(short.status, JSON.stringify(short.body)).toBe(409);
    expect(short.body.details?.code).toBe("INSUFFICIENT_FUNDS"); // bKash holds 100
    expect(await counts()).toEqual(before);
    expect(await prisma.stockHubEntry.count({ where: { idempotencyKey: `purchase:sp-bkash-${RUN}` } })).toBe(0);

    await ownerMoney({ kind: "INVEST", financialAccountId: bkash, amount: 2000, note: "top up" }, OWNER, `sp-topup-${RUN}`);
    // the money moves away between the check and the payment: the goods are in, the bill entered, the payment refused
    hooks.beforePayment = async () => { throw financeError(409, "INSUFFICIENT_FUNDS", "bKash was emptied meanwhile"); };
    const stuck = await api().post("/stock/purchases", body, `sp-bkash-${RUN}`);
    expect(stuck.status, JSON.stringify(stuck.body)).toBe(409);
    const listed = (await api().get("/stock/purchases")).body.purchases.find((p: { supplier: { name: string } }) => p.supplier.name === "Chawkbazar Bottle House");
    expect(listed).toMatchObject({ complete: false, pendingStep: "payment", total: 1000 });
    expect(await stock(cap)).toBe(3);
    // a crash between a step and its bookkeeping: the receipt and bill are found again by their stamp
    const entry = await prisma.stockHubEntry.findFirstOrThrow({ where: { idempotencyKey: `purchase:sp-bkash-${RUN}` } });
    const steps = entry.steps as Record<string, unknown>;
    await prisma.stockHubEntry.update({ where: { id: entry.id }, data: { steps: { ...steps, receiptId: undefined, invoiceId: undefined } as never } });

    const walletBefore = await balance(bkash);
    const r = await api().post("/stock/purchases", body, `sp-bkash-${RUN}`);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(await balance(bkash)).toBe(walletBefore - 1000);
    expect(await counts()).toMatchObject({ receipts: before.receipts + 1, bills: before.bills + 1, movements: before.movements + 2 }); // + top-up + payment
    expect(await stock(cap)).toBe(3);
    // 1,000 for 3 caps is not a whole number of paisa each: the receipt splits it so the stock is worth exactly 1,000
    const lines = await prisma.goodsReceiptLine.findMany({ where: { goodsReceiptId: r.body.receiptId }, orderBy: { lineNo: "asc" } });
    expect(lines.map((l) => [l.qtyAccepted, Number(l.unitCost)])).toEqual([[2, 333.33], [1, 333.34]]);
    expect(Number((await prisma.inventoryCostState.findUniqueOrThrow({ where: { variantId: cap } })).value)).toBe(1000);
    expect(r.body.purchase).toMatchObject({ supplier: { name: "Chawkbazar Bottle House" }, reference: "INV-77", complete: true, lines: [{ variantId: cap, quantity: 3, amount: 1000 }] });
    await booksMatch();
  });

  it("paid by owner adds capital: his money goes in as capital and pays the bill and the extras", async () => {
    const { business } = await getFinanceContext();
    const capital = await prisma.accountMapping.findUniqueOrThrow({ where: { businessId_key: { businessId: business.id, key: "equity.owner_capital" } } });
    const capitalOf = async () => {
      const s = await prisma.journalLine.aggregate({ where: { accountId: capital.accountId, entry: { status: "POSTED" } }, _sum: { debit: true, credit: true } });
      return Number(s._sum.credit ?? 0) - Number(s._sum.debit ?? 0);
    };
    const capitalBefore = await capitalOf();
    const cashBefore = await balance(cashBox);
    // owner-only, like POST /equity/owner/money: without finance.sensitive nothing is written
    const before = await counts();
    const noSensitive: FinanceActor = { type: "ADMIN", adminId: admin, label: "manager@test", permissions: PERMISSIONS.filter((p) => p !== "finance.sensitive") };
    await expect(recordPurchase(oilPurchase({ ownerPocket: true }) as never, noSensitive, `sp-owner-nosens-${RUN}`)).rejects.toMatchObject({ statusCode: 403 });
    expect(await counts()).toEqual(before);
    expect(await prisma.stockHubEntry.count({ where: { idempotencyKey: `purchase:sp-owner-nosens-${RUN}` } })).toBe(0);

    const r = await api().post("/stock/purchases", oilPurchase({ ownerPocket: true }, [{ description: "Rickshaw", amount: 100 }]), `sp-owner-${RUN}`);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(await capitalOf()).toBe(capitalBefore + 12100);
    // his money passes through his own "— own money" cash account (made the first time), never another cash box
    expect(await balance(cashBox)).toBe(cashBefore);
    const pocket = await prisma.financialAccount.findUniqueOrThrow({ where: { id: r.body.purchase.paidFrom.financialAccountId } });
    expect(pocket).toMatchObject({ kind: "CASH", isActive: true });
    expect(pocket.name).toMatch(/ — own money$/);
    expect(pocket.id).not.toBe(cashBox);
    expect(await balance(pocket.id)).toBe(0); // in and out the same day
    expect(r.body.purchase.paidFrom).toMatchObject({ kind: "OWNER", name: pocket.name });
    expect(await stock(oil)).toBe(1000);
    expect(await avg(oil)).toBe(24.5); // (12,400 + 12,100) / 1,000
    await booksMatch();
  });

  it("lists recent purchases, newest first, with who paid", async () => {
    const r = await api().get("/stock/purchases");
    expect(r.status).toBe(200);
    const mine = r.body.purchases.filter((p: { lines: Array<{ variantId: string }> }) => p.lines.some((l) => [oil, bottle, cap].includes(l.variantId)));
    expect(mine.map((p: { paidFrom: { kind: string } }) => p.paidFrom.kind)).toEqual(["OWNER", "ACCOUNT", "ACCOUNT", "ACCOUNT"]);
    expect(mine[0]).toMatchObject({ date: expect.any(String), goods: 12000, extras: 100, total: 12100, lines: [{ variantId: oil, quantity: 500, amount: 12000, unit: "ml" }] });
  });

  it("refuses what isn't stock, and an actor who can't post receipts, bills and payments", async () => {
    const untracked = await createStockedProduct({ stocks: [0] });
    await prisma.product.update({ where: { id: untracked.product.id }, data: { trackInventory: false } });
    const r = await api().post("/stock/purchases", { lines: [{ variantId: untracked.variants[0]!.id, quantity: 1, amount: 10 }], documentTotal: 1, paidFrom: { financialAccountId: bank } }, `sp-untracked-${RUN}`);
    expect(r.status).toBe(400);
    const clerk: FinanceActor = { type: "ADMIN", adminId: admin, label: "clerk@test", permissions: ["purchasing.receive", "purchasing.read"] };
    await expect(recordPurchase({ lines: [{ variantId: oil, quantity: 1, amount: 10 }], documentTotal: 1, paidFrom: { financialAccountId: bank } }, clerk, `sp-clerk-${RUN}`)).rejects.toMatchObject({ statusCode: 403 });
    const noKey = await api().post("/stock/purchases", oilPurchase({ financialAccountId: bank }));
    expect(noKey.status).toBe(400);
  });
});

describe("Bought — review fixes", () => {
  it("a request that outlived its lease can't post a second receipt: the retry that took over finishes, the late one is refused", async () => {
    const body = { lines: [{ variantId: bottle, quantity: 10, amount: 500 }], documentTotal: 10, paidFrom: { financialAccountId: bank } };
    const key = `sp-lease-${RUN}`;
    const before = await counts();
    const stockBefore = await stock(bottle);
    let retry: request.Response | undefined;
    hooks.beforeReceipt = async () => {
      // the first request is about to create the receipt when its lease runs out; a retry takes the entry over and finishes
      await prisma.stockHubEntry.updateMany({ where: { idempotencyKey: `purchase:${key}` }, data: { leaseUntil: new Date(Date.now() - 1000) } });
      retry = await api().post("/stock/purchases", body, key);
    };
    const late = await api().post("/stock/purchases", body, key);
    expect(retry?.status, JSON.stringify(retry?.body)).toBe(201);
    expect(late.status, JSON.stringify(late.body)).toBe(409);
    expect(late.body.details?.code).toBe("STOCK_ENTRY_LEASE_LOST");
    expect(await prisma.goodsReceipt.count({ where: { evidence: `stock-purchase:${key}:receipt` } })).toBe(1);
    expect(await counts()).toMatchObject({ receipts: before.receipts + 1, bills: before.bills + 1, movements: before.movements + 1 });
    expect(await stock(bottle)).toBe(stockBefore + 10);
    const replay = await api().post("/stock/purchases", body, key);
    expect(replay.body).toMatchObject({ replayed: true, receiptId: retry!.body.receiptId });
    await booksMatch();
  });

  it("the database keeps one live receipt per stamp", async () => {
    const receipt = await prisma.goodsReceipt.findFirstOrThrow({ where: { evidence: `stock-purchase:sp-lease-${RUN}:receipt` } });
    await expect(createGoodsReceipt({ supplierId: receipt.supplierId, evidence: receipt.evidence, directReason: "dup", lines: [{ variantId: bottle, qtyAccepted: 1, unitCost: 1 }] } as never, OWNER)).rejects.toThrow();
    expect(await prisma.goodsReceipt.count({ where: { evidence: receipt.evidence } })).toBe(1);
  });

  it("not enough money, a date before the books or in a closed month: refused before anything is written", async () => {
    const before = await counts();
    const entries = await prisma.stockHubEntry.count();
    const early = await api().post("/stock/purchases", { date: "2026-08-15", lines: [{ variantId: cap, quantity: 1, amount: 10 }], documentTotal: 1, paidFrom: { financialAccountId: bank } }, `sp-early2-${RUN}`);
    expect(early.status, JSON.stringify(early.body)).toBe(409);
    expect(early.body.details?.code).toBe("BEFORE_OPENING_DATE");
    const { business } = await getFinanceContext();
    const sept = await prisma.financialPeriod.findFirstOrThrow({ where: { businessId: business.id, startDate: new Date("2026-09-01T00:00:00Z") } });
    await changePeriodStatus(sept.id, "close", "test: September is closed", OWNER);
    try {
      const closed = await api().post("/stock/purchases", { date: "2026-09-15", lines: [{ variantId: cap, quantity: 1, amount: 10 }], documentTotal: 1, paidFrom: { financialAccountId: bank } }, `sp-closed-${RUN}`);
      expect(closed.status, JSON.stringify(closed.body)).toBe(409);
      expect(closed.body.details?.code).toBe("PERIOD_CLOSED");
    } finally {
      await changePeriodStatus(sept.id, "reopen", "test done", OWNER);
    }
    expect(await counts()).toEqual(before);
    expect(await prisma.stockHubEntry.count()).toBe(entries);
  });

  it("a supplier on hold is never picked or paid: refused before anything is written", async () => {
    const held = await createSupplier({ legalName: `Held Traders ${RUN}`, displayName: `Held Traders ${RUN}` } as never, OWNER);
    await setSupplierStatus(held.id, { status: "ON_HOLD", reason: "disputed delivery" }, OWNER);
    const before = await counts();
    const r = await api().post("/stock/purchases", { supplierName: `Held Traders ${RUN}`, lines: [{ variantId: cap, quantity: 1, amount: 10 }], documentTotal: 1, paidFrom: { financialAccountId: bank } }, `sp-held-${RUN}`);
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body.details?.code).toBe("SUPPLIER_ON_HOLD");
    expect(r.body.error).toMatch(/on hold/);
    expect(await counts()).toEqual(before);
    expect(await prisma.stockHubEntry.count({ where: { idempotencyKey: `purchase:sp-held-${RUN}` } })).toBe(0);
  });

  it("caps the amounts: each at most 1,000,000,000 and the purchase at most 10,000,000,000", async () => {
    const huge = await api().post("/stock/purchases", { lines: [{ variantId: cap, quantity: 1, amount: 2_000_000_000 }], documentTotal: 1, paidFrom: { financialAccountId: bank } }, `sp-huge-${RUN}`);
    expect(huge.status).toBe(400);
    const many = await api().post("/stock/purchases", {
      lines: [{ variantId: cap, quantity: 1, amount: 1_000_000_000 }], documentTotal: 1,
      extras: Array.from({ length: 10 }, (_, i) => ({ description: `x${i}`, amount: 1_000_000_000 })),
      paidFrom: { financialAccountId: bank },
    }, `sp-many-${RUN}`);
    expect(many.status).toBe(400);
  });

  it("a purchase stuck mid-way is finished from another account; GET says what is pending", async () => {
    const body = { supplierName: "Finish Test Traders", lines: [{ variantId: cap, quantity: 2, amount: 600 }], documentTotal: 2, paidFrom: { financialAccountId: bkash } };
    hooks.beforePayment = async () => {
      throw financeError(409, "INSUFFICIENT_FUNDS", "bKash was emptied meanwhile");
    };
    const stuck = await api().post("/stock/purchases", body, `sp-finish-${RUN}`);
    expect(stuck.status, JSON.stringify(stuck.body)).toBe(409);
    const entry = await prisma.stockHubEntry.findFirstOrThrow({ where: { idempotencyKey: `purchase:sp-finish-${RUN}` } });
    const listed = await api().get(`/stock/purchases/${entry.id}`);
    expect(listed.status, JSON.stringify(listed.body)).toBe(200);
    expect(listed.body.purchase).toMatchObject({ complete: false, pendingStep: "payment", paymentStatus: null });

    const bankBefore = await balance(bank);
    const walletBefore = await balance(bkash);
    const before = await counts();
    const done = await api().post(`/stock/purchases/${entry.id}/finish`, { paidFrom: { financialAccountId: bank } });
    expect(done.status, JSON.stringify(done.body)).toBe(201);
    expect(done.body).toMatchObject({ replayed: false, purchase: { complete: true, pendingStep: null, paidFrom: { kind: "ACCOUNT", financialAccountId: bank }, paymentStatus: "POSTED" } });
    expect(await balance(bank)).toBe(bankBefore - 600);
    expect(await balance(bkash)).toBe(walletBefore);
    expect(await counts()).toMatchObject({ receipts: before.receipts, bills: before.bills, movements: before.movements + 1 });

    const again = await api().post(`/stock/purchases/${entry.id}/finish`, { paidFrom: { financialAccountId: bkash } });
    expect(again.status).toBe(200);
    expect(again.body.replayed).toBe(true);
    const original = await api().post("/stock/purchases", body, `sp-finish-${RUN}`);
    expect(original.status).toBe(200);
    expect(original.body.replayed).toBe(true);
    expect(await counts()).toMatchObject({ movements: before.movements + 1 });
    expect((await api().post(`/stock/purchases/missing-${RUN}/finish`, {})).status).toBe(404);
    await booksMatch();
  });

  it("a retry by staff of a purchase the owner switched to his own money is refused: 403, nothing written", async () => {
    const body = { supplierName: "Owner Switch Traders", lines: [{ variantId: cap, quantity: 1, amount: 200 }], documentTotal: 1, paidFrom: { financialAccountId: bkash } };
    hooks.beforePayment = async () => {
      throw financeError(409, "INSUFFICIENT_FUNDS", "bKash was emptied meanwhile");
    };
    const stuck = await api().post("/stock/purchases", body, `sp-switch-${RUN}`);
    expect(stuck.status, JSON.stringify(stuck.body)).toBe(409);
    // /finish by the owner stored "his own money" as how it is paid (and stopped before paying, e.g. the funding awaits approval)
    const entry = await prisma.stockHubEntry.findFirstOrThrow({ where: { idempotencyKey: `purchase:sp-switch-${RUN}` } });
    const steps = entry.steps as { request: { paidFrom: unknown } };
    await prisma.stockHubEntry.update({ where: { id: entry.id }, data: { steps: { ...steps, request: { ...steps.request, paidFrom: { kind: "OWNER", financialAccountId: cashBox, name: "Owner — own money" } } } as never } });

    const before = await counts();
    const noSensitive: FinanceActor = { type: "ADMIN", adminId: admin, label: "manager@test", permissions: PERMISSIONS.filter((p) => p !== "finance.sensitive") };
    // the same request again (its own body says bKash) — but what would run is the stored owner's money
    await expect(recordPurchase(body as never, noSensitive, `sp-switch-${RUN}`)).rejects.toMatchObject({ statusCode: 403 });
    await expect(finishPurchase(entry.id, {} as never, noSensitive)).rejects.toMatchObject({ statusCode: 403 });
    expect(await counts()).toEqual(before);
    const after = await prisma.stockHubEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(after.completedAt).toBeNull();
    expect((after.steps as { paymentMovementId?: string }).paymentMovementId).toBeUndefined();
  });

  it("the list reads the payment's status live and shows amounts only with costing.read", async () => {
    const entry = await prisma.stockHubEntry.findFirstOrThrow({ where: { idempotencyKey: `purchase:sp-oil-${RUN}` } });
    await prisma.stockHubEntry.update({ where: { id: entry.id }, data: { steps: { ...(entry.steps as object), paymentStatus: "PENDING_APPROVAL" } as never } });
    const seen = (await listPurchases({}, { canSeeCost: true })).purchases.find((p) => p.id === entry.id)!;
    expect(seen.paymentStatus).toBe("POSTED");
    expect(seen).toMatchObject({ goods: 12000, total: 12400, lines: [{ amount: 12000, unitCost: 24 }] });
    const hidden = (await listPurchases({}, { canSeeCost: false })).purchases.find((p) => p.id === entry.id)!;
    expect(hidden).toMatchObject({ goods: null, extras: null, total: null, lines: [{ variantId: oil, quantity: 500, amount: null, unitCost: null }], extrasLines: [{ description: "Transport", amount: null }] });
  });
});

describe("Duplicate-purchase warning (blueprint P0.3)", () => {
  it("a purchase like one already entered is warned before saving, saved anyway with its reason, and never refused", async () => {
    const check = await api().post("/stock/purchases/duplicate-check", { supplierName: "Local market", lines: [{ variantId: oil, amount: 12000 }] });
    expect(check.status, JSON.stringify(check.body)).toBe(200);
    expect(check.body.matches.length).toBeGreaterThan(0);
    expect(check.body.matches[0]).toMatchObject({ itemOverlap: 1, totalDifference: 0 });

    const r = await api().post("/stock/purchases", { ...oilPurchase({ financialAccountId: bank }, []), duplicateReason: "second delivery of the same order" }, `sp-dup-${RUN}`);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const receipt = await prisma.goodsReceipt.findUniqueOrThrow({ where: { id: r.body.receiptId ?? r.body.steps?.receiptId } });
    expect((receipt.duplicateWarning as { matches: unknown[] }).matches.length).toBeGreaterThan(0);
    expect(receipt.duplicateReason).toBe("second delivery of the same order");
  });

  it("a different total or another supplier is not a duplicate", async () => {
    const otherTotal = await api().post("/stock/purchases/duplicate-check", { supplierName: "Local market", lines: [{ variantId: oil, amount: 15000 }] });
    expect(otherTotal.body.matches).toEqual([]);
    const unknownSupplier = await api().post("/stock/purchases/duplicate-check", { supplierName: `Nobody ${RUN}`, lines: [{ variantId: oil, amount: 12000 }] });
    expect(unknownSupplier.body.matches).toEqual([]);
  });
});

describe("Bought — the owner's money owed back (owner decision Q14 = B)", () => {
  it("chosen per purchase: owed back raises what the business owes him, capital stays as it was; the books match", async () => {
    const { business } = await getFinanceContext();
    const balanceOf = async (key: string) => {
      const m = await prisma.accountMapping.findUnique({ where: { businessId_key: { businessId: business.id, key } } });
      if (!m) return 0;
      const s = await prisma.journalLine.aggregate({ where: { accountId: m.accountId, entry: { status: "POSTED" } }, _sum: { debit: true, credit: true } });
      return Number(s._sum.credit ?? 0) - Number(s._sum.debit ?? 0);
    };
    const owedBefore = await balanceOf("liability.owner_reimbursable");
    const capitalBefore = await balanceOf("equity.owner_capital");
    const body = { supplierName: `Owed back ${RUN}`, lines: [{ variantId: cap, quantity: 2, amount: 700 }], documentTotal: 2, paidFrom: { ownerPocket: true, funding: "REIMBURSE" } };
    const r = await api().post("/stock/purchases", body, `sp-owed-${RUN}`);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.purchase.paidFrom).toMatchObject({ kind: "OWNER", funding: "REIMBURSE" });
    expect(await balanceOf("liability.owner_reimbursable")).toBe(owedBefore + 700);
    expect(await balanceOf("equity.owner_capital")).toBe(capitalBefore);
    const pocket = r.body.purchase.paidFrom.financialAccountId as string;
    expect(await balance(pocket)).toBe(0); // in and out the same day
    // a replay posts nothing twice
    expect((await api().post("/stock/purchases", body, `sp-owed-${RUN}`)).body.replayed).toBe(true);
    expect(await balanceOf("liability.owner_reimbursable")).toBe(owedBefore + 700);
    // without a choice it stays capital, as before
    const capitalPaid = await api().post("/stock/purchases", { ...body, paidFrom: { ownerPocket: true } }, `sp-owed-capital-${RUN}`);
    expect(capitalPaid.status, JSON.stringify(capitalPaid.body)).toBe(201);
    expect(await balanceOf("equity.owner_capital")).toBe(capitalBefore + 700);
    expect(await balanceOf("liability.owner_reimbursable")).toBe(owedBefore + 700);
    await booksMatch();
  });
});
