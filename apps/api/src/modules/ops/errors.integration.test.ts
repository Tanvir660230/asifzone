import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { signAccessToken } from "../../lib/jwt";
import { asOwner } from "../../test-fixtures";
import { adminAttention } from "../admin-home/attention.service";
import { countOpenErrors } from "./errors.service";

const RUN = `err${Date.now().toString(36)}`;
const HOUR = 60 * 60 * 1000;
let staffId: string;
const ids: Record<string, string> = {};

async function group(tag: string, data: { lastSeenAt: Date; resolvedAt?: Date | null; source?: string }) {
  const row = await prisma.errorGroup.create({
    data: {
      fingerprint: `${RUN}-${tag}`,
      source: data.source ?? "api",
      errorClass: "unexpected",
      title: `Error: ${RUN} ${tag}`,
      sampleStack: `Error: ${RUN} ${tag}\n    at x (src/a.ts)`,
      lastPath: "POST /api/orders/",
      lastCorrelationId: "corr-12345678",
      count: 3,
      lastSeenAt: data.lastSeenAt,
      resolvedAt: data.resolvedAt ?? null,
    },
  });
  ids[tag] = row.id;
}

beforeAll(async () => {
  const now = Date.now();
  await group("fresh", { lastSeenAt: new Date(now - HOUR), source: "web" });
  await group("old", { lastSeenAt: new Date(now - 30 * HOUR) });
  await group("fixed", { lastSeenAt: new Date(now - 2 * HOUR), resolvedAt: new Date(now - HOUR) });
  const staff = await prisma.adminUser.create({ data: { name: "Site health staff", email: `sh-${RUN}@example.com`, passwordHash: await bcrypt.hash("x", 4), role: "STAFF" } });
  staffId = staff.id;
});

afterAll(async () => {
  await prisma.errorGroup.deleteMany({ where: { fingerprint: { startsWith: RUN } } });
  await prisma.auditLog.deleteMany({ where: { entityType: "ErrorGroup", entityId: { in: Object.values(ids) } } });
  await prisma.adminUser.delete({ where: { id: staffId } });
});

const asStaff = (r: request.Test) => r.set("Cookie", [`access_token=${signAccessToken({ adminId: staffId, role: "STAFF" })}`]);
const mine = (items: Array<{ title: string }>) => items.filter((i) => i.title.includes(RUN));

describe("Site health errors API", () => {
  it("lists open errors newest first, without stacks", async () => {
    const res = await (await asOwner()).get("/api/v1/ops/errors?status=open");
    expect(res.status).toBe(200);
    const items = mine(res.body.items);
    expect(items.map((i: { title: string }) => i.title)).toEqual([`Error: ${RUN} fresh`, `Error: ${RUN} old`]);
    expect(items[0]).toMatchObject({ source: "web", count: 3, lastPath: "POST /api/orders/", resolvedAt: null });
    expect(items[0]).not.toHaveProperty("sampleStack");
  });

  it("lists fixed errors separately", async () => {
    const res = await (await asOwner()).get("/api/v1/ops/errors?status=resolved");
    expect(mine(res.body.items).map((i: { title: string }) => i.title)).toEqual([`Error: ${RUN} fixed`]);
  });

  it("shows one error with its stack and correlation id", async () => {
    const res = await (await asOwner()).get(`/api/v1/ops/errors/${ids.fresh}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: ids.fresh, lastCorrelationId: "corr-12345678" });
    expect(res.body.sampleStack).toContain(RUN);
    expect((await (await asOwner()).get("/api/v1/ops/errors/does-not-exist")).status).toBe(404);
  });

  it("lets staff read but not mark fixed", async () => {
    expect((await asStaff(request(app).get("/api/v1/ops/errors"))).status).toBe(200);
    expect((await asStaff(request(app).post(`/api/v1/ops/errors/${ids.old}/resolve`))).status).toBe(403);
    expect((await request(app).get("/api/v1/ops/errors")).status).toBe(401);
  });

  it("marks an error fixed and records who did it", async () => {
    const res = await (await asOwner()).post(`/api/v1/ops/errors/${ids.old}/resolve`);
    expect(res.status).toBe(204);
    const row = await prisma.errorGroup.findUniqueOrThrow({ where: { id: ids.old } });
    expect(row.resolvedAt).not.toBeNull();
    await new Promise((r) => setTimeout(r, 100)); // the audit write is fire-and-forget
    expect(await prisma.auditLog.count({ where: { entityType: "ErrorGroup", entityId: ids.old, action: "ops.error.resolve" } })).toBe(1);
  });

  it("counts only open errors seen in the last 24 hours as needing attention", async () => {
    const before = await countOpenErrors();
    await prisma.errorGroup.update({ where: { id: ids.fresh }, data: { resolvedAt: new Date() } });
    expect(await countOpenErrors()).toBe(before - 1);
    await prisma.errorGroup.update({ where: { id: ids.fresh }, data: { resolvedAt: null } });
  });

  it("adds the count to the admin attention poll for admins who may read it", async () => {
    const owner = await adminAttention({ adminId: staffId, role: "OWNER", permissions: ["ops.read"] });
    expect(typeof owner.openErrors).toBe("number");
    const none = await adminAttention({ adminId: staffId, role: "STAFF", permissions: ["orders.read"] });
    expect(none.openErrors).toBeNull();
  });
});
