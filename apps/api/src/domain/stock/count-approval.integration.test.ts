import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { PERMISSIONS, ROLE_PERMISSIONS } from "@clothing-brand/shared";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { signAccessToken } from "../../lib/jwt";
import { cleanupFixtures, createStockedProduct, ownerId, placeOrder, purgeFinanceTables, RUN, stockOf } from "../../test-fixtures";
import type { FinanceActor } from "../finance/finance-audit";
import { getFinanceContext } from "../finance/finance-context";
import { ensureCommerceAccounting } from "../finance/commerce-setup.service";
import { ensurePurchasingAccounting } from "../finance/purchasing-setup.service";
import { updateBusinessSettings } from "../finance/chart.service";
import { postOpeningBalances, saveOpeningInventory } from "../finance/opening-balances.service";
import { approveCutover, draftCutover, postCutover } from "../finance/inventory-cutover.service";
import { recordCounts } from "./count.service";
import { decideApproval, listApprovals } from "./count-approval.service";

// Smart stock page, task 3: a count loss by staff worth ৳1,000 or more (at the average cost) waits for the owner — the count
// is kept, the stock doesn't move until it is approved, and approval applies the difference recorded at the count. Every
// item is valued at ৳460, so 4 short = ৳1,840 (waits) and 2 short = ৳920 (doesn't).

const CSRF = "vitest-csrf";
let OWNER: FinanceActor;
let STAFF: FinanceActor;
let admin = "";
let staffAdmin = "";
const v: Record<string, string> = {};
let key = 0;
const count = (variantId: string, counted: number, reason: string | null, actor: FinanceActor) =>
  recordCounts({ date: undefined, lines: [{ variantId, counted, reason, note: null }] } as never, actor, `approval-count-${RUN}-${++key}`);

beforeAll(async () => {
  await purgeFinanceTables();
  admin = await ownerId();
  OWNER = { type: "ADMIN", adminId: admin, label: "owner@test", permissions: [...PERMISSIONS] };
  staffAdmin = (await prisma.adminUser.create({ data: { name: "Vitest counter", email: `count-staff-${RUN}@example.com`, passwordHash: "x", role: "STAFF" } })).id;
  STAFF = { type: "ADMIN", adminId: staffAdmin, label: "staff@test", permissions: [...ROLE_PERMISSIONS.STAFF] };
  await ensureCommerceAccounting(OWNER);
  await ensurePurchasingAccounting(OWNER);
  await updateBusinessSettings({ openingDate: "2026-09-01", reason: "books start" }, OWNER);
  const brandId = (await getFinanceContext()).brand.id;
  const opening = [];
  for (const name of ["pending", "owner", "small", "gain", "moved", "twice", "reject", "http"]) {
    const p = await createStockedProduct({ stocks: [10], basePrice: 900 });
    v[name] = p.variants[0]!.id;
    opening.push({ variantId: v[name]!, sku: p.variants[0]!.sku, name, quantity: 10, unitCost: 460, valuationStatus: "KNOWN", valuationMethod: "SUPPLIER_INVOICE", valuationSource: "INV", valuationDate: "2026-09-01", brandId });
  }
  await saveOpeningInventory(opening as never, OWNER);
  await postOpeningBalances(OWNER);
  await draftCutover({}, OWNER);
  await approveCutover({ acknowledgeMissing: true }, OWNER);
  await postCutover(OWNER);
});

afterAll(async () => {
  await purgeFinanceTables();
  await cleanupFixtures();
  await prisma.adminUser.deleteMany({ where: { id: staffAdmin } });
});

describe("who waits", () => {
  it("A-1: staff, 4 short (৳1,840) → waits; the count is kept, stock unchanged", async () => {
    const r = await count(v.pending!, 6, "DAMAGED", STAFF);
    expect(r.lines[0]).toMatchObject({ expected: 10, counted: 6, difference: -4, movementId: null });
    expect(r.lines[0]!.pendingApprovalId).toEqual(expect.any(String));
    expect(await stockOf(v.pending!)).toBe(10);
    expect(await prisma.stockCount.count({ where: { variantId: v.pending! } })).toBe(1);
    const pending = await listApprovals({ status: "PENDING" }, { canSeeCost: true });
    expect(pending.approvals.find((a) => a.variantId === v.pending)).toMatchObject({ difference: -4, reason: "DAMAGED", value: 1840, status: "PENDING" });
  });

  it("A-2: the owner's own count never waits", async () => {
    const r = await count(v.owner!, 6, "DAMAGED", OWNER);
    expect(r.lines[0]!.pendingApprovalId).toBeNull();
    expect(await stockOf(v.owner!)).toBe(6);
  });

  it("A-3: staff, 2 short (৳920) → under the limit, booked at once", async () => {
    const r = await count(v.small!, 8, "LOST", STAFF);
    expect(r.lines[0]!.pendingApprovalId).toBeNull();
    expect(await stockOf(v.small!)).toBe(8);
  });

  it("A-4: a gain never waits", async () => {
    const r = await count(v.gain!, 13, "FOUND", STAFF);
    expect(r.lines[0]!.pendingApprovalId).toBeNull();
    expect(await stockOf(v.gain!)).toBe(13);
  });
});

describe("deciding", () => {
  it("A-5: approval applies the recorded −4, even after 2 more were sold", async () => {
    const r = await count(v.moved!, 6, "DAMAGED", STAFF);
    await placeOrder([{ variantId: v.moved!, quantity: 2 }]);
    expect(await stockOf(v.moved!)).toBe(8);
    const d = await decideApproval(r.lines[0]!.pendingApprovalId!, { decision: "APPROVE", note: null }, OWNER);
    expect(d).toMatchObject({ status: "APPROVED", replayed: false });
    expect(await stockOf(v.moved!)).toBe(4);
  });

  it("A-6: approving twice moves the stock once", async () => {
    const r = await count(v.twice!, 6, "LOST", STAFF);
    const id = r.lines[0]!.pendingApprovalId!;
    await decideApproval(id, { decision: "APPROVE", note: null }, OWNER);
    const again = await decideApproval(id, { decision: "APPROVE", note: null }, OWNER);
    expect(again.replayed).toBe(true);
    expect(await stockOf(v.twice!)).toBe(6);
    await expect(decideApproval(id, { decision: "REJECT", note: "changed my mind" }, OWNER)).rejects.toMatchObject({ statusCode: 409, details: { code: "APPROVAL_DECIDED" } });
  });

  it("A-7: rejecting keeps the count and leaves the stock", async () => {
    const r = await count(v.reject!, 6, "DAMAGED", STAFF);
    const d = await decideApproval(r.lines[0]!.pendingApprovalId!, { decision: "REJECT", note: "recount tomorrow" }, OWNER);
    expect(d.status).toBe("REJECTED");
    expect(await stockOf(v.reject!)).toBe(10);
    expect(await prisma.stockCount.count({ where: { variantId: v.reject! } })).toBe(1);
  });

  it("A-8: staff can't decide (403); the owner can over HTTP", async () => {
    const r = await count(v.http!, 6, "DAMAGED", STAFF);
    const id = r.lines[0]!.pendingApprovalId!;
    const as = (role: string) => (t: request.Test) => t.set("Cookie", [`access_token=${signAccessToken({ adminId: role === "STAFF" ? staffAdmin : admin, role: role as never })}`, `csrf_token=${CSRF}`]).set("X-CSRF-Token", CSRF);
    expect((await as("STAFF")(request(app).post(`/api/v1/finance/stock/approvals/${id}/decision`)).send({ decision: "APPROVE" })).status).toBe(403);
    const ok = await as("OWNER")(request(app).post(`/api/v1/finance/stock/approvals/${id}/decision`)).send({ decision: "APPROVE" });
    expect(ok.status).toBe(200);
    expect(await stockOf(v.http!)).toBe(6);
    const list = await as("STAFF")(request(app).get("/api/v1/finance/stock/approvals?status=PENDING"));
    expect(list.status).toBe(200);
  });
});
