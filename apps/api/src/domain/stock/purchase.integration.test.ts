import { describe, it, expect, beforeAll, afterAll } from "vitest";
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
import { ensureManufacturingSetup } from "../manufacturing/manufacturing-setup.service";
import { createMaterial } from "../manufacturing/materials.service";
import { recordPurchase } from "./purchase.service";

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

const oilPurchase = (paidFrom: object, extras = [{ description: "Transport", amount: 400 }]) => ({ lines: [{ variantId: oil, quantity: 500, amount: 12000 }], extras, paidFrom });

describe("Bought — before go-live", () => {
  it("refused before costing is active, with the reason, and nothing is written", async () => {
    const before = await counts();
    const r = await api().post("/stock/purchases", oilPurchase({ financialAccountId: bank }), `sp-early-${RUN}`);
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body.details?.code).toBe("COSTING_NOT_ACTIVE");
    expect(r.body.error).toMatch(/go-live/);
    expect(await counts()).toEqual(before);
    expect(await prisma.stockHubEntry.count()).toBe(0);
  });

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
    const body = { lines: [{ variantId: bottle, quantity: 166, amount: 8300 }], paidFrom: { financialAccountId: bank } };
    const [a, b] = await Promise.all([api().post("/stock/purchases", body, `sp-tap-${RUN}`), api().post("/stock/purchases", body, `sp-tap-${RUN}`)]);
    expect([a.status, b.status].sort(), JSON.stringify([a.body, b.body])).toEqual(expect.arrayContaining([201]));
    for (const x of [a, b]) expect([200, 201, 409]).toContain(x.status);
    const settled = await api().post("/stock/purchases", body, `sp-tap-${RUN}`);
    expect(settled.body.replayed).toBe(true);
    expect(await counts()).toMatchObject({ receipts: before.receipts + 1, bills: before.bills + 1, movements: before.movements + 1 });
    expect(await stock(bottle)).toBe(166);
    expect(await avg(bottle)).toBe(50);

    // the same key for a different purchase is refused
    const other = await api().post("/stock/purchases", { ...body, lines: [{ variantId: bottle, quantity: 1, amount: 50 }] }, `sp-tap-${RUN}`);
    expect(other.status).toBe(409);
    expect(other.body.details?.code).toBe("IDEMPOTENCY_KEY_REUSED");
    await booksMatch();
  });

  it("paid from bKash lowers its balance; a payment refused mid-way resumes on retry without writing twice", async () => {
    const body = { supplierName: "Chawkbazar Bottle House", reference: "INV-77", lines: [{ variantId: cap, quantity: 3, amount: 1000 }], paidFrom: { financialAccountId: bkash } };
    const before = await counts();
    const short = await api().post("/stock/purchases", body, `sp-bkash-${RUN}`);
    expect(short.status, JSON.stringify(short.body)).toBe(409);
    expect(short.body.details?.code).toBe("INSUFFICIENT_FUNDS"); // bKash holds 100
    // the goods arrived and the bill is entered; the list shows it unpaid
    const listed = (await api().get("/stock/purchases")).body.purchases.find((p: { supplier: { name: string } }) => p.supplier.name === "Chawkbazar Bottle House");
    expect(listed).toMatchObject({ complete: false, total: 1000 });
    expect(await stock(cap)).toBe(3);
    // a crash between a step and its bookkeeping: the receipt and bill are found again by their stamp
    const entry = await prisma.stockHubEntry.findFirstOrThrow({ where: { idempotencyKey: `purchase:sp-bkash-${RUN}` } });
    const steps = entry.steps as Record<string, unknown>;
    await prisma.stockHubEntry.update({ where: { id: entry.id }, data: { steps: { ...steps, receiptId: undefined, invoiceId: undefined } as never } });

    await ownerMoney({ kind: "INVEST", financialAccountId: bkash, amount: 2000, note: "top up" }, OWNER, `sp-topup-${RUN}`);
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
    const r = await api().post("/stock/purchases", oilPurchase({ ownerPocket: true }, [{ description: "Rickshaw", amount: 100 }]), `sp-owner-${RUN}`);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(await capitalOf()).toBe(capitalBefore + 12100);
    expect(await balance(cashBox)).toBe(cashBefore); // in and out the same day
    expect(r.body.purchase.paidFrom).toMatchObject({ kind: "OWNER", financialAccountId: cashBox });
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
    const r = await api().post("/stock/purchases", { lines: [{ variantId: untracked.variants[0]!.id, quantity: 1, amount: 10 }], paidFrom: { financialAccountId: bank } }, `sp-untracked-${RUN}`);
    expect(r.status).toBe(400);
    const clerk: FinanceActor = { type: "ADMIN", adminId: admin, label: "clerk@test", permissions: ["purchasing.receive", "purchasing.read"] };
    await expect(recordPurchase({ lines: [{ variantId: oil, quantity: 1, amount: 10 }], paidFrom: { financialAccountId: bank } }, clerk, `sp-clerk-${RUN}`)).rejects.toMatchObject({ statusCode: 403 });
    const noKey = await api().post("/stock/purchases", oilPurchase({ financialAccountId: bank }));
    expect(noKey.status).toBe(400);
  });
});
