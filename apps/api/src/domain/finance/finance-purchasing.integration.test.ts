import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import request from "supertest";
import { PURCHASING_MAPPING_KEYS } from "@clothing-brand/shared";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { signAccessToken } from "../../lib/jwt";
import { cleanupFixtures, createStockedProduct, ownerId, purgeFinanceTables, RUN } from "../../test-fixtures";
import { adjustVariantStock } from "../../modules/inventory/inventory.service";
import { getFinanceContext } from "./finance-context";
import { financeTransaction } from "./finance-tx";
import { recordValuationInTx, type CostOperation } from "./costing.service";

// Financial Core Phase 4A (docs/FINANCE_PHASE_4.md): purchasing set-up, the supplier master, purchase tax codes and the
// valuation ledger's persistence and database invariants — against the real database. Costing is not wired into
// inventory yet (4B), which this suite also pins.

const CSRF = "vitest-csrf";
type Role = "OWNER" | "STAFF" | "FINANCE_ADMIN" | "ACCOUNTANT" | "FINANCE_VIEWER";
function agent(adminId: string, role: Role) {
  const cookie = [`access_token=${signAccessToken({ adminId, role })}`, `csrf_token=${CSRF}`];
  const auth = (r: request.Test) => r.set("Cookie", cookie).set("X-CSRF-Token", CSRF);
  return {
    get: (url: string) => auth(request(app).get(`/api/v1/purchasing${url}`)),
    post: (url: string, body: object = {}) => auth(request(app).post(`/api/v1/purchasing${url}`)).send(body),
    patch: (url: string, body: object = {}) => auth(request(app).patch(`/api/v1/purchasing${url}`)).send(body),
  };
}
const madeAdmins: string[] = [];
async function adminWith(role: Exclude<Role, "OWNER">) {
  const a = await prisma.adminUser.create({ data: { name: `P4 ${role}`, email: `p4-${role.toLowerCase()}-${RUN}@example.com`, passwordHash: await bcrypt.hash("x", 4), role } });
  madeAdmins.push(a.id);
  return agent(a.id, role);
}
async function purge(sql: string) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL finance.maintenance_purge = 'on'`);
    await tx.$executeRawUnsafe(sql);
  });
}

let owner: ReturnType<typeof agent>;

beforeAll(async () => {
  await purgeFinanceTables();
  owner = agent(await ownerId(), "OWNER");
  await getFinanceContext();
});

afterAll(async () => {
  await purgeFinanceTables(); // the valuation ledger first: it protects the test variants from deletion
  await cleanupFixtures();
  await prisma.adminUser.deleteMany({ where: { id: { in: madeAdmins } } });
});

describe("purchasing accounts", () => {
  it("a new business gets every purchasing account and mapping from the template, aliases included", async () => {
    const { business } = await getFinanceContext();
    const maps = await prisma.accountMapping.findMany({ where: { businessId: business.id, key: { in: [...PURCHASING_MAPPING_KEYS] } }, include: { account: true } });
    const byKey = new Map(maps.map((m) => [m.key, m.account.code]));
    expect(Object.fromEntries([...byKey].sort())).toEqual({
      "asset.inventory": "1610", "asset.vat_input": "1710", "cogs.cost_adjustments": "5150", "cogs.count_adjustments": "5210",
      "cogs.inventory_shrinkage": "5200", "cogs.purchase_price_differences": "5150", "expense.freight_in": "6650",
      "expense.non_recoverable_tax": "6960", "expense.purchases_other": "6900", "income.purchase_discounts": "7200",
      "liability.grni": "2115", "liability.payable_trade": "2110", "liability.supplier_returns": "2115",
    });
    expect((await owner.get("/status")).body.readiness).toEqual({ ready: true, missing: [] });
  });

  it("an existing business is brought up to date once, without touching what the owner changed", async () => {
    const { business } = await getFinanceContext();
    // An older business: no 2115 / 5150 yet, 1710 unmapped.
    await purge(`DELETE FROM "AccountMapping" WHERE "businessId" = '${business.id}' AND key IN ('liability.grni','liability.supplier_returns','cogs.cost_adjustments','cogs.purchase_price_differences','asset.vat_input')`);
    await purge(`DELETE FROM "LedgerAccount" WHERE "businessId" = '${business.id}' AND code IN ('2115','5150')`);
    expect((await owner.get("/status")).body.readiness.ready).toBe(false);
    const first = await owner.post("/setup");
    expect(first.status).toBe(200);
    expect(first.body.changes.sort()).toEqual(["account 2115", "account 5150", "mapping asset.vat_input", "mapping cogs.cost_adjustments", "mapping cogs.purchase_price_differences", "mapping liability.grni", "mapping liability.supplier_returns"].sort());
    expect(first.body.missing).toEqual([]);
    const again = await owner.post("/setup");
    expect(again.body.changes).toEqual([]);
    const audits = await prisma.financeAuditEntry.count({ where: { businessId: business.id, reason: "Phase 4 purchasing accounting set-up" } });
    expect(audits).toBe(7);
  });
});

describe("suppliers", () => {
  it("are created with a permanent code, edited with an audit trail, put on hold with a reason — never deleted", async () => {
    const a = await owner.post("/suppliers", { legalName: "Dhaka Fabrics Ltd", contactName: "Rahim", phone: "01711000000", paymentTermsDays: 30, creditLimit: 50000.5 });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ code: "SUP-0001", displayName: "Dhaka Fabrics Ltd", currency: "BDT", status: "ACTIVE", paymentTermsDays: 30, creditLimit: 50000.5 });
    const b = await owner.post("/suppliers", { legalName: "Chittagong Trims", code: "ctg-trims" });
    expect(b.body.code).toBe("CTG-TRIMS");
    expect((await owner.post("/suppliers", { legalName: "Another", code: "CTG-TRIMS" })).status).toBe(409);
    expect((await owner.post("/suppliers", { legalName: "Bad code", code: "x" })).status).toBe(400);
    expect((await owner.post("/suppliers", { legalName: "Dollar supplier", currency: "USD" })).body.details.code).toBe("SUPPLIER_CURRENCY");
    const inventory = await prisma.ledgerAccount.findFirstOrThrow({ where: { code: "1610" } });
    expect((await owner.post("/suppliers", { legalName: "Wrong default", defaultExpenseAccountId: inventory.id })).body.details.code).toBe("SUPPLIER_EXPENSE_ACCOUNT");

    const edited = await owner.patch(`/suppliers/${a.body.id}`, { displayName: "DF", email: "orders@df.example.com", code: "HACK-1" });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ displayName: "DF", email: "orders@df.example.com", code: "SUP-0001" }); // the code isn't editable
    expect((await owner.post(`/suppliers/${a.body.id}/status`, { status: "ON_HOLD" })).status).toBe(400); // needs a reason
    const held = await owner.post(`/suppliers/${a.body.id}/status`, { status: "ON_HOLD", reason: "Quality dispute" });
    expect(held.body).toMatchObject({ status: "ON_HOLD", statusReason: "Quality dispute" });
    expect((await owner.get("/suppliers?q=df")).body.suppliers.map((s: { id: string }) => s.id)).toContain(a.body.id);
    expect((await owner.get("/suppliers?status=ON_HOLD")).body.total).toBe(1);

    const actions = (await prisma.financeAuditEntry.findMany({ where: { entityType: "Supplier", entityId: a.body.id }, orderBy: { createdAt: "asc" } })).map((e) => e.action);
    expect(actions).toEqual(["supplier.create", "supplier.update", "supplier.status"]);
    // The database holds identity and history.
    await expect(prisma.supplier.delete({ where: { id: a.body.id } })).rejects.toThrow(/never deleted/);
    await expect(financeTransaction(async (tx) => {
      await tx.financeAuditEntry.create({ data: { actorType: "SYSTEM", actorLabel: "t", action: "x", entityType: "Supplier", entityId: a.body.id } });
      await tx.supplier.update({ where: { id: a.body.id }, data: { code: "SUP-9999" } });
    })).rejects.toThrow(/code never changes/);
    await expect(prisma.supplier.update({ where: { id: a.body.id }, data: { notes: "unaudited" } })).rejects.toThrow(/FINANCE_AUDIT_REQUIRED|without a financial audit entry/);
  });
});

describe("purchase tax codes", () => {
  it("rate, recoverable share and accounts are permanent; name and status are not", async () => {
    const vat = await owner.post("/tax-codes", { code: "vat15", name: "VAT 15%", rate: "15", recoverablePct: 100 });
    expect(vat.status).toBe(201);
    expect(vat.body).toMatchObject({ code: "VAT15", rate: "15", recoverablePct: "100", recoverableMappingKey: "asset.vat_input", nonRecoverableMappingKey: "expense.non_recoverable_tax", isActive: true });
    expect((await owner.post("/tax-codes", { code: "VAT15", name: "dup", rate: 5, recoverablePct: 0 })).status).toBe(409);
    expect((await owner.post("/tax-codes", { code: "BAD", name: "too high", rate: "100.5", recoverablePct: 0 })).status).toBe(400);
    expect((await owner.post("/tax-codes", { code: "BAD2", name: "too precise", rate: "7.12345", recoverablePct: 0 })).status).toBe(400);
    expect((await owner.post("/tax-codes", { code: "BAD3", name: "wrong account", rate: 5, recoverablePct: 50, recoverableMappingKey: "cogs.goods" })).body.details.code).toBe("TAX_CODE_ACCOUNT_TYPE");
    expect((await owner.post("/tax-codes", { code: "BAD4", name: "unknown key", rate: 5, recoverablePct: 50, recoverableMappingKey: "nope.key" })).status).toBe(400);
    const half = await owner.post("/tax-codes", { code: "AIT5", name: "Advance tax 5%", rate: "5.5", recoverablePct: "37.5" });
    expect(half.body).toMatchObject({ rate: "5.5", recoverablePct: "37.5" });

    const renamed = await owner.patch(`/tax-codes/${vat.body.id}`, { name: "VAT (standard)", isActive: false, rate: 10 });
    expect(renamed.body).toMatchObject({ name: "VAT (standard)", isActive: false, rate: "15" });
    expect((await owner.get("/tax-codes?activeOnly=true")).body.taxCodes.map((t: { code: string }) => t.code)).toEqual(["AIT5"]);
    // An inactive code can't become a supplier default.
    expect((await owner.post("/suppliers", { legalName: "Uses inactive tax", defaultTaxCodeId: vat.body.id })).body.details.code).toBe("TAX_CODE_INACTIVE");
    await expect(financeTransaction(async (tx) => {
      await tx.financeAuditEntry.create({ data: { actorType: "SYSTEM", actorLabel: "t", action: "x", entityType: "TaxCode", entityId: vat.body.id } });
      await tx.taxCode.update({ where: { id: vat.body.id }, data: { rate: 10 } });
    })).rejects.toThrow(/never change/);
    await expect(prisma.taxCode.delete({ where: { id: vat.body.id } })).rejects.toThrow(/never deleted/);
  });
});

describe("permissions (server-side)", () => {
  it("STAFF manages suppliers but not purchasing configuration; finance roles get their share", async () => {
    const [staff, fadmin, accountant, viewer] = await Promise.all([adminWith("STAFF"), adminWith("FINANCE_ADMIN"), adminWith("ACCOUNTANT"), adminWith("FINANCE_VIEWER")]);
    expect((await staff.post("/suppliers", { legalName: "Staff-made supplier" })).status).toBe(201);
    expect((await staff.get("/suppliers")).status).toBe(200);
    expect((await staff.get("/tax-codes")).status).toBe(200);
    expect((await staff.post("/tax-codes", { code: "S1", name: "staff", rate: 1, recoverablePct: 0 })).status).toBe(403);
    expect((await staff.post("/setup")).status).toBe(403);
    expect((await accountant.post("/suppliers", { legalName: "Accountant-made supplier" })).status).toBe(201);
    expect((await viewer.get("/suppliers")).status).toBe(200);
    expect((await viewer.post("/suppliers", { legalName: "Viewer can't" })).status).toBe(403);
    expect((await fadmin.post("/tax-codes", { code: "F1", name: "fa", rate: 1, recoverablePct: 0 })).status).toBe(403);
    expect((await fadmin.get("/status")).status).toBe(200);
  });
});

describe("the valuation ledger (persistence and database invariants)", () => {
  async function variantWithStock(stock: number) {
    const p = await createStockedProduct({ stocks: [stock], basePrice: 500 });
    const v = p.variants[0]!;
    const movement = await prisma.stockMovement.findFirstOrThrow({ where: { variantId: v.id } });
    return { variant: v, movement };
  }
  async function value(variantId: string, op: CostOperation, stockMovementId: string | null = null, sourceId = "t") {
    const ctx = await getFinanceContext();
    return financeTransaction((tx) => recordValuationInTx(tx, { business: ctx.business, brandId: ctx.brand.id, variantId, stockMovementId, sourceType: "Test", sourceId, financialDate: "2026-10-14", op }));
  }

  it("records entries and the running position exactly, in decimals", async () => {
    const { variant, movement } = await variantWithStock(10);
    const r1 = await value(variant.id, { type: "INFLOW", qty: 10, valueMinor: 100_000, basis: "DOCUMENT" }, movement.id);
    await value(variant.id, { type: "INFLOW", qty: 5, valueMinor: 65_000, basis: "DOCUMENT" });
    const r3 = await value(variant.id, { type: "OUTFLOW", qty: 16, basis: { kind: "SNAPSHOT", unitCostMinor: 11_000 } });
    expect(r3.figures).toMatchObject({ deficitQtyChange: 1, valuationStatus: "ESTIMATED" });
    const state = await prisma.inventoryCostState.findUniqueOrThrow({ where: { variantId: variant.id } });
    expect({ valuedQty: state.valuedQty, value: state.value.toString(), avg: state.avgUnitCost?.toString(), deficit: state.deficitQty, layers: state.deficitLayers }).toEqual({
      valuedQty: 0, value: "0", avg: "110", deficit: 1, layers: [{ qty: 1, unitCostMinor: 11_000 }],
    });
    const entries = await prisma.inventoryValuationEntry.findMany({ where: { variantId: variant.id }, orderBy: { sequence: "asc" } });
    expect(entries.map((e) => [e.kind, e.qtyChange, e.valueChange.toString(), e.bookValue.toString(), e.costAdjustment.toString(), e.valueAfter.toString(), e.avgAfter?.toString()])).toEqual([
      ["INFLOW", 10, "1000", "1000", "0", "1000", "100"],
      ["INFLOW", 5, "650", "650", "0", "1650", "110"],
      ["OUTFLOW", -16, "-1650", "-1760", "110", "0", "110"],
    ]);
    expect(entries[0]!.stockMovementId).toBe(movement.id);
    expect(r1.sequence < r3.sequence).toBe(true);
    expect(state.lastEntryId).toBe(entries[2]!.id);
  });

  it("is append-only, continuous, and the cost state can't drift from its latest entry", async () => {
    const { variant, movement } = await variantWithStock(4);
    const r = await value(variant.id, { type: "INFLOW", qty: 4, valueMinor: 4_000, basis: "DOCUMENT" }, movement.id);
    await expect(prisma.inventoryValuationEntry.update({ where: { id: r.entryId }, data: { note: "edited" } })).rejects.toThrow(/append-only/);
    await expect(prisma.inventoryValuationEntry.delete({ where: { id: r.entryId } })).rejects.toThrow(/append-only/);
    await expect(prisma.inventoryCostState.update({ where: { variantId: variant.id }, data: { value: 1 } })).rejects.toThrow(/latest valuation entry/);
    await expect(prisma.inventoryCostState.delete({ where: { variantId: variant.id } })).rejects.toThrow(/never deleted/);
    const ctx = await getFinanceContext();
    const base = { businessId: ctx.business.id, brandId: ctx.brand.id, variantId: variant.id, valueChange: 1, bookValue: 1, costAdjustment: 0, costBasis: "MANUAL", valuationStatus: "KNOWN" as const, unvaluedAfter: 0, deficitAfter: 0, sourceType: "Test", sourceId: "forged", financialDate: new Date("2026-10-14") };
    // An entry that doesn't continue from the state (claims 100 units before it)…
    await expect(prisma.inventoryValuationEntry.create({ data: { ...base, kind: "INFLOW", qtyChange: 1, qtyAfter: 101, valueAfter: 41 } })).rejects.toThrow(/does not continue/);
    // …a second cutover…
    await expect(prisma.inventoryValuationEntry.create({ data: { ...base, kind: "CUTOVER", qtyChange: 1, qtyAfter: 5, valueAfter: 41 } })).rejects.toThrow(/first entry only/);
    // …and an entry breaking the adjustment rule.
    await expect(prisma.inventoryValuationEntry.create({ data: { ...base, kind: "INFLOW", qtyChange: 1, qtyAfter: 5, valueAfter: 41, costAdjustment: 5 } })).rejects.toThrow(/adjustment_rule/);
  });

  it("concurrent movements of one variant are costed one after another — nothing lost, the chain unbroken", async () => {
    const { variant } = await variantWithStock(1);
    await value(variant.id, { type: "INFLOW", qty: 2, valueMinor: 2_000, basis: "DOCUMENT" });
    await Promise.all(Array.from({ length: 8 }, (_, i) => value(variant.id, { type: "INFLOW", qty: 1, valueMinor: 1_000 + i, basis: "DOCUMENT" }, null, `c${i}`)));
    const state = await prisma.inventoryCostState.findUniqueOrThrow({ where: { variantId: variant.id } });
    expect(state.valuedQty).toBe(10);
    expect(state.value.toString()).toBe(String((2_000 + 8 * 1_000 + 28) / 100));
    expect(await prisma.inventoryValuationEntry.count({ where: { variantId: variant.id } })).toBe(9);
  });

  it("a variant or stock movement with valuation history can't be hard-deleted", async () => {
    const { variant, movement } = await variantWithStock(3);
    await value(variant.id, { type: "INFLOW", qty: 3, valueMinor: 3_000, basis: "DOCUMENT" }, movement.id);
    await expect(prisma.stockMovement.delete({ where: { id: movement.id } })).rejects.toThrow();
    await expect(prisma.productVariant.delete({ where: { id: variant.id } })).rejects.toThrow();
    expect(await prisma.productVariant.count({ where: { id: variant.id } })).toBe(1);
  });

  it("4A is inert: stock movements don't write the valuation ledger yet (costing is wired and activated in 4B)", async () => {
    const { variant } = await variantWithStock(5);
    await adjustVariantStock(variant.id, 3, "RESTOCK", await ownerId(), "4A inert check");
    await adjustVariantStock(variant.id, -1, "DAMAGED", await ownerId(), "4A inert check");
    expect(await prisma.inventoryValuationEntry.count({ where: { variantId: variant.id } })).toBe(0);
    expect(await prisma.inventoryCostState.count({ where: { variantId: variant.id } })).toBe(0);
  });
});
