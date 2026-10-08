import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { OWNER_ONLY_PERMISSIONS, ROLE_PERMISSIONS, PERMISSIONS, roleHasPermission } from "@clothing-brand/shared";
import { app } from "../../app";
import { env } from "../../config/env";
import { prisma } from "../../config/prisma";
import { signAccessToken } from "../../lib/jwt";
import { signCustomerAccessToken } from "../../lib/customer-jwt";
import { CUSTOMER_ACCESS_COOKIE } from "../../lib/cookies";
import { cleanupFixtures, createStockedProduct, ownerId, RUN, trackOrder, checkout } from "../../test-fixtures";
import { createOrder, holdOrderForFollowUp, updateOrderStatus } from "../../modules/orders/order.service";
import { listRoutes, routePermission } from "../../test-routes";
import { cacheDelByPrefix } from "../../config/redis";

// Phase 10 (docs/PHASE_10_AUDIT.md): who may perform which action, on which resource. Authentication resolves the admin from
// the database on every request; every admin route states one permission; customers reach only their own resources and
// never staff-only data.

const CSRF = "vitest-csrf";
type Agent = ReturnType<typeof agentWith>;
function agentWith(cookies: string[]) {
  const all = [...cookies, `csrf_token=${CSRF}`];
  const auth = (r: request.Test) => r.set("Cookie", all).set("X-CSRF-Token", CSRF);
  return {
    get: (url: string) => auth(request(app).get(url)),
    post: (url: string, body: object = {}) => auth(request(app).post(url)).send(body),
    patch: (url: string, body: object = {}) => auth(request(app).patch(url)).send(body),
    put: (url: string, body: object = {}) => auth(request(app).put(url)).send(body),
    delete: (url: string) => auth(request(app).delete(url)),
  };
}
const adminAgent = (adminId: string, role: "OWNER" | "STAFF") => agentWith([`access_token=${signAccessToken({ adminId, role })}`]);
const customerAgent = (customerId: string) => agentWith([`${CUSTOMER_ACCESS_COOKIE}=${signCustomerAccessToken({ customerId })}`]);
const anon = agentWith([]);
function call(agent: Agent, method: string, url: string) {
  const m = method.toLowerCase() as "get" | "post" | "patch" | "put" | "delete";
  return agent[m](url);
}
const concrete = (path: string) => path.replace(/:[A-Za-z]+/g, "p10-missing").replace(/\/$/, "") || "/";
/** Audit rows are written fire-and-forget after the response: wait for the condition instead of a fixed sleep. */
async function eventually(check: () => Promise<boolean>, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** OWNER-only routes: the pre-Phase-10 `requireRole("OWNER")` set from the audit's route walk (TARGET §15: the initial
 * mapping preserves it exactly), plus the owner's PD-10.1 decision — permanent coupon / category delete. */
const PD_10_1_ROUTES = ["DELETE /api/coupons/:id/permanent", "DELETE /api/categories/:id/permanent"];
const OWNER_ONLY_ROUTES = [
  ...PD_10_1_ROUTES,
  "GET /api/auth/admins",
  "PATCH /api/auth/admins/:id/active",
  "PATCH /api/auth/admins/:id",
  "PATCH /api/auth/admins/:id/password",
  "GET /api/auth/admin-invites",
  "POST /api/auth/admin-invites",
  "DELETE /api/auth/admin-invites/:id",
  "POST /api/catalog/search-synonyms",
  "PUT /api/catalog/search-synonyms/:id",
  "DELETE /api/catalog/search-synonyms/:id",
  "POST /api/catalog/types",
  "PATCH /api/catalog/types/:id",
  "DELETE /api/catalog/types/:id",
  "POST /api/catalog/templates",
  "PATCH /api/catalog/templates/:id",
  "DELETE /api/catalog/templates/:id",
  "POST /api/catalog/attributes",
  "PATCH /api/catalog/attributes/:id",
  "DELETE /api/catalog/attributes/:id",
  "POST /api/catalog/spec-groups",
  "PATCH /api/catalog/spec-groups/:id",
  "DELETE /api/catalog/spec-groups/:id",
  "POST /api/catalog/size-guides",
  "PUT /api/catalog/size-guides/:id",
  "POST /api/catalog/size-guides/:id/duplicate",
  "PATCH /api/catalog/size-guides/:id/archive",
  "DELETE /api/catalog/size-guides/:id",
  "POST /api/catalog/care-guides",
  "PUT /api/catalog/care-guides/:id",
  "POST /api/catalog/care-guides/:id/duplicate",
  "PATCH /api/catalog/care-guides/:id/archive",
  "DELETE /api/catalog/care-guides/:id",
  "POST /api/catalog/materials",
  "PUT /api/catalog/materials/:id",
  "DELETE /api/catalog/materials/:id",
  "PUT /api/catalog/sku-settings",
  "PUT /api/catalog/sections",
  "POST /api/products/import/validate",
  "POST /api/products/import/commit",
  "DELETE /api/products/:id/permanent",
  "POST /api/orders/bulk/delete",
  "POST /api/orders/bulk/restore",
  "POST /api/orders/bulk/permanent",
  "DELETE /api/orders/:id",
  "POST /api/orders/:id/restore",
  "DELETE /api/orders/:id/permanent",
  "POST /api/redirects/",
  "PATCH /api/redirects/:id",
  "DELETE /api/redirects/:id",
  "POST /api/payment-admin/ledger/repair",
  "POST /api/social-links/",
  "PATCH /api/social-links/:id",
  "DELETE /api/social-links/:id",
  "GET /api/audit-logs/",
  "GET /api/audit-logs/facets",
  "PATCH /api/settings/",
  "GET /api/settings/shipping-zones",
  "POST /api/settings/shipping-zones",
  "PATCH /api/settings/shipping-zones/:id",
  "DELETE /api/settings/shipping-zones/:id",
  "POST /api/settings/upload-logo",
  "POST /api/settings/upload-favicon",
  "POST /api/settings/upload-payment-methods-image",
  "GET /api/sms-settings/",
  "PATCH /api/sms-settings/",
  "POST /api/ai/generate",
  "POST /api/ai/image-alt-text",
  "POST /api/v1/storefront/read-model/rebuild",
  "POST /api/v1/outbox/:id/retry",
  // Storage page (production branch, pre-Phase-10 requireRole("OWNER")) — mapped to settings.manage in the Phase 11 release merge.
  "GET /api/storage/unused",
  "POST /api/storage/unused/trash",
  "GET /api/storage/trash",
  "POST /api/storage/trash/:batch/restore",
  // Phase 12 D-4: provider status (settings.manage, OWNER-only).
  "GET /api/v1/ops/providers",
];
// Phase 12 D-4: GET /api/v1/ops/capabilities is ops.read (OWNER and STAFF), so it is not in the OWNER-only list.

let owner: string;
let staff: string;
let secondOwner: string;
let customerA: string;
let customerB: string;
const createdAdmins: string[] = [];

async function makeAdmin(role: "OWNER" | "STAFF", tag: string) {
  const a = await prisma.adminUser.create({
    data: { name: `P10 ${tag}`, email: `p10-${tag}-${RUN}@example.com`, passwordHash: await bcrypt.hash("x", 4), role },
  });
  createdAdmins.push(a.id);
  return a.id;
}

beforeAll(async () => {
  owner = await ownerId();
  staff = await makeAdmin("STAFF", "staff");
  secondOwner = await makeAdmin("OWNER", "owner2");
  // Dedicated customers (phones no other test file uses).
  customerA = (await prisma.customer.create({ data: { name: "P10 A", phone: "01799910001" } })).id;
  customerB = (await prisma.customer.create({ data: { name: "P10 B", phone: "01799910002" } })).id;
});

afterAll(async () => {
  await cleanupFixtures();
  await prisma.auditLog.deleteMany({ where: { adminId: { in: createdAdmins } } });
  await prisma.refreshToken.deleteMany({ where: { adminId: { in: createdAdmins } } });
  await prisma.adminUser.deleteMany({ where: { id: { in: createdAdmins } } });
  await prisma.address.deleteMany({ where: { customerId: { in: [customerA, customerB] } } });
  await prisma.customer.deleteMany({ where: { id: { in: [customerA, customerB] } } });
  await prisma.$disconnect();
});

describe("authentication (401) — identity comes from the database, not the token", () => {
  it("no cookie, garbage, a wrong-secret or expired token, a customer token, an unknown admin → 401", async () => {
    const url = "/api/orders/stats";
    expect((await anon.get(url)).status).toBe(401);
    expect((await agentWith(["access_token=not-a-jwt"]).get(url)).status).toBe(401);
    const forged = jwt.sign({ adminId: owner, role: "OWNER", typ: "admin" }, "some-other-secret");
    expect((await agentWith([`access_token=${forged}`]).get(url)).status).toBe(401);
    const expired = jwt.sign({ adminId: owner, role: "OWNER", typ: "admin" }, env.jwtAccessSecret, { expiresIn: -10 });
    expect((await agentWith([`access_token=${expired}`]).get(url)).status).toBe(401);
    // A customer-shaped token signed with the ADMIN secret (as if the two secrets were configured alike) is still refused.
    const confused = jwt.sign({ customerId: customerA, typ: "customer" }, env.jwtAccessSecret);
    expect((await agentWith([`access_token=${confused}`]).get(url)).status).toBe(401);
    const noTyp = jwt.sign({ adminId: owner, role: "OWNER" }, env.jwtAccessSecret);
    expect((await agentWith([`access_token=${noTyp}`]).get(url)).status).toBe(401);
    expect((await adminAgent("p10-no-such-admin", "OWNER").get(url)).status).toBe(401);
    // …and an admin token is never a customer identity.
    expect((await agentWith([`${CUSTOMER_ACCESS_COOKIE}=${signAccessToken({ adminId: owner, role: "OWNER" })}`]).get("/api/customers/me")).status).toBe(401);
  });

  it("a deactivated admin is refused on the very next request (their token is still unexpired)", async () => {
    const temp = await makeAdmin("STAFF", "deactivated");
    const session = adminAgent(temp, "STAFF");
    expect((await session.get("/api/orders/stats")).status).toBe(200);
    await prisma.adminUser.update({ where: { id: temp }, data: { isActive: false } });
    expect((await session.get("/api/orders/stats")).status).toBe(401);
  });

  it("a demoted owner loses owner powers immediately, even though the token still says OWNER", async () => {
    const temp = await makeAdmin("OWNER", "demoted");
    const session = adminAgent(temp, "OWNER");
    expect((await session.get("/api/auth/admins")).status).toBe(200);
    await prisma.adminUser.update({ where: { id: temp }, data: { role: "STAFF" } });
    const res = await session.get("/api/auth/admins");
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Forbidden" }); // generic: no hint about what the route is or needs
    expect((await session.get("/api/orders/stats")).status).toBe(200); // still a valid STAFF session
  });

  it("/auth/me returns the permissions resolved from the current role", async () => {
    const me = await adminAgent(staff, "STAFF").get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.admin.role).toBe("STAFF");
    expect([...me.body.admin.permissions].sort()).toEqual([...ROLE_PERMISSIONS.STAFF].sort());
    expect((await adminAgent(owner, "OWNER").get("/api/auth/me")).body.admin.permissions).toHaveLength(PERMISSIONS.length);
  });
});

describe("the role matrix — every admin route, every identity", () => {
  const routes = listRoutes().filter((r) => routePermission(r) !== null);
  const ownerOnly = new Set<string>(OWNER_ONLY_PERMISSIONS);
  // Side effects too broad to fire blind as OWNER (they are exercised by their own suites).
  const OWNER_SKIP = new Set(["POST /api/v1/storefront/read-model/rebuild", "POST /api/payment-admin/ledger/repair", "POST /api/auth/logout-all"]);
  // The sweep reads every cached admin endpoint; drop what it warmed so later files never see a pre-filled cache.
  const CACHE_FAMILIES = ["analytics:", "metrics:", "bi:", "products:", "categories:", "outbox:", "payments:", "banners:", "homepage-sections:", "payment-methods:", "social-links:", "sms-settings:", "settings:"];
  afterAll(async () => {
    for (const prefix of CACHE_FAMILIES) await cacheDelByPrefix(prefix);
  });

  it("covers all 338 admin routes, each with exactly one permission (or explicit self-service)", () => {
    // +13: order adjustments (docs/ORDER_ADJUSTMENTS.md), incl. the return / exchange previews; +2: abandoned-cart list + remind; +5: search synonyms; +1: bulk restore; +1: inventory stock levels; +2: finance transactions + refunds; +1: shell attention composite; +3: saved views; +1: audit facets; +4: delivery zones (Admin V2)
    expect(routes).toHaveLength(338);
    for (const r of routes) expect(routePermission(r), `${r.method} ${r.path}`).not.toBe("(none)");
  });

  it("STAFF is refused (403) exactly on the OWNER-only routes (pre-Phase-10 set + PD-10.1), and allowed everywhere else", async () => {
    const staffSession = adminAgent(staff, "STAFF");
    const denied: string[] = [];
    const wrong: string[] = [];
    for (const r of routes) {
      const res = await call(staffSession, r.method, concrete(r.path));
      const key = `${r.method} ${r.path}`;
      if (res.status === 403) {
        expect(res.body, key).toEqual({ error: "Forbidden" }); // the permission gate, not CSRF
        denied.push(key);
      } else if (res.status === 401) wrong.push(`${key} → 401`);
      const perm = routePermission(r)!;
      if ((res.status === 403) !== ownerOnly.has(perm)) wrong.push(`${key} (${perm}) → ${res.status}`);
    }
    expect(wrong).toEqual([]);
    expect(denied.sort()).toEqual([...OWNER_ONLY_ROUTES].sort());
  });

  it("OWNER passes every permission gate", async () => {
    const ownerSession = adminAgent(owner, "OWNER");
    const blocked: string[] = [];
    for (const r of routes) {
      if (OWNER_SKIP.has(`${r.method} ${r.path}`)) continue;
      const res = await call(ownerSession, r.method, concrete(r.path));
      if (res.status === 401 || res.status === 403) blocked.push(`${r.method} ${r.path} → ${res.status}`);
    }
    expect(blocked).toEqual([]);
  });

  it("a customer session and an anonymous caller get 401 on every admin route", async () => {
    const customer = customerAgent(customerA);
    const leaks: string[] = [];
    for (const r of routes) {
      for (const [who, agent] of [["customer", customer], ["anonymous", anon]] as const) {
        const res = await call(agent, r.method, concrete(r.path));
        if (res.status !== 401) leaks.push(`${who} ${r.method} ${r.path} → ${res.status}`);
      }
    }
    expect(leaks).toEqual([]);
  });
});

describe("owner decisions (BUSINESS_DECISIONS PD-10.1, PD-10.2)", () => {
  it("PD-10.1: permanent coupon / category delete is OWNER-only — STAFF gets 403 and nothing is deleted", async () => {
    const trashedCoupon = () => prisma.coupon.create({ data: { code: `P10PURGE${Math.random().toString(36).slice(2, 8).toUpperCase()}`, type: "FIXED", value: 10, deletedAt: new Date() } });
    const trashedCategory = () => prisma.category.create({ data: { name: `P10 purge ${RUN}`, slug: `p10-purge-${RUN}-${Math.random().toString(36).slice(2, 7)}`, deletedAt: new Date() } });
    const s = adminAgent(staff, "STAFF");
    const o = adminAgent(owner, "OWNER");

    const coupon = await trashedCoupon();
    const staffCoupon = await s.delete(`/api/coupons/${coupon.id}/permanent`);
    expect(staffCoupon.status).toBe(403);
    expect(staffCoupon.body).toEqual({ error: "Forbidden" });
    expect(await prisma.coupon.findUnique({ where: { id: coupon.id } })).not.toBeNull();
    expect((await o.delete(`/api/coupons/${coupon.id}/permanent`)).status).toBeLessThan(300);
    expect(await prisma.coupon.findUnique({ where: { id: coupon.id } })).toBeNull();

    const category = await trashedCategory();
    const staffCategory = await s.delete(`/api/categories/${category.id}/permanent`);
    expect(staffCategory.status).toBe(403);
    expect(staffCategory.body).toEqual({ error: "Forbidden" });
    expect(await prisma.category.findUnique({ where: { id: category.id } })).not.toBeNull();
    expect((await o.delete(`/api/categories/${category.id}/permanent`)).status).toBeLessThan(300);
    expect(await prisma.category.findUnique({ where: { id: category.id } })).toBeNull();

    // Normal coupon / category work is unchanged for STAFF.
    expect((await s.get("/api/coupons")).status).toBe(200);
    expect((await s.get("/api/categories")).status).toBe(200);
    expect(roleHasPermission("STAFF", "promotions.manage") && roleHasPermission("STAFF", "catalog.manage")).toBe(true);
    expect(roleHasPermission("STAFF", "promotions.purge") || roleHasPermission("STAFF", "catalog.purge")).toBe(false);
  });

  it("PD-10.2: STAFF keeps refunds, manual payments, price and loyalty adjustments, bulk SMS, exports and financial analytics (COGS / margin)", async () => {
    for (const p of ["refunds.manage", "payments.record", "orders.adjust_price", "loyalty.adjust", "customers.message", "orders.export", "catalog.export", "analytics.export", "analytics.read"] as const) {
      expect(roleHasPermission("STAFF", p), p).toBe(true);
    }
    const s = adminAgent(staff, "STAFF");
    // Writes reach their handler (404 for a missing order / customer, 400 for an empty body) — never 401 / 403.
    const writes: Array<[string, Promise<request.Response>]> = [
      ["refund", s.post("/api/orders/p10-missing/refunds", { amount: 1 })],
      ["manual payment", s.post("/api/orders/p10-missing/payments", { amount: 1, method: "Cash" })],
      ["price adjustment", s.patch("/api/orders/p10-missing/price", { priceAdjustment: -1 })],
      ["loyalty adjustment", s.post("/api/customers/admin/p10-missing/points", { points: 1, reason: "PD-10.2" })],
      ["bulk SMS", s.post("/api/customers/admin/bulk/sms", {})],
    ];
    for (const [what, pending] of writes) {
      const res = await pending;
      expect([401, 403], `${what} → ${res.status}`).not.toContain(res.status);
    }
    // Reads answer 200.
    for (const url of ["/api/orders/export/csv", "/api/products/export/csv", "/api/analytics/export/revenue.csv", "/api/analytics/profit-trend", "/api/analytics/financial-costs", "/api/analytics/highest-profit-products", "/api/v1/metrics?metrics=cogs,gross_margin"]) {
      const res = await s.get(url);
      expect(res.status, url).toBe(200);
    }
    const metrics = (await s.get("/api/v1/metrics?metrics=cogs,gross_margin")).body.metrics;
    expect(metrics).toHaveProperty("cogs");
    expect(metrics).toHaveProperty("gross_margin");
  });
});

describe("customer ownership", () => {
  async function orderFor(customerId: string, phone: string) {
    const { variants } = await createStockedProduct({ stocks: [5], basePrice: 1000 });
    const order = await createOrder(checkout([{ variantId: variants[0]!.id, quantity: 1 }], { customerPhone: phone }), customerId);
    trackOrder(order.id);
    return order;
  }

  it("reads its own order; another customer's order, address and return request are refused", async () => {
    const phoneA = (await prisma.customer.findUniqueOrThrow({ where: { id: customerA } })).phone!;
    const phoneB = (await prisma.customer.findUniqueOrThrow({ where: { id: customerB } })).phone!;
    const mine = await orderFor(customerA, phoneA);
    const theirs = await orderFor(customerB, phoneB);
    const a = customerAgent(customerA);

    expect((await a.get(`/api/customers/me/orders/${mine.id}`)).status).toBe(200);
    expect((await a.get(`/api/customers/me/orders/${theirs.id}`)).status).toBe(404); // safe response: no existence hint
    const list = await a.get("/api/customers/me/orders");
    expect(list.body.items.map((o: { id: string }) => o.id)).toContain(mine.id);
    expect(list.body.items.map((o: { id: string }) => o.id)).not.toContain(theirs.id);

    const addressB = await prisma.address.create({ data: { customerId: customerB, label: "Home", fullName: "B", phone: phoneB, division: "Dhaka", district: "Dhaka", area: "Uttara", addressLine: "House 9" } });
    expect((await a.patch(`/api/customers/me/addresses/${addressB.id}`, { label: "Mine now" })).status).toBe(404);
    expect((await a.delete(`/api/customers/me/addresses/${addressB.id}`)).status).toBe(404);
    expect((await prisma.address.findUniqueOrThrow({ where: { id: addressB.id } })).label).toBe("Home");
    expect((await a.get("/api/customers/me/addresses")).body.addresses.map((x: { id: string }) => x.id)).not.toContain(addressB.id);

    await updateOrderStatus(theirs.id, { status: "DELIVERED" }, owner);
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: theirs.id } });
    expect((await a.post("/api/return-requests", { orderId: theirs.id, type: "RETURN", reason: "not mine", orderItemId: item.id })).status).toBe(404);
    expect((await a.get("/api/customers/me/points")).body.items.every((e: { customerId?: string }) => !e.customerId || e.customerId === customerA)).toBe(true);

    // Guest tracking needs the order's phone too.
    expect((await anon.post("/api/orders/track", { orderNumber: theirs.orderNumber, phone: phoneA })).status).toBe(404);
    expect((await anon.post("/api/orders/track", { orderNumber: theirs.orderNumber, phone: phoneB })).status).toBe(200);
  });
});

describe("sensitive data never reaches a customer", () => {
  const STAFF_ONLY = ["adminNotes", "callAttempts", "followUpAt", "courierSyncError", "courierBookingStartedAt", "idempotencyKey", "paymentSessionKey", "sessionId", "deletedAt", "deletedByAdminId", "partialDeliveryReconciledAt", "couponReleasedAt"];
  const ITEM_INTERNAL = ["unitCostSnapshot", "productIdSnapshot", "categoryIdSnapshot", "categoryNameSnapshot", "brandSnapshot", "flashSaleId", "flashSaleItemId", "restockedQuantity"];

  function expectCustomerSafe(order: Record<string, unknown>, where: string) {
    for (const f of STAFF_ONLY) expect(order, `${where}: ${f}`).not.toHaveProperty(f);
    for (const item of (order.items as Array<Record<string, unknown>>) ?? []) for (const f of ITEM_INTERNAL) expect(item, `${where}: item.${f}`).not.toHaveProperty(f);
    for (const entry of (order.statusHistory as Array<Record<string, unknown>>) ?? []) {
      expect(entry, `${where}: history`).not.toHaveProperty("changedByAdmin");
      expect(entry, `${where}: history`).not.toHaveProperty("changedByAdminId");
    }
    expect(JSON.stringify(order), where).not.toContain("P10-INTERNAL");
  }

  it("P0-04: the public category stock summary carries availability counts only; unit quantities stay admin-only", async () => {
    const { categoryId } = await createStockedProduct({ stocks: [7, 0] });
    const category = await prisma.category.findUniqueOrThrow({ where: { id: categoryId } });

    const pub = await anon.get(`/api/categories/slug/${category.slug}/stock`);
    expect(pub.status).toBe(200);
    for (const stat of [pub.body.total, ...pub.body.subcategories]) {
      expect(Object.keys(stat).filter((k) => !["id", "name", "slug"].includes(k)).sort()).toEqual(["inStockProducts", "totalProducts"]);
    }
    expect(pub.body.total.inStockProducts).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(pub.body)).not.toMatch(/stock"\s*:|totalStock/i);

    expect((await anon.get("/api/categories/stock-map")).status).toBe(401);
    expect((await customerAgent(customerA).get("/api/categories/stock-map")).status).toBe(401);
    const admin = await adminAgent(staff, "STAFF").get("/api/categories/stock-map");
    expect(admin.status).toBe(200);
    expect(admin.body.stock[categoryId].totalStock).toBeGreaterThanOrEqual(7);
  });

  it("order detail, list, guest tracking and the checkout response carry no staff-only fields, staff notes or cost", async () => {
    const phone = (await prisma.customer.findUniqueOrThrow({ where: { id: customerA } })).phone!;
    const { variants } = await createStockedProduct({ stocks: [5], basePrice: 1000 });
    const created = await customerAgent(customerA).post("/api/orders", checkout([{ variantId: variants[0]!.id, quantity: 1 }], { customerPhone: phone }));
    expect(created.status).toBe(201);
    const orderId = created.body.order.id as string;
    trackOrder(orderId);
    expectCustomerSafe(created.body.order, "checkout response");

    // Staff-only data on the order: an internal note, a follow-up hold with a staff annotation, a status change by staff.
    await prisma.order.update({ where: { id: orderId }, data: { adminNotes: "P10-INTERNAL fraud check pending" } });
    await holdOrderForFollowUp(orderId, { followUpAt: new Date(Date.now() + 3_600_000), note: "P10-INTERNAL call after 6pm" }, owner);
    await updateOrderStatus(orderId, { status: "CONFIRMED", note: "Confirmed by phone" }, owner);

    const a = customerAgent(customerA);
    const detail = (await a.get(`/api/customers/me/orders/${orderId}`)).body.order;
    expectCustomerSafe(detail, "order detail");
    // The status journey stays: PENDING → CONFIRMED with the note written on that change; the same-status hold is internal.
    expect(detail.statusHistory.map((h: { status: string }) => h.status)).toEqual(["PENDING", "CONFIRMED"]);
    expect(detail.statusHistory[1].note).toBe("Confirmed by phone");
    const listed = (await a.get("/api/customers/me/orders")).body.items.find((o: { id: string }) => o.id === orderId);
    expectCustomerSafe(listed, "order list");
    const tracked = (await anon.post("/api/orders/track", { orderNumber: detail.orderNumber, phone })).body.order;
    expectCustomerSafe(tracked, "guest tracking");

    // The staff view is unchanged: the internal note and the full timeline are there for admins.
    const adminView = (await adminAgent(staff, "STAFF").get(`/api/orders/${orderId}`)).body.order;
    expect(adminView.adminNotes).toContain("P10-INTERNAL");
    expect(adminView.statusHistory.length).toBeGreaterThan(detail.statusHistory.length);
    expect(adminView.items[0]).not.toHaveProperty("unitCostSnapshot"); // recorded cost stays server-side for everyone (Phase 6)
  });

  it("a customer's return requests don't carry the reviewing admin", async () => {
    const res = await customerAgent(customerA).get("/api/return-requests/mine");
    expect(res.status).toBe(200);
    for (const r of res.body.items) expect(r).not.toHaveProperty("reviewedByAdminId");
  });
});

describe("privilege escalation", () => {
  it("STAFF can't manage admins, invite an owner, set a password, read the audit log or run repairs", async () => {
    const s = adminAgent(staff, "STAFF");
    expect((await s.patch(`/api/auth/admins/${staff}`, { role: "OWNER" })).status).toBe(403);
    expect((await s.patch(`/api/auth/admins/${owner}`, { role: "STAFF" })).status).toBe(403);
    expect((await s.patch(`/api/auth/admins/${owner}/active`, { isActive: false })).status).toBe(403);
    expect((await s.patch(`/api/auth/admins/${owner}/password`, { password: "Hijack12345!" })).status).toBe(403);
    expect((await s.post("/api/auth/admin-invites", { email: `p10-evil-${RUN}@example.com`, name: "Evil", role: "OWNER" })).status).toBe(403);
    expect((await s.get("/api/audit-logs")).status).toBe(403);
    expect((await s.get("/api/sms-settings")).status).toBe(403);
    expect((await s.post("/api/v1/outbox/p10-missing/retry")).status).toBe(403);
    expect((await s.post("/api/payment-admin/ledger/repair", {})).status).toBe(403);
    expect((await prisma.adminUser.findUniqueOrThrow({ where: { id: staff } })).role).toBe("STAFF");
    expect((await prisma.adminUser.findUniqueOrThrow({ where: { id: owner } })).isActive).toBe(true);
    expect(await prisma.adminInvite.count({ where: { email: `p10-evil-${RUN}@example.com` } })).toBe(0);
  });

  it("P0-02: an omitted role never makes an OWNER — the column defaults to STAFF and an invite must name its role", async () => {
    const implicit = await prisma.adminUser.create({
      data: { name: "P0 implicit", email: `p0-implicit-${RUN}@example.com`, passwordHash: await bcrypt.hash("x", 4) },
    });
    createdAdmins.push(implicit.id);
    expect(implicit.role).toBe("STAFF");
    expect((await adminAgent(implicit.id, "STAFF").patch(`/api/auth/admins/${staff}`, { role: "OWNER" })).status).toBe(403);

    const email = `p0-norole-${RUN}@example.com`;
    expect((await adminAgent(owner, "OWNER").post("/api/auth/admin-invites", { email, name: "No role" })).status).toBe(400);
    expect(await prisma.adminInvite.count({ where: { email } })).toBe(0);
  });

  it("role and active changes are audited with before/after", async () => {
    const temp = await makeAdmin("STAFF", "audited");
    const o = adminAgent(owner, "OWNER");
    expect((await o.patch(`/api/auth/admins/${temp}`, { role: "OWNER" })).status).toBe(200);
    expect((await o.patch(`/api/auth/admins/${temp}/active`, { isActive: false })).status).toBe(200);
    await eventually(async () => (await prisma.auditLog.count({ where: { entityId: temp } })) >= 2);
    const rows = await prisma.auditLog.findMany({ where: { entityId: temp }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.action)).toEqual(["admins.role_change", "admins.deactivate"]);
    expect(rows[0]!.metadata).toMatchObject({ before: { role: "STAFF" }, after: { role: "OWNER" } });
    expect(rows[1]!.metadata).toMatchObject({ before: { isActive: true }, after: { isActive: false } });
    await prisma.auditLog.deleteMany({ where: { entityId: temp } });
  });

  it("an export is audited (bulk data leaving the system)", async () => {
    const before = await prisma.auditLog.count({ where: { adminId: staff, action: "orders.export" } });
    expect((await adminAgent(staff, "STAFF").get("/api/orders/export/csv")).status).toBe(200);
    await eventually(async () => (await prisma.auditLog.count({ where: { adminId: staff, action: "orders.export" } })) > before);
    expect(await prisma.auditLog.count({ where: { adminId: staff, action: "orders.export" } })).toBe(before + 1);
  });

  it("the store always keeps an active owner — also when two owners demote each other at once", async () => {
    // Make the two test owners the only active owners for the duration (restored in finally).
    const others = (await prisma.adminUser.findMany({ where: { role: "OWNER", isActive: true, id: { notIn: [secondOwner] } }, select: { id: true } })).map((a) => a.id);
    const thirdOwner = await makeAdmin("OWNER", "owner3");
    try {
      await prisma.adminUser.updateMany({ where: { id: { in: others } }, data: { isActive: false } });
      const a = adminAgent(secondOwner, "OWNER");
      const b = adminAgent(thirdOwner, "OWNER");
      const [r1, r2] = await Promise.all([a.patch(`/api/auth/admins/${thirdOwner}`, { role: "STAFF" }), b.patch(`/api/auth/admins/${secondOwner}/active`, { isActive: false })]);
      expect([r1.status, r2.status].sort()).toEqual([200, 409]); // exactly one wins
      expect(await prisma.adminUser.count({ where: { role: "OWNER", isActive: true } })).toBe(1);
      const survivor = (await prisma.adminUser.findFirstOrThrow({ where: { role: "OWNER", isActive: true } })).id;
      const other = survivor === secondOwner ? thirdOwner : secondOwner;
      // The survivor can't be removed by the (now non-owner) other; and can't demote or deactivate itself.
      expect((await adminAgent(other, "OWNER").patch(`/api/auth/admins/${survivor}`, { role: "STAFF" })).status).toBeGreaterThanOrEqual(401);
      expect((await adminAgent(survivor, "OWNER").patch(`/api/auth/admins/${survivor}`, { role: "STAFF" })).status).toBe(400);
    } finally {
      await prisma.adminUser.updateMany({ where: { id: { in: others } }, data: { isActive: true } });
    }
    expect(await prisma.adminUser.count({ where: { id: owner, isActive: true, role: "OWNER" } })).toBe(1);
  });
});

describe("integration boundaries are not user RBAC", () => {
  it("the courier webhook authenticates by its own token, never by an admin session", async () => {
    const res = await adminAgent(owner, "OWNER").post("/api/courier/steadfast/webhook?token=wrong", { consignment_id: 1 });
    expect(res.status).toBe(401);
  });
});
