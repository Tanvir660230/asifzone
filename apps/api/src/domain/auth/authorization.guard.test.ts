import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { PERMISSIONS } from "@clothing-brand/shared";
import { listRoutes, routePermission } from "../../test-routes";
import { requirePermission } from "../../middlewares/require-admin";
import { AppError } from "../../lib/app-error";

// Phase 10 (docs/PHASE_10_AUDIT.md) architecture guards: one authorization model, enforced on the server, stated per route.

const API = join(__dirname, "..", "..");
const WEB = join(API, "..", "..", "web");
const SHARED = join(API, "..", "..", "..", "packages", "shared", "src");
const code = (file: string) =>
  readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*\*|\/\*)/.test(l))
    .join("\n");
function files(dir: string, ext: RegExp, skip = /node_modules|\.next|dist|e2e/): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (skip.test(p)) return [];
    return statSync(p).isDirectory() ? files(p, ext, skip) : ext.test(name) ? [p] : [];
  });
}
const apiSource = files(API, /\.ts$/).filter((f) => !/\.test\.ts$|test-(fixtures|routes|guard|setup)\.ts$/.test(f));
const webSource = files(WEB, /\.(ts|tsx)$/);

/** The audited public surface (docs/PHASE_10_AUDIT.md §B): storefront reads, auth bootstrap, checkout / quote, guest
 * tracking (order number + phone), beacons, provider callbacks. A new unauthenticated route is a deliberate decision. */
const PUBLIC_ROUTES = [
  "GET /health",
  "POST /api/auth/login",
  "POST /api/auth/google",
  "POST /api/auth/logout",
  "POST /api/auth/refresh",
  "POST /api/auth/admin-invites/accept",
  "GET /api/categories/tree",
  "GET /api/categories/slug/:slug",
  "GET /api/categories/slug/:slug/stock",
  "GET /api/attributes/",
  "GET /api/attributes/:id",
  "GET /api/products/storefront",
  "GET /api/products/storefront/facets",
  "GET /api/products/storefront/by-ids",
  "GET /api/products/storefront/trending",
  "GET /api/products/storefront/recommended",
  "GET /api/products/storefront/suggest",
  "GET /api/products/storefront/popular-searches",
  "GET /api/products/slug/:slug",
  "GET /api/products/:id/similar",
  "GET /api/products/:id/rail/:key",
  "GET /api/products/:id/frequently-bought-together",
  "GET /api/products/:id/complete-your-look",
  "GET /api/products/:id/budget-alternatives",
  "GET /api/products/:id/upgrade-options",
  "GET /api/products/:id/premium-alternatives",
  "GET /api/products/:id/urgency-signals",
  "POST /api/products/:id/view",
  "POST /api/orders/",
  "POST /api/orders/track",
  "POST /api/orders/:orderNumber/retry-payment",
  "POST /api/coupons/validate",
  "POST /api/coupons/best",
  "GET /api/coupons/active",
  "GET /api/bundles/for-product/:productId",
  "POST /api/bundles/preview",
  "GET /api/reviews/",
  "GET /api/redirects/active",
  "POST /api/payments/sslcommerz/success",
  "POST /api/payments/sslcommerz/fail",
  "POST /api/payments/sslcommerz/cancel",
  "POST /api/payments/sslcommerz/ipn",
  "GET /api/payments/eps/success",
  "GET /api/payments/eps/fail",
  "GET /api/payments/eps/cancel",
  "GET /api/payment-methods/active",
  "GET /api/flash-sales/active",
  "GET /api/banners/active",
  "GET /api/homepage-sections/active",
  "GET /api/social-links/active",
  "POST /api/newsletter/subscribe",
  "POST /api/feedback/",
  "POST /api/customers/register",
  "POST /api/customers/login",
  "POST /api/customers/logout",
  "POST /api/customers/refresh",
  "POST /api/customers/forgot-password",
  "POST /api/customers/reset-password",
  "POST /api/customers/verify-email",
  "POST /api/customers/unsubscribe",
  "POST /api/customers/google",
  "POST /api/customers/otp/request",
  "POST /api/customers/otp/verify",
  "POST /api/analytics/pageview",
  "POST /api/analytics/pageview/:id/exit",
  "POST /api/analytics/funnel-event",
  "POST /api/analytics/search-session",
  "GET /api/settings/",
  "POST /api/courier/steadfast/webhook",
  "POST /api/v1/checkout/quote",
  "POST /api/v1/checkout/quote/best-coupon",
];

/** Self-service admin routes: own session and own notifications — no permission, by design. */
const SELF_SERVICE = ["GET /api/auth/me", "GET /api/auth/sessions", "POST /api/auth/logout-all", "GET /api/notifications/", "POST /api/notifications/:id/read", "POST /api/notifications/read-all"];

describe("requirePermission on its own (defence in depth, independent of route order)", () => {
  const run = (admin: unknown) => {
    let result: unknown = "not called";
    requirePermission("orders.delete")({ admin } as never, {} as never, (err?: unknown) => (result = err ?? "next"));
    return result;
  };
  it("no identity → 401, missing permission → 403, holding it → next()", () => {
    expect(run(undefined)).toMatchObject({ statusCode: 401 });
    expect(run({ adminId: "a", role: "STAFF", permissions: ["orders.read"] })).toMatchObject({ statusCode: 403, message: "Forbidden" });
    expect(run({ adminId: "a", role: "OWNER", permissions: ["orders.delete"] })).toBe("next");
    expect(run(undefined)).toBeInstanceOf(AppError);
  });
});

describe("authorization — architecture guards", () => {
  const routes = listRoutes();
  const admin = routes.filter((r) => routePermission(r) !== null);

  it("every admin route states exactly one decision — a known permission, after authentication — or is a named self-service route", () => {
    const problems: string[] = [];
    for (const r of admin) {
      const key = `${r.method} ${r.path}`;
      const decisions = r.chain.filter((n) => n.startsWith("requirePermission(") || n === "requireSelf");
      if (decisions.length !== 1) problems.push(`${key}: ${decisions.length} decisions`);
      const perm = routePermission(r)!;
      if (perm === "(self)") {
        if (!SELF_SERVICE.includes(key)) problems.push(`${key}: self-service not in the allowlist`);
      } else if (!perm.split(",").every((p) => (PERMISSIONS as readonly string[]).includes(p))) problems.push(`${key}: unknown permission ${perm}`);
      if (r.chain.indexOf("requireAdmin") > r.chain.findIndex((n) => n.startsWith("requirePermission(") || n === "requireSelf")) problems.push(`${key}: decision before authentication`);
    }
    expect(problems).toEqual([]);
    expect(admin.filter((r) => routePermission(r) === "(self)").map((r) => `${r.method} ${r.path}`).sort()).toEqual([...SELF_SERVICE].sort());
  });

  it("no route is public unless it is on the audited public list (an alternate route can't bypass authorization)", () => {
    const publicNow = routes.filter((r) => !r.chain.includes("requireAdmin") && !r.chain.includes("requireCustomer")).map((r) => `${r.method} ${r.path}`);
    expect(publicNow.sort()).toEqual([...PUBLIC_ROUTES].sort());
  });

  it("no permission middleware sits on a route without authentication (it would never see an admin)", () => {
    const orphans = routes.filter((r) => !r.chain.includes("requireAdmin") && r.chain.some((n) => n.startsWith("requirePermission(") || n === "requireSelf"));
    expect(orphans.map((r) => `${r.method} ${r.path}`)).toEqual([]);
  });

  it("ops, outbox, repair, user-management and audit routes are never public or customer routes", () => {
    const sensitive = routes.filter((r) => /^\/api\/(v1\/(ops|outbox|metrics\/consistency|storefront\/read-model)|payment-admin|auth\/admin|audit-logs|sms-settings)/.test(r.path) && r.path !== "/api/auth/admin-invites/accept");
    expect(sensitive.length).toBeGreaterThan(15);
    for (const r of sensitive) {
      expect(routePermission(r), `${r.method} ${r.path}`).toMatch(/^(ops\.|users\.manage|audit\.read|settings\.manage|payments\.read)/);
    }
  });

  it("role logic lives in one place: no requireRole, no role-string comparisons outside the auth module", () => {
    const offenders = apiSource
      .filter((f) => !/domain[\\/]auth[\\/]|modules[\\/]auth[\\/]auth\.service\.ts$/.test(f))
      .filter((f) => /\brequireRole\b|\.role\s*[!=]==\s*"(OWNER|STAFF)"|role\s*[!=]==\s*"(OWNER|STAFF)"/.test(code(f)))
      .map((f) => relative(API, f));
    expect(offenders).toEqual([]);
  });

  it("the permission vocabulary and role map are defined once (packages/shared) — the web never re-derives them", () => {
    expect(code(join(SHARED, "permissions.ts"))).toMatch(/export const ROLE_PERMISSIONS/);
    const redefined = [...apiSource, ...webSource].filter((f) => /ROLE_PERMISSIONS\s*[:=]|OWNER_ONLY_PERMISSIONS\s*=|const PERMISSIONS\s*=/.test(code(f)));
    expect(redefined.map((f) => relative(API, f))).toEqual([]);
    const webDerives = webSource.filter((f) => /\b(ROLE_PERMISSIONS|permissionsForRole|roleHasPermission|OWNER_ONLY_PERMISSIONS)\b/.test(code(f)));
    expect(webDerives.map((f) => relative(WEB, f))).toEqual([]);
  });

  it("the web decides visibility from the permissions the API returns, never by comparing role strings", () => {
    // Allowed: showing the role as a label (the shell header, the team list).
    const DISPLAY_ONLY = /app[\\/]admin[\\/]\(shell\)[\\/](layout\.tsx|team[\\/]page\.tsx)$/;
    const offenders = webSource.filter((f) => !DISPLAY_ONLY.test(f)).filter((f) => /role\s*[!=]==\s*"(OWNER|STAFF)"/.test(code(f)));
    expect(offenders.map((f) => relative(WEB, f))).toEqual([]);
    expect(code(join(WEB, "lib", "auth.ts"))).toMatch(/export function adminCan\(/);
  });

  it("authentication re-reads the admin from the database; tokens carry a type", () => {
    expect(code(join(API, "middlewares", "require-admin.ts"))).toMatch(/resolveAdminIdentity\(/);
    expect(code(join(API, "domain", "auth", "authorization.ts"))).toMatch(/prisma\.adminUser\.findUnique\(/);
    expect(code(join(API, "domain", "auth", "authorization.ts"))).toMatch(/!admin\.isActive/);
    expect(code(join(API, "lib", "jwt.ts"))).toMatch(/payload\.typ !== ADMIN_TOKEN_TYPE/);
    expect(code(join(API, "lib", "customer-jwt.ts"))).toMatch(/payload\.typ !== CUSTOMER_TOKEN_TYPE/);
  });

  it("every customer-facing order response goes through the customer view", () => {
    const orderCtl = code(join(API, "modules", "orders", "order.controller.ts"));
    expect(orderCtl).toMatch(/json\(\{ order: toCustomerOrder\(order\) \}\)/); // checkout
    expect(orderCtl).toMatch(/order: toCustomerOrder\(await orderService\.trackOrder\(/); // guest tracking
    const customerCtl = code(join(API, "modules", "customers", "customer.controller.ts"));
    expect(customerCtl).toMatch(/items: result\.items\.map\(toCustomerOrder\)/);
    expect(customerCtl).toMatch(/order: toCustomerOrder\(order\)/);
    const returnsCtl = code(join(API, "modules", "return-requests", "return-request.controller.ts"));
    expect(returnsCtl).toMatch(/items: result\.items\.map\(toCustomerReturnRequest\)/);
    expect(returnsCtl).toMatch(/request: toCustomerReturnRequest\(request\)/);
    // The view is a whitelist, and it never names cost or staff-only fields.
    const view = code(join(API, "modules", "orders", "customer-order-view.ts"));
    for (const f of ["adminNotes", "unitCostSnapshot", "changedByAdmin", "idempotencyKey", "callAttempts", "categoryIdSnapshot"]) expect(view).not.toContain(`"${f}"`);
  });

  it("admin-account changes go through the owner-protected service, never a direct write elsewhere", () => {
    const writers = apiSource
      .filter((f) => /adminUser\.(update|updateMany|delete|deleteMany|create|upsert)\(/.test(code(f)))
      .map((f) => relative(API, f).replace(/\\/g, "/"));
    expect(writers.sort()).toEqual(["modules/auth/auth.service.ts"]);
    expect(code(join(API, "modules", "auth", "auth.service.ts"))).toMatch(/assertKeepsAnActiveOwner\(tx, adminId/);
  });
});
