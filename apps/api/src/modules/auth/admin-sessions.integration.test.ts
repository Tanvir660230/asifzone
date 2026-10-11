import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import request from "supertest";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { signAccessToken } from "../../lib/jwt";
import { ownerId } from "../../test-fixtures";

// Blueprint V2 §security "Account › Active sessions lists and revokes them": an admin sees their signed-in devices,
// which one is this one, and can sign one of the others out. Never another admin's session, never the current one
// (that's Log out).

const CSRF = "vitest-csrf";
const hash = (raw: string) => crypto.createHash("sha256").update(raw).digest("hex");
const RAW = { current: `vitest-current-${Date.now()}`, other: `vitest-other-${Date.now()}`, stranger: `vitest-stranger-${Date.now()}` };
const ids: Record<keyof typeof RAW, string> = { current: "", other: "", stranger: "" };
let owner: string;
let strangerAdminId: string;

function asOwnerOn(refreshRaw: string) {
  const cookie = [`access_token=${signAccessToken({ adminId: owner, role: "OWNER" })}`, `refresh_token=${refreshRaw}`, `csrf_token=${CSRF}`];
  return {
    get: (url: string) => request(app).get(url).set("Cookie", cookie),
    delete: (url: string) => request(app).delete(url).set("Cookie", cookie).set("X-CSRF-Token", CSRF),
    post: (url: string) => request(app).post(url).set("Cookie", cookie).set("X-CSRF-Token", CSRF),
  };
}

beforeAll(async () => {
  owner = await ownerId();
  strangerAdminId = (
    await prisma.adminUser.create({ data: { email: `sessions-${Date.now()}@vitest.invalid`, name: "Other Admin", passwordHash: "x", role: "STAFF" } })
  ).id;
  const expiresAt = new Date(Date.now() + 86_400_000);
  ids.current = (await prisma.refreshToken.create({ data: { adminId: owner, tokenHash: hash(RAW.current), expiresAt, userAgent: "Vitest Current" } })).id;
  ids.other = (await prisma.refreshToken.create({ data: { adminId: owner, tokenHash: hash(RAW.other), expiresAt, userAgent: "Vitest Phone" } })).id;
  ids.stranger = (await prisma.refreshToken.create({ data: { adminId: strangerAdminId, tokenHash: hash(RAW.stranger), expiresAt } })).id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { entityType: "sessions", entityId: { in: Object.values(ids) } } });
  await prisma.refreshToken.deleteMany({ where: { id: { in: Object.values(ids) } } });
  await prisma.adminUser.delete({ where: { id: strangerAdminId } });
  await prisma.$disconnect();
});

describe("admin active sessions", () => {
  it("lists my sessions and marks the one making the request", async () => {
    const res = await asOwnerOn(RAW.current).get("/api/auth/sessions");
    expect(res.status).toBe(200);
    const mine = (res.body.sessions as Array<{ id: string; current: boolean }>).filter((s) => s.id === ids.current || s.id === ids.other);
    expect(mine).toEqual(expect.arrayContaining([expect.objectContaining({ id: ids.current, current: true }), expect.objectContaining({ id: ids.other, current: false })]));
    expect(res.body.sessions.some((s: { id: string }) => s.id === ids.stranger)).toBe(false);
  });

  it("refuses to sign out the current session — that's Log out", async () => {
    const res = await asOwnerOn(RAW.current).delete(`/api/auth/sessions/${ids.current}`);
    expect(res.status).toBe(400);
    expect((await prisma.refreshToken.findUniqueOrThrow({ where: { id: ids.current } })).revokedAt).toBeNull();
  });

  it("can't touch another admin's session", async () => {
    const res = await asOwnerOn(RAW.current).delete(`/api/auth/sessions/${ids.stranger}`);
    expect(res.status).toBe(404);
    expect((await prisma.refreshToken.findUniqueOrThrow({ where: { id: ids.stranger } })).revokedAt).toBeNull();
  });

  it("signs out one of my other devices and audits it", async () => {
    const res = await asOwnerOn(RAW.current).delete(`/api/auth/sessions/${ids.other}`);
    expect(res.status).toBe(204);
    expect((await prisma.refreshToken.findUniqueOrThrow({ where: { id: ids.other } })).revokedAt).not.toBeNull();
    // The revoked device can no longer refresh — and its stale cookies are cleared, so the web's "has a session" check
    // doesn't bounce it between the login page and the dashboard.
    const refresh = await request(app).post("/api/auth/refresh").set("Cookie", [`refresh_token=${RAW.other}`]);
    expect(refresh.status).toBe(401);
    const cleared = ([] as string[]).concat(refresh.headers["set-cookie"] ?? []);
    for (const name of ["access_token", "refresh_token", "csrf_token"]) {
      expect(cleared.some((c) => c.startsWith(`${name}=;`) && /Expires=Thu, 01 Jan 1970/.test(c))).toBe(true);
    }
    // Audit is fire-and-forget — poll briefly.
    let audit = null;
    for (let i = 0; i < 20 && !audit; i++) {
      audit = await prisma.auditLog.findFirst({ where: { action: "sessions.revoke", entityId: ids.other } });
      if (!audit) await new Promise((r) => setTimeout(r, 50));
    }
    expect(audit).toMatchObject({ adminId: owner, entityType: "sessions" });
    // A second attempt finds nothing active.
    expect((await asOwnerOn(RAW.current).delete(`/api/auth/sessions/${ids.other}`)).status).toBe(404);
  });

  it("signs out every other device at once, keeping this one and other admins' sessions", async () => {
    const extraRaw = `vitest-extra-${Date.now()}`;
    const extra = await prisma.refreshToken.create({
      data: { adminId: owner, tokenHash: hash(extraRaw), expiresAt: new Date(Date.now() + 86_400_000), userAgent: "Vitest Tablet" },
    });
    try {
      const res = await asOwnerOn(RAW.current).post("/api/auth/sessions/revoke-others");
      expect(res.status).toBe(200);
      expect(res.body.revoked).toBeGreaterThanOrEqual(1);
      expect((await prisma.refreshToken.findUniqueOrThrow({ where: { id: extra.id } })).revokedAt).not.toBeNull();
      expect((await prisma.refreshToken.findUniqueOrThrow({ where: { id: ids.current } })).revokedAt).toBeNull();
      expect((await prisma.refreshToken.findUniqueOrThrow({ where: { id: ids.stranger } })).revokedAt).toBeNull();
      const list = await asOwnerOn(RAW.current).get("/api/auth/sessions");
      expect(list.body.sessions.map((s: { id: string }) => s.id)).toEqual([ids.current]);
    } finally {
      await prisma.refreshToken.delete({ where: { id: extra.id } });
    }
  });
});
