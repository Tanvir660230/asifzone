import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import request from "supertest";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { signAccessToken } from "../../lib/jwt";
import { totpAt } from "../../lib/totp";
import { ownerId } from "../../test-fixtures";
import { loginAdmin, signInAdminWithGoogleIdentity } from "./auth.service";

// Admin audit phase 2 (owner, 2026-10-25): "safer login" — an authenticator-app code after the password (or Google),
// recovery codes for a lost phone, a lock after repeated wrong codes, and an owner can reset a teammate's 2-step sign-in.

const CSRF = "vitest-csrf";
const PASSWORD = "Two-step-Pass-1!";
const email = `two-step-${Date.now()}@vitest.invalid`;
const googleSub = `google-two-step-${Date.now()}`;
let adminId: string;
let owner: string;
let secret: string;
let recovery: string[];

const as = (id: string, role: "OWNER" | "STAFF" = "STAFF") => {
  const cookie = [`access_token=${signAccessToken({ adminId: id, role })}`, `csrf_token=${CSRF}`];
  return {
    get: (url: string) => request(app).get(url).set("Cookie", cookie),
    post: (url: string, body: object = {}) => request(app).post(url).set("Cookie", cookie).set("X-CSRF-Token", CSRF).send(body),
    delete: (url: string) => request(app).delete(url).set("Cookie", cookie).set("X-CSRF-Token", CSRF),
  };
};
const login = () => request(app).post("/api/auth/login").send({ email, password: PASSWORD });
const second = (challenge: string, code: string) => request(app).post("/api/auth/login/2fa").send({ challenge, code });
/** The app's current code, usable again: a code is refused once its step was used, so forget the last step first (the
 * replay rule itself is tested separately). */
async function nextCode() {
  await prisma.adminUser.update({ where: { id: adminId }, data: { totpLastStep: null } });
  return totpAt(secret);
}
const setCookies = (res: request.Response) => ([] as string[]).concat(res.headers["set-cookie"] ?? []);

beforeAll(async () => {
  owner = await ownerId();
  adminId = (await prisma.adminUser.create({ data: { email, name: "Two Step", passwordHash: await bcrypt.hash(PASSWORD, 4), role: "STAFF", googleId: googleSub } })).id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { OR: [{ adminId }, { entityId: adminId }] } });
  await prisma.refreshToken.deleteMany({ where: { adminId } });
  await prisma.adminUser.delete({ where: { id: adminId } });
});

describe("2-step sign-in", () => {
  it("setup gives a secret and a QR link; a wrong code doesn't turn it on, the right one does and returns 8 recovery codes", async () => {
    const setup = await as(adminId).post("/api/auth/2fa/setup");
    expect(setup.status, JSON.stringify(setup.body)).toBe(200);
    secret = setup.body.secret;
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.body.otpauthUrl).toContain(`secret=${secret}`);
    // stored sealed, never as the plain secret
    expect((await prisma.adminUser.findUniqueOrThrow({ where: { id: adminId } })).totpSecret).not.toContain(secret);

    // a session signed in before 2-step was on (maybe a stolen one) ends when it's turned on
    const before = await prisma.refreshToken.create({ data: { adminId, tokenHash: `two-step-old-${Date.now()}`, expiresAt: new Date(Date.now() + 86_400_000) } });

    expect((await as(adminId).post("/api/auth/2fa/enable", { code: "000000" })).status).toBe(400);
    expect((await as(adminId).get("/api/auth/me")).body.admin.twoStepEnabled).toBe(false);

    const on = await as(adminId).post("/api/auth/2fa/enable", { code: await nextCode() });
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    recovery = on.body.recoveryCodes;
    expect(recovery).toHaveLength(8);
    expect((await as(adminId).get("/api/auth/me")).body.admin.twoStepEnabled).toBe(true);
    expect((await prisma.refreshToken.findUniqueOrThrow({ where: { id: before.id } })).revokedAt).not.toBeNull();
    // recovery codes are stored keyed to this admin, never as a bare hash of the code
    const stored = (await prisma.adminUser.findUniqueOrThrow({ where: { id: adminId } })).totpRecoveryHashes;
    expect(stored).not.toContain(crypto.createHash("sha256").update(recovery[0]!).digest("hex"));
  });

  it("the password alone no longer signs in: it returns a challenge and sets no session cookie", async () => {
    const res = await login();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ twoStepRequired: true });
    expect(typeof res.body.challenge).toBe("string");
    expect(res.body.admin).toBeUndefined();
    expect(setCookies(res).some((c) => c.startsWith("access_token="))).toBe(false);
  });

  it("the challenge plus the app's code signs in; the same code can't be used again", async () => {
    const code = await nextCode();
    const first = await second((await login()).body.challenge, code);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.admin.id).toBe(adminId);
    expect(setCookies(first).some((c) => c.startsWith("access_token="))).toBe(true);
    const replay = await second((await login()).body.challenge, code);
    expect(replay.status).toBe(401);
  });

  it("a recovery code works once", async () => {
    const code = recovery[0]!;
    expect((await second((await login()).body.challenge, code)).status).toBe(200);
    expect((await second((await login()).body.challenge, code)).status).toBe(401);
    expect((await prisma.adminUser.findUniqueOrThrow({ where: { id: adminId } })).totpRecoveryHashes).toHaveLength(7);
  });

  it("a forged or wrong challenge is refused", async () => {
    expect((await second("not-a-real-challenge-token-at-all", await nextCode())).status).toBe(401);
    expect((await second(signAccessToken({ adminId, role: "STAFF" }), await nextCode())).status).toBe(401);
  });

  it("Google sign-in also asks for the code", async () => {
    const res = await signInAdminWithGoogleIdentity({ sub: googleSub, email, emailVerified: true });
    expect(res).toMatchObject({ twoStepRequired: true });
  });

  it("five wrong codes lock the second step for a while — even the right code is refused", async () => {
    await prisma.adminUser.update({ where: { id: adminId }, data: { totpLockedUntil: null, totpFailures: 0 } });
    for (let i = 0; i < 5; i++) expect((await second((await login()).body.challenge, "111111")).status).toBe(401);
    const locked = await second((await login()).body.challenge, await nextCode());
    expect(locked.status).toBe(429);
    await prisma.adminUser.update({ where: { id: adminId }, data: { totpLockedUntil: null, totpFailures: 0 } });
  });

  it("an owner can reset a teammate's 2-step sign-in (audited); a teammate can't reset anyone's", async () => {
    expect((await as(adminId).delete(`/api/auth/admins/${owner}/2fa`)).status).toBe(403);
    const res = await as(owner, "OWNER").delete(`/api/auth/admins/${adminId}/2fa`);
    expect(res.status, JSON.stringify(res.body)).toBe(204);
    const row = await prisma.adminUser.findUniqueOrThrow({ where: { id: adminId } });
    expect(row.totpEnabledAt).toBeNull();
    expect(row.totpSecret).toBeNull();
    const audit = await prisma.auditLog.findFirst({ where: { action: "admins.two_step_reset", entityId: adminId } });
    expect(audit).not.toBeNull();
    // back to password-only (straight to the service: the wrong codes above used up this IP's login attempts, as intended)
    const again = await loginAdmin({ email, password: PASSWORD });
    expect("admin" in again && again.admin.id).toBe(adminId);
  });

  it("turning it off yourself needs a current code", async () => {
    secret = (await as(adminId).post("/api/auth/2fa/setup")).body.secret;
    expect((await as(adminId).post("/api/auth/2fa/enable", { code: await nextCode() })).status).toBe(200);
    expect((await as(adminId).post("/api/auth/2fa/disable", { code: "123456" })).status).toBe(400);
    expect((await as(adminId).post("/api/auth/2fa/disable", { code: await nextCode() })).status).toBe(204);
    expect((await as(adminId).get("/api/auth/me")).body.admin.twoStepEnabled).toBe(false);
  });

  it("the team list shows who has 2-step sign-in, when they were last active and how many devices are signed in", async () => {
    await loginAdmin({ email, password: PASSWORD }); // a session (turning 2-step on above ended the earlier ones)
    const res = await as(owner, "OWNER").get("/api/auth/admins");
    expect(res.status).toBe(200);
    const me = res.body.admins.find((a: { id: string }) => a.id === adminId);
    expect(me).toMatchObject({ twoStepEnabled: false });
    expect(me.activeSessions).toBeGreaterThan(0);
    expect(typeof me.lastActiveAt).toBe("string");
  });

  it("an owner can sign a teammate out of every device", async () => {
    const res = await as(owner, "OWNER").post(`/api/auth/admins/${adminId}/sessions/revoke`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await prisma.refreshToken.count({ where: { adminId, revokedAt: null } })).toBe(0);
  });
});
