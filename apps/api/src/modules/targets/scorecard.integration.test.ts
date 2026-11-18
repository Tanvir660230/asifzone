import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { signAccessToken } from "../../lib/jwt";
import { asOwner } from "../../test-fixtures";

// The one-page business scorecard (docs/superpowers/plans/2026-11-18-business-reports.md, Part 2).
const MONTH = "2011-06";
const CSRF = "vitest-scorecard";
let staffId = "";

beforeAll(async () => {
  staffId = (await prisma.adminUser.create({ data: { name: "Vitest Scorecard Staff", email: `vt-scorecard-${Date.now()}@example.com`, passwordHash: "x", role: "STAFF" } })).id;
  await prisma.monthlyTarget.upsert({ where: { month: MONTH }, create: { month: MONTH, netSales: 100000, orders: 50 }, update: { netSales: 100000, orders: 50 } });
});

afterAll(async () => {
  await prisma.monthlyTarget.deleteMany({ where: { month: MONTH } });
  if (staffId) await prisma.adminUser.delete({ where: { id: staffId } });
  await prisma.$disconnect();
});

describe("business scorecard", () => {
  it("gives the owner every figure with its earlier-period value and a status", async () => {
    const res = await (await asOwner()).get(`/api/targets/${MONTH}/scorecard`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ month: MONTH, range: { from: "2011-06-01", to: "2011-06-30" }, previousRange: { from: "2011-05-02", to: "2011-05-31" } });
    const keys = res.body.figures.map((f: { key: string }) => f.key);
    expect(keys).toEqual(["netSales", "orders", "aov", "deliverySuccess", "returnRate", "cancelledOrders", "profit", "adSpend", "salesPerAdTaka"]);
    for (const f of res.body.figures) {
      expect(f).toMatchObject({ label: expect.any(String), unit: expect.stringMatching(/money|count|ratio|times/), status: expect.stringMatching(/good|watch|bad|neutral/) });
      expect(typeof f.value === "number" || f.value === null).toBe(true);
    }
    // the targets set for the month decide sales and orders
    const sales = res.body.figures.find((f: { key: string }) => f.key === "netSales");
    expect(sales.target).toBe(100000);
    expect(res.body.money).toMatchObject({ cash: expect.any(Number), owedToYou: expect.any(Number), youOwe: expect.any(Number), stock: expect.any(Number) });
  });

  it("staff see the selling figures but no money, profit or ads", async () => {
    const cookie = [`access_token=${signAccessToken({ adminId: staffId, role: "STAFF" })}`, `csrf_token=${CSRF}`];
    const res = await request(app).get(`/api/targets/${MONTH}/scorecard`).set("Cookie", cookie).set("X-CSRF-Token", CSRF);
    expect(res.status).toBe(200);
    expect(res.body.figures.map((f: { key: string }) => f.key)).toEqual(["netSales", "orders", "aov", "deliverySuccess", "returnRate", "cancelledOrders"]);
    expect(res.body.money).toBeNull();
  });

  it("refuses a bad month and an anonymous caller", async () => {
    expect((await (await asOwner()).get("/api/targets/2011-00/scorecard")).status).toBe(400);
    expect((await request(app).get(`/api/targets/${MONTH}/scorecard`)).status).toBe(401);
  });
});
