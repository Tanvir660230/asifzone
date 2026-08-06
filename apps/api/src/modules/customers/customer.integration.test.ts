import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../app";
import { prisma } from "../../config/prisma";

const email = `vitest_${Date.now()}@example.com`;
const password = "OriginalPass1";

/** Login/register responses set csrf_token alongside the session cookies (middlewares/csrf.ts) —
 * any test that POSTs with a customer session attached needs to echo it back as a header, exactly
 * like the real frontend's double-submit check does. */
function extractCookieValue(cookies: string[], name: string): string {
  const raw = cookies.find((c) => c.startsWith(`${name}=`));
  if (!raw) throw new Error(`Cookie "${name}" not found in Set-Cookie response`);
  return raw.split(";")[0]!.split("=")[1]!;
}

describe("customer accounts", () => {
  afterAll(async () => {
    await prisma.customer.deleteMany({ where: { email } });
    await prisma.$disconnect();
  });

  it("registers, logs in, and exposes the session via /me", async () => {
    const registerRes = await request(app)
      .post("/api/customers/register")
      .send({ name: "Vitest User", email, password });
    expect(registerRes.status).toBe(201);
    expect(registerRes.body.customer.email).toBe(email);

    const cookies = registerRes.get("Set-Cookie");
    expect(cookies).toBeDefined();

    const meRes = await request(app).get("/api/customers/me").set("Cookie", cookies!);
    expect(meRes.status).toBe(200);
    expect(meRes.body.customer.email).toBe(email);
  });

  it("rejects login with the wrong password", async () => {
    const res = await request(app).post("/api/customers/login").send({ email, password: "WrongPassword1" });
    expect(res.status).toBe(401);
  });

  it("returns 401 from /me without a session cookie", async () => {
    const res = await request(app).get("/api/customers/me");
    expect(res.status).toBe(401);
  });

  it("logs out and invalidates the session cookie", async () => {
    const loginRes = await request(app).post("/api/customers/login").send({ email, password });
    const cookies = loginRes.get("Set-Cookie")!;
    const csrfToken = extractCookieValue(cookies, "csrf_token");

    const logoutRes = await request(app)
      .post("/api/customers/logout")
      .set("Cookie", cookies)
      .set("X-CSRF-Token", csrfToken);
    expect(logoutRes.status).toBe(204);
  });

  it("does not reveal whether an email is registered on forgot-password", async () => {
    const registered = await request(app).post("/api/customers/forgot-password").send({ email });
    const unregistered = await request(app)
      .post("/api/customers/forgot-password")
      .send({ email: `unregistered_${Date.now()}@example.com` });

    expect(registered.status).toBe(200);
    expect(unregistered.status).toBe(200);
    expect(registered.body.message).toBe(unregistered.body.message);
  });

  it("resets the password with a valid token and rejects the old password afterward", async () => {
    const resetToken = await prisma.passwordResetToken.findFirst({
      where: { customer: { email } },
      orderBy: { createdAt: "desc" },
    });
    expect(resetToken).not.toBeNull();

    // The service only ever stores a sha256 hash of the token, so this test issues its own
    // token/hash pair directly against the DB rather than parsing it out of the dev-mode email.
    const crypto = await import("crypto");
    const rawToken = crypto.randomBytes(32).toString("hex");
    await prisma.passwordResetToken.update({
      where: { id: resetToken!.id },
      data: { tokenHash: crypto.createHash("sha256").update(rawToken).digest("hex"), usedAt: null },
    });

    const newPassword = "BrandNewPass2";
    const resetRes = await request(app)
      .post("/api/customers/reset-password")
      .send({ token: rawToken, password: newPassword });
    expect(resetRes.status).toBe(200);

    const oldLoginRes = await request(app).post("/api/customers/login").send({ email, password });
    expect(oldLoginRes.status).toBe(401);

    const newLoginRes = await request(app).post("/api/customers/login").send({ email, password: newPassword });
    expect(newLoginRes.status).toBe(200);

    const reuseRes = await request(app)
      .post("/api/customers/reset-password")
      .send({ token: rawToken, password: "AnotherPass3" });
    expect(reuseRes.status).toBe(400);
  });
});
