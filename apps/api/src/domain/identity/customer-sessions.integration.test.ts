import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";

vi.mock("../../lib/mailer", () => ({ sendMail: async () => undefined }));

import crypto from "node:crypto";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { hashToken } from "../../lib/token-hash";
import { signCustomerAccessToken, signCustomerRefreshToken } from "../../lib/customer-jwt";
import { CUSTOMER_ACCESS_COOKIE, CUSTOMER_REFRESH_COOKIE } from "../../lib/cookies";
import { RUN } from "../../test-fixtures";
import { changeCustomerPassword, loginCustomer, registerCustomer, resetPassword } from "../../modules/customers/customer.service";
import { REUSE_GRACE_MS, revokeAllCustomerSessions, revokeCustomerSession, rotateCustomerSession } from "../../modules/customers/customer-sessions";

// Phase 11 (BD-11.3; contract §5.2): issued → active → rotated → revoked | expired, with reuse detection.

const created: string[] = [];
const PASSWORD = "Session123!";

async function newCustomer() {
  const email = `p11s-${RUN}-${Math.random().toString(36).slice(2, 9)}@example.com`;
  const reg = await registerCustomer({ name: "Session", email, password: PASSWORD, phone: null });
  if (reg.claimPending) throw new Error("unexpected claim");
  created.push(reg.customer.id);
  return { id: reg.customer.id, email, refreshToken: reg.refreshToken! };
}
const row = (raw: string) => prisma.customerRefreshToken.findUniqueOrThrow({ where: { tokenHash: hashToken(raw) } });
/** Moves a token's rotation `ms` into the past (instead of sleeping past the grace window). */
async function ageRotation(raw: string, ms: number) {
  const r = await row(raw);
  await prisma.customerRefreshToken.update({ where: { id: r.id }, data: { rotatedAt: new Date(Date.now() - ms) } });
}

afterAll(async () => {
  await prisma.customer.deleteMany({ where: { id: { in: created } } }); // cascades sessions
  await prisma.$disconnect();
});

describe("issue → active → rotated", () => {
  it("a login opens a family; each refresh rotates to a new token with the same fixed expiry (7 days from login)", async () => {
    const c = await newCustomer();
    const first = await row(c.refreshToken);
    expect(first.expiresAt.getTime() - first.createdAt.getTime()).toBeGreaterThan(6.9 * 86_400_000);
    expect(first.expiresAt.getTime() - first.createdAt.getTime()).toBeLessThanOrEqual(7 * 86_400_000 + 5_000);

    const second = await rotateCustomerSession(c.refreshToken);
    const third = await rotateCustomerSession(second.refreshToken!);
    const [r1, r2, r3] = await Promise.all([row(c.refreshToken), row(second.refreshToken!), row(third.refreshToken!)]);
    expect(r1.rotatedAt).not.toBeNull();
    expect(r1.replacedById).toBe(r2.id);
    expect(new Set([r1.familyId, r2.familyId, r3.familyId]).size).toBe(1);
    expect(r3.expiresAt.getTime()).toBe(r1.expiresAt.getTime()); // never extended
  });

  it("an expired family is refused", async () => {
    const c = await newCustomer();
    await prisma.customerRefreshToken.update({ where: { tokenHash: hashToken(c.refreshToken) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(rotateCustomerSession(c.refreshToken)).rejects.toMatchObject({ statusCode: 401 });
  });
});

describe("reuse detection and the 10-second grace window", () => {
  it("two concurrent refreshes of one token: one rotates, the other gets an access token only — the family survives", async () => {
    const c = await newCustomer();
    const [a, b] = await Promise.all([rotateCustomerSession(c.refreshToken), rotateCustomerSession(c.refreshToken)]);
    const winners = [a, b].filter((s) => s.refreshToken !== null);
    const graced = [a, b].filter((s) => s.refreshToken === null);
    expect(winners).toHaveLength(1);
    expect(graced).toHaveLength(1);
    expect(graced[0]!.accessToken).toBeTruthy();
    expect((await rotateCustomerSession(winners[0]!.refreshToken!)).refreshToken).toBeTruthy(); // family alive
  });

  it("a replay inside the grace window gets no new refresh token; outside it, the whole family is revoked", async () => {
    expect(REUSE_GRACE_MS).toBe(10_000); // BD-11.3: exactly a 10-second window — never unbounded
    const c = await newCustomer();
    const next = await rotateCustomerSession(c.refreshToken);
    expect((await rotateCustomerSession(c.refreshToken)).refreshToken).toBeNull(); // inside grace: no fork

    await ageRotation(c.refreshToken, 11_000);
    await expect(rotateCustomerSession(c.refreshToken)).rejects.toMatchObject({ statusCode: 401 });
    const family = await prisma.customerRefreshToken.findMany({ where: { familyId: (await row(c.refreshToken)).familyId } });
    expect(family.every((t) => t.revokedAt && t.revokedReason === "reuse_detected")).toBe(true);
    await expect(rotateCustomerSession(next.refreshToken!)).rejects.toMatchObject({ statusCode: 401 }); // the legitimate holder too
  });

  it("a revoked token can't be replayed", async () => {
    const c = await newCustomer();
    await revokeCustomerSession(c.refreshToken);
    await expect(rotateCustomerSession(c.refreshToken)).rejects.toMatchObject({ statusCode: 401 });
    await expect(rotateCustomerSession(c.refreshToken)).rejects.toMatchObject({ statusCode: 401 });
  });
});

describe("revocation", () => {
  it("logout revokes the current session only", async () => {
    const c = await newCustomer();
    const other = await loginCustomer({ email: c.email, password: PASSWORD });
    await revokeCustomerSession(c.refreshToken);
    expect((await row(c.refreshToken)).revokedReason).toBe("logout");
    await expect(rotateCustomerSession(c.refreshToken)).rejects.toMatchObject({ statusCode: 401 });
    expect((await rotateCustomerSession(other.refreshToken!)).refreshToken).toBeTruthy(); // another device keeps working
  });

  it("logout everywhere revokes every session", async () => {
    const c = await newCustomer();
    const other = await loginCustomer({ email: c.email, password: PASSWORD });
    await revokeAllCustomerSessions(c.id, "logout_all");
    await expect(rotateCustomerSession(c.refreshToken)).rejects.toMatchObject({ statusCode: 401 });
    await expect(rotateCustomerSession(other.refreshToken!)).rejects.toMatchObject({ statusCode: 401 });
  });

  it("a password change revokes every session and returns a fresh one for this device", async () => {
    const c = await newCustomer();
    const fresh = await changeCustomerPassword(c.id, { currentPassword: PASSWORD, newPassword: "Changed123!" });
    await expect(rotateCustomerSession(c.refreshToken)).rejects.toMatchObject({ statusCode: 401 });
    expect((await row(c.refreshToken)).revokedReason).toBe("password_change");
    expect((await rotateCustomerSession(fresh.refreshToken!)).refreshToken).toBeTruthy();
    await expect(changeCustomerPassword(c.id, { currentPassword: "wrong-one", newPassword: "Another123!" })).rejects.toMatchObject({ statusCode: 400 });
  });

  it("a password reset revokes every session (tokenVersion bump kept)", async () => {
    const c = await newCustomer();
    const before = (await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).tokenVersion;
    const raw = crypto.randomBytes(16).toString("hex");
    await prisma.passwordResetToken.create({ data: { customerId: c.id, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + 60_000) } });
    await resetPassword(raw, "ResetPass123!");
    await expect(rotateCustomerSession(c.refreshToken)).rejects.toMatchObject({ statusCode: 401 });
    expect((await row(c.refreshToken)).revokedReason).toBe("password_reset");
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).tokenVersion).toBe(before + 1);
  });

  it("isBlocked doesn't gate sessions (CRM field only)", async () => {
    const c = await newCustomer();
    await prisma.customer.update({ where: { id: c.id }, data: { isBlocked: true } });
    expect((await rotateCustomerSession(c.refreshToken)).refreshToken).toBeTruthy();
  });
});

describe("legacy stateless refresh tokens (pre-Phase-11)", () => {
  it("are accepted once — converted into a DB family; presenting the same JWT later is reuse", async () => {
    const c = await newCustomer();
    const { tokenVersion } = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } });
    const legacy = signCustomerRefreshToken({ customerId: c.id, tokenVersion });
    const converted = await rotateCustomerSession(legacy);
    expect(converted.refreshToken).toBeTruthy();
    await ageRotation(legacy, 11_000);
    await expect(rotateCustomerSession(legacy)).rejects.toMatchObject({ statusCode: 401 });
    await expect(rotateCustomerSession(converted.refreshToken!)).rejects.toMatchObject({ statusCode: 401 }); // family revoked
  });

  it("logout-everywhere kills unconverted legacy tokens (tokenVersion)", async () => {
    const c = await newCustomer();
    const { tokenVersion } = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } });
    const legacy = signCustomerRefreshToken({ customerId: c.id, tokenVersion });
    await revokeAllCustomerSessions(c.id, "logout_all");
    await expect(rotateCustomerSession(legacy)).rejects.toMatchObject({ statusCode: 401 });
  });
});

describe("over HTTP", () => {
  it("refresh rotates the cookie; remember-me off stays a browser-session cookie; logout revokes server-side", async () => {
    const c = await newCustomer();
    const login = await request(app).post("/api/customers/login").send({ email: c.email, password: PASSWORD, rememberMe: false });
    expect(login.status).toBe(200);
    const cookieOf = (res: request.Response, name: string) => ([] as string[]).concat(res.headers["set-cookie"] ?? []).find((h) => h.startsWith(`${name}=`));
    const loginCookie = cookieOf(login, CUSTOMER_REFRESH_COOKIE)!;
    expect(loginCookie).not.toMatch(/Max-Age|Expires/i);
    const token = loginCookie.split(";")[0]!.split("=")[1]!;

    const refreshed = await request(app).post("/api/customers/refresh").set("Cookie", [`${CUSTOMER_REFRESH_COOKIE}=${token}`]);
    expect(refreshed.status).toBe(200);
    const rotatedCookie = cookieOf(refreshed, CUSTOMER_REFRESH_COOKIE)!;
    expect(rotatedCookie).not.toMatch(/Max-Age|Expires/i); // still session-only after rotation
    const rotated = rotatedCookie.split(";")[0]!.split("=")[1]!;
    expect(rotated).not.toBe(token);

    const out = await request(app).post("/api/customers/logout").set("Cookie", [`${CUSTOMER_REFRESH_COOKIE}=${rotated}`]);
    expect(out.status).toBe(204);
    expect((await request(app).post("/api/customers/refresh").set("Cookie", [`${CUSTOMER_REFRESH_COOKIE}=${rotated}`])).status).toBe(401);
  });

  it("log out everywhere over HTTP (customer session required)", async () => {
    const c = await newCustomer();
    const auth = [`${CUSTOMER_ACCESS_COOKIE}=${signCustomerAccessToken({ customerId: c.id })}`, "csrf_token=t"];
    expect((await request(app).post("/api/customers/logout-all").set("Cookie", auth).set("X-CSRF-Token", "t")).status).toBe(204);
    await expect(rotateCustomerSession(c.refreshToken)).rejects.toMatchObject({ statusCode: 401 });
    expect((await request(app).post("/api/customers/logout-all")).status).toBe(401);
  });
});
