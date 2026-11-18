import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { signAccessToken } from "../../lib/jwt";
import { asOwner } from "../../test-fixtures";

// Monthly targets (docs/superpowers/plans/2026-11-18-business-reports.md, Part 1). Far-past months so a real month's
// target on the test database is never touched.
const MONTH = "2011-03";
const EMPTY_MONTH = "2011-04";
const CSRF = "vitest-targets";
let staffId = "";

function asStaff() {
  const cookie = [`access_token=${signAccessToken({ adminId: staffId, role: "STAFF" })}`, `csrf_token=${CSRF}`];
  return {
    get: (url: string) => request(app).get(url).set("Cookie", cookie).set("X-CSRF-Token", CSRF),
    put: (url: string, body: object) => request(app).put(url).set("Cookie", cookie).set("X-CSRF-Token", CSRF).send(body),
  };
}

beforeAll(async () => {
  const staff = await prisma.adminUser.create({ data: { name: "Vitest Targets Staff", email: `vt-targets-${Date.now()}@example.com`, passwordHash: "x", role: "STAFF" } });
  staffId = staff.id;
});

afterAll(async () => {
  await prisma.monthlyTarget.deleteMany({ where: { month: { in: [MONTH, EMPTY_MONTH] } } });
  if (staffId) await prisma.adminUser.delete({ where: { id: staffId } });
  await prisma.$disconnect();
});

describe("monthly targets", () => {
  it("the owner sets a month's targets and reads them back with the month's progress", async () => {
    const owner = await asOwner();
    const put = await owner.put(`/api/targets/${MONTH}`, { netSales: 150000, orders: 200, profit: 30000 });
    expect(put.status).toBe(200);

    const res = await owner.get(`/api/targets/${MONTH}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ month: MONTH, daysInMonth: 31, elapsedDays: 31, finished: true });
    expect(res.body.netSales).toMatchObject({ target: 150000, actual: expect.any(Number), status: expect.stringMatching(/met|missed/) });
    expect(res.body.orders).toMatchObject({ target: 200, actual: expect.any(Number) });
    expect(res.body.profit).toMatchObject({ target: 30000 });
    expect(res.body.updatedBy).toEqual(expect.any(String));
  });

  it("clearing one target keeps the others", async () => {
    const owner = await asOwner();
    expect((await owner.put(`/api/targets/${MONTH}`, { netSales: 150000, orders: null, profit: 30000 })).status).toBe(200);
    const res = await owner.get(`/api/targets/${MONTH}`);
    expect(res.body.orders).toMatchObject({ target: null, status: "no-target" });
    expect(res.body.netSales.target).toBe(150000);
  });

  it("a month without targets still shows its figures", async () => {
    const res = await (await asOwner()).get(`/api/targets/${EMPTY_MONTH}`);
    expect(res.status).toBe(200);
    expect(res.body.netSales).toMatchObject({ target: null, status: "no-target", actual: expect.any(Number) });
    expect(res.body.updatedBy).toBeNull();
  });

  it("refuses a bad month and a target that isn't a positive number", async () => {
    const owner = await asOwner();
    expect((await owner.get("/api/targets/2011-13")).status).toBe(400);
    expect((await owner.put("/api/targets/nov-2011", { netSales: 1 })).status).toBe(400);
    expect((await owner.put(`/api/targets/${MONTH}`, { netSales: -5 })).status).toBe(400);
    expect((await owner.put(`/api/targets/${MONTH}`, { orders: 2.5 })).status).toBe(400);
  });

  it("staff see sales and orders progress but not profit, and can't set targets", async () => {
    const staff = asStaff();
    const res = await staff.get(`/api/targets/${MONTH}`);
    expect(res.status).toBe(200);
    expect(res.body.netSales.target).toBe(150000);
    expect(res.body.profit).toBeNull();
    expect((await staff.put(`/api/targets/${MONTH}`, { netSales: 1 })).status).toBe(403);
  });

  it("refuses an anonymous caller", async () => {
    expect((await request(app).get(`/api/targets/${MONTH}`)).status).toBe(401);
  });
});
