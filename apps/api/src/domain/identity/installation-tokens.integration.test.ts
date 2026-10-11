import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../../app";
import { env } from "../../config/env";
import { prisma } from "../../config/prisma";
import { TOKEN_AUDIENCE, assertTokenInstallation, installId } from "../../config/installation";
import { signAccessToken, verifyAccessToken } from "../../lib/jwt";
import { signCustomerAccessToken, signCustomerRefreshToken, verifyCustomerAccessToken, verifyCustomerRefreshToken } from "../../lib/customer-jwt";
import { CUSTOMER_ACCESS_COOKIE } from "../../lib/cookies";
import { ownerId, RUN } from "../../test-fixtures";

// Installation-bound session tokens (docs/BUSINESS_DECISIONS.md D17). Every token this installation signs names it in
// `aud`; a token naming another installation is refused even when the two installations were (wrongly) given the same JWT
// secrets — the case modelled here by signing "another installation's" token with this process's own secrets. Tokens
// issued before the claim existed carry no `aud` and stay valid until they expire.

const OTHER = "install:other-store";
const ttl = { expiresIn: "5m" } as const;
const foreignAdmin = (adminId: string) => jwt.sign({ adminId, role: "OWNER", typ: "admin" }, env.jwtAccessSecret, { ...ttl, audience: OTHER });
const legacyAdmin = (adminId: string) => jwt.sign({ adminId, role: "OWNER", typ: "admin" }, env.jwtAccessSecret, ttl);
const foreignCustomer = (customerId: string) => jwt.sign({ customerId, typ: "customer" }, env.jwtCustomerAccessSecret, { ...ttl, audience: OTHER });
const legacyCustomer = (customerId: string) => jwt.sign({ customerId, typ: "customer" }, env.jwtCustomerAccessSecret, ttl);

describe("installation-bound tokens — signing and verification", () => {
  it("names this installation in every token it signs", () => {
    expect(TOKEN_AUDIENCE).toBe(`install:${installId}`);
    for (const token of [signAccessToken({ adminId: "a1", role: "STAFF" }), signCustomerAccessToken({ customerId: "c1" }), signCustomerRefreshToken({ customerId: "c1", tokenVersion: 0 })]) {
      expect((jwt.decode(token) as { aud?: unknown }).aud).toBe(TOKEN_AUDIENCE);
    }
  });

  it("accepts its own tokens", () => {
    expect(verifyAccessToken(signAccessToken({ adminId: "a1", role: "STAFF" })).adminId).toBe("a1");
    expect(verifyCustomerAccessToken(signCustomerAccessToken({ customerId: "c1" })).customerId).toBe("c1");
    expect(verifyCustomerRefreshToken(signCustomerRefreshToken({ customerId: "c1", tokenVersion: 3 })).tokenVersion).toBe(3);
  });

  it("refuses another installation's tokens even when the secrets are the same", () => {
    expect(() => verifyAccessToken(foreignAdmin("a1"))).toThrow(/another installation/);
    expect(() => verifyCustomerAccessToken(foreignCustomer("c1"))).toThrow(/another installation/);
    const foreignRefresh = jwt.sign({ customerId: "c1", tokenVersion: 0 }, env.jwtCustomerRefreshSecret, { ...ttl, audience: OTHER });
    expect(() => verifyCustomerRefreshToken(foreignRefresh)).toThrow(/another installation/);
  });

  it("keeps accepting legacy tokens that carry no installation", () => {
    expect(verifyAccessToken(legacyAdmin("a1")).adminId).toBe("a1");
    expect(verifyCustomerAccessToken(legacyCustomer("c1")).customerId).toBe("c1");
    const legacyRefresh = jwt.sign({ customerId: "c1", tokenVersion: 2 }, env.jwtCustomerRefreshSecret, ttl);
    expect(verifyCustomerRefreshToken(legacyRefresh).tokenVersion).toBe(2);
  });

  it("accepts a multi-audience token only when this installation is one of them", () => {
    expect(() => assertTokenInstallation({ aud: [OTHER, TOKEN_AUDIENCE] })).not.toThrow();
    expect(() => assertTokenInstallation({ aud: [OTHER, "install:third"] })).toThrow();
    expect(() => assertTokenInstallation({ aud: "" })).toThrow();
  });
});

describe("installation-bound tokens — at the HTTP boundary", () => {
  let admin: string;
  let customerId: string;

  beforeAll(async () => {
    admin = await ownerId();
    customerId = (await prisma.customer.create({ data: { name: "Token Scope", email: `token-scope-${RUN}@example.com` } })).id;
  });
  afterAll(async () => {
    await prisma.customer.deleteMany({ where: { id: customerId } });
  });

  it("an admin session from another installation gets 401, the same admin's own and legacy sessions work", async () => {
    // The admin id exists HERE — only the installation the token names differs.
    expect((await request(app).get("/api/auth/me").set("Cookie", `access_token=${foreignAdmin(admin)}`)).status).toBe(401);
    expect((await request(app).get("/api/auth/me").set("Cookie", `access_token=${signAccessToken({ adminId: admin, role: "OWNER" })}`)).status).toBe(200);
    expect((await request(app).get("/api/auth/me").set("Cookie", `access_token=${legacyAdmin(admin)}`)).status).toBe(200);
  });

  it("a customer session from another installation gets 401, the same customer's own and legacy sessions work", async () => {
    const me = (token: string) => request(app).get("/api/customers/me").set("Cookie", `${CUSTOMER_ACCESS_COOKIE}=${token}`);
    expect((await me(foreignCustomer(customerId))).status).toBe(401);
    expect((await me(signCustomerAccessToken({ customerId }))).status).toBe(200);
    expect((await me(legacyCustomer(customerId))).status).toBe(200);
  });
});
