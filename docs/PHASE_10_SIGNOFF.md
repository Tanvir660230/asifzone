# Phase 10 Sign-off: Roles, Permissions & Authorization Hardening

**Branch:** `phase-10/authorization-hardening` (from Phase 9 `d12574f`).
**Audit and boundary:** [PHASE_10_AUDIT.md](PHASE_10_AUDIT.md).
**Status:** ready for review, awaiting approval.

**Invariant delivered (SSOT_REGISTRY I36):**
- every sensitive operation has one server-side authorization boundary;
- customers reach only their own resources and never staff-only data;
- STAFF cannot escalate;
- the model is defined once, so another installation reuses it by changing a map, not by copying checks.

## 1. Scope delivered

| Audit gap | Fix |
|---|---|
| G-1 stale privilege (R16) | `requireAdmin` verifies the token, then resolves the admin **from the database on every request** (`domain/auth/authorization.ts` → `resolveAdminIdentity`). A missing or deactivated admin → 401. The **current** role decides, so deactivation and demotion apply on the next request |
| G-2 token confusion | Admin tokens carry `typ: "admin"` and customer tokens `typ: "customer"`. Each verifier refuses the other's token, whatever the secrets |
| G-3 customer data leakage | `modules/orders/customer-order-view.ts` (`toCustomerOrder`, `toCustomerReturnRequest`): **one whitelist** for everything a customer or guest receives about an order, covering checkout response, guest tracking, account list and detail, return requests. The customer timeline shows the status journey (P10-1) |
| G-4 no permission model | `packages/shared/src/permissions.ts`: 34 permissions and `ROLE_PERMISSIONS`. `requirePermission()` on **every** admin route replaces `requireRole()`. Six self-service routes are explicit (`requireSelf`). `/auth/me`, login and refresh return the resolved `permissions`; the web uses `adminCan()` |
| G-5 last owner | `assertKeepsAnActiveOwner` locks the active-owner rows; demoting or deactivating the last active OWNER → 409 (P10-2) |
| G-7 traceability | Role and active changes audited as `admins.role_change` / `admins.activate` / `admins.deactivate` with before/after; exports audited as `<entity>.export` |

**No schema change and no migration.** Permissions are code-level, mapped from the existing `AdminRole` enum.

**No role capability changed.** The STAFF grant reproduces the pre-Phase-10 boundary exactly: 0 differences on all 299
admin routes, verified by script and pinned by a test. PD-10.1 and PD-10.2 remain open for the owner.

## 2. Identity model

| Identity | Authenticated by | Authorized by |
|---|---|---|
| OWNER / STAFF | admin access cookie (`typ: admin`, 15 min) + DB lookup per request; rotating DB refresh tokens | `requirePermission(p)` over `ROLE_PERMISSIONS[currentRole]` |
| Customer | customer access cookie (`typ: customer`); refresh pinned to `tokenVersion` | ownership: every resource resolved through `req.customer.customerId` |
| Guest | none | order number **and** the order's phone (tracking, payment retry) |
| Provider | SSLCommerz / EPS server-to-server verification; Steadfast token (constant-time) + re-fetch | not user RBAC; idempotent handlers (Phases 4, 9) |
| Web ↔ API | `X-Revalidate-Secret` | internal only |
| Workers / crons | in-process | trusted system boundary; they run system events, never operator actions |

## 3. Permission vocabulary and role model

| Permission | Covers | OWNER | STAFF |
|---|---|:-:|:-:|
| `users.manage` | admins, invites, roles, admin passwords | ✅ | — |
| `audit.read` | audit log | ✅ | — |
| `catalog.read` / `catalog.manage` | catalog reads / products, categories, attributes, images (incl. current cost) | ✅ | ✅ |
| `catalog.configure` | product types, templates, guides, materials, SKU pattern, sections | ✅ | — |
| `catalog.export` | product CSV / full export | ✅ | ✅ |
| `catalog.purge`, `products.import` | permanent product delete, bulk import | ✅ | — |
| `ai.use` | billed AI generation | ✅ | — |
| `orders.read` / `orders.manage` | orders / manual order, status, details, follow-up, reconcile | ✅ | ✅ |
| `orders.adjust_price`, `orders.export` | price adjustment, order CSV | ✅ | ✅ |
| `orders.delete` | delete / restore / permanent | ✅ | — |
| `payments.read`, `payments.record`, `refunds.manage` | ledger views, manual payment, refunds | ✅ | ✅ |
| `returns.manage`, `courier.manage` | returns and exchanges, courier | ✅ | ✅ |
| `promotions.manage`, `content.manage` | coupons, bundles, flash sales / storefront content | ✅ | ✅ |
| `storefront.configure`, `settings.manage` | redirects, social links / store and SMS-provider settings | ✅ | — |
| `customers.read` / `customers.manage` / `customers.message` | customers / CRM flags / ad-hoc and bulk SMS | ✅ | ✅ |
| `loyalty.adjust`, `campaigns.manage` | points adjustment / campaigns, SMS templates | ✅ | ✅ |
| `analytics.read`, `analytics.export` | analytics, BI, metrics / CSV exports | ✅ | ✅ |
| `inventory.read`, `inventory.adjust` | stock ledger / adjustment | ✅ | ✅ |
| `ops.read` / `ops.repair` | outbox, reliability, drift / outbox retry, ledger repair, read-model rebuild | ✅ | ✅ / — |

- **OWNER** holds everything. It can't demote or deactivate itself, and the last active OWNER can't be removed.
- **STAFF** holds everything except the 10 OWNER-only permissions. It can't grant itself anything: role and permission
  changes need `users.manage`, and permissions aren't stored per user.
- **Customers** have no permissions. They are authorized by ownership.

## 4. Authorization flow, 401 / 403

```text
admin cookie → requireAdmin: JWT (typ=admin) → AdminUser by id, active? → req.admin {adminId, current role, permissions}   ✗ → 401
             → requirePermission(p) / requireSelf                                                                         ✗ → 403 {"error":"Forbidden"}
             → validate → controller → domain service (resource checks: refund ↔ order, image ↔ product, item ↔ sale)
customer cookie → requireCustomer (typ=customer) → service scoped by customerId → another customer's resource → 404 (no existence hint)
```

- **401:** no valid identity for this surface. A customer session on an admin route is 401, since it isn't an admin
  identity.
- **403:** an authenticated admin without the permission, with a generic body.
- The only other 403 is CSRF, which has its own message.

## 5. Sensitive-data classification

| Class | Examples | Customer / guest | STAFF | OWNER |
|---|---|:-:|:-:|:-:|
| Recorded cost | `OrderItem.unitCostSnapshot` | never (global omit, Phase 6) | metrics only, server-side | metrics only |
| Current cost | `Product/Variant.costPrice` | never (the storefront's public product select excludes `costPrice` and `taxRate`) | `catalog.manage` | ✅ |
| Staff notes / identities | `Order.adminNotes`, timeline actor, same-status annotations, `reviewedByAdminId` | never (`toCustomerOrder`) | ✅ | ✅ |
| Operational state | call attempts, follow-up, courier sync errors and claims, idempotency / session keys, deletion markers | never | ✅ | ✅ |
| Internal attribution | product / category / brand snapshots, flash-sale item ids | never | ✅ | ✅ |
| Customer PII | name, phone, address, email | own orders only | `orders.read`, `customers.read` | ✅ |
| Payment / refund data | ledger rows | own totals and status | `payments.read` | ✅ |
| Financial reports, metrics | revenue, COGS, margin | never | `analytics.read` (PD-10.2) | ✅ |
| Admin accounts, audit log | roles, IPs, activity | never | never | ✅ |
| Provider credentials | SMS settings | never | never | `settings.manage` |

## 6. Webhooks and ops endpoints

- **Webhooks stay outside user RBAC**, and an admin session doesn't open them. Verified: the Steadfast webhook
  answers 401 to an OWNER session with a wrong token.
- **Ops endpoints:** reliability, outbox status, metrics consistency and read-model drift need `ops.read`. Outbox
  retry, payment-ledger repair and read-model rebuild need `ops.repair` (OWNER). The payment-ledger views need
  `payments.read`.
- **Public surface:** none of these is public or customer-reachable. The 71 public routes are pinned by a guard.

## 7. Evidence

### 7.1 Authorization test matrix (`domain/auth/authorization.integration.test.ts`, 16 tests)

| Area | What is proven |
|---|---|
| Authentication (401) | no cookie; garbage token; wrong-secret token; expired token; a customer-typed token signed with the **admin** secret; an admin token without `typ`; an unknown admin id → all 401. An admin token as a customer cookie → 401 |
| Immediate revocation | a **deactivated** admin's unexpired token → 401 on the next request. A **demoted** owner (token still says OWNER) → 403 `{"error":"Forbidden"}` on `users.manage` at once, and still a valid STAFF session |
| `/auth/me` | returns exactly `ROLE_PERMISSIONS[currentRole]` (OWNER: all 34) |
| Role matrix: **all 299 admin routes** × STAFF | 403 **exactly** on the 60 routes that were `requireRole(OWNER)` before Phase 10, pinned verbatim; allowed (never 401/403) on the other 239 |
| Role matrix × OWNER | passes every permission gate (3 broad side-effect routes skipped; each has its own suite) |
| Role matrix × customer and anonymous | 401 on every one of the 299 admin routes (598 requests) |
| Ownership | a customer reads its own order (200). Another customer's order → 404; their address update/delete → 404, row unchanged; their order in a return request → 404. Guest tracking needs the order's phone |
| Sensitive data | checkout response, order detail, order list and guest tracking carry none of `adminNotes`, staff identities, call/follow-up state, courier sync errors or claims, idempotency / session keys, deletion markers, internal attribution or cost. A staff note (`P10-INTERNAL`) never appears. The timeline is `PENDING → CONFIRMED` with the transition note, and the same-status follow-up hold stays internal. The admin view still has all of it (and no recorded cost). Return requests don't carry `reviewedByAdminId` |
| Privilege escalation | STAFF can't promote itself, demote or deactivate an owner, set an owner's password, invite an OWNER, read the audit log or SMS settings, retry the outbox or repair the ledger. Nothing changed in the DB |
| Last owner | two owners demoting / deactivating each other **concurrently** → exactly one 200, one 409, one active owner remains; the survivor can't demote itself (400) |
| Audit | role change and deactivation audited with before/after; an order export audited as `orders.export` |
| Integration boundary | the Steadfast webhook answers 401 to an OWNER session with a wrong token |

### 7.2 Architecture guards (`domain/auth/authorization.guard.test.ts`, 11 tests)

The guards check that:
- every admin route states exactly one decision, a known permission placed after authentication, or is one of 6
  named self-service routes;
- no permission middleware sits on a route without authentication;
- the public surface equals the 71 audited public routes, so an alternate route can't bypass authorization;
- ops, outbox, repair, user-management, audit and SMS-settings routes carry `ops.*`, `users.manage`, `audit.read`,
  `settings.manage` or `payments.read`;
- there is no `requireRole` and no role-string comparison outside the auth module;
- the vocabulary and role map are defined once and the web never re-derives them;
- the web decides visibility by `adminCan()`, never by role strings (display labels excepted);
- authentication re-reads the admin from the DB, and tokens are typed;
- every customer-facing order response goes through the customer view, a whitelist that names no staff or cost field;
- only `auth.service` writes `AdminUser`, and it applies the last-owner protection;
- `requirePermission` on its own answers 401 without an identity, 403 without the permission, and `next()` with it.

The existing product-builder guard was updated to recognise owner-only catalog writes by `catalog.configure` instead
of `requireRole("OWNER")`. Its assertion is unchanged: only SKU generation is STAFF-writable.

### 7.3 Source mutations: **20 / 20 killed** (final code)

The mutations were:
- authentication removed;
- a deactivated admin still authenticated;
- the role trusted from the token (stale privilege);
- 403 turned into success;
- the permission check bypassed (`can()` true);
- a missing identity answered 403 instead of 401;
- the admin token type not checked (token confusion);
- an OWNER-only action granted to STAFF (order delete → `orders.manage`);
- refund authorization removed;
- user-management authorization removed (any admin changes roles);
- ops authorization removed;
- an alternate public route to the reliability report;
- the ownership check removed;
- the customer view bypassed (raw order);
- a staff-only field whitelisted (`adminNotes`);
- staff annotations kept on the customer timeline;
- cost exposed (global omit removed);
- last-owner protection removed;
- export audit removed;
- the web deciding by role string again.

The first run surfaced one survivor. Removing `requirePermission`'s missing-identity branch changed nothing because
`requireAdmin` always runs first; the guard enforces that order. It is now covered directly by a unit test of
`requirePermission` on its own, and killed.

### 7.4 Regression (2026-10-01)

| Gate | Result |
|---|---|
| Authorization suites (`src/domain/auth`) | **27 / 27**, 3× on a freshly migrated DB with Redis (final code). Before the final wait fix: 8 more green runs with Redis and 2 without, plus 1 failure on a fresh DB (see below). After it, 2 more green runs with Redis |
| Full API suite, Redis connected | 59 files, **786 / 786** passed, 0 skipped (65.0 s) |
| Full API suite, without Redis | 59 files, **786 / 786** passed, 0 skipped (66.7 s) |
| Playwright desktop + mobile | **194 passed, 2 skipped, 0 failed** (6.4 min). The API ran with `LIVE_PROVIDERS=off` and every provider credential blank; the global setup confirmed `liveProviders: false` first. The network guard blocked 8 outbound calls (all to the EPS sandbox host). No request reached a provider |
| TypeScript (api, web) | clean |
| ESLint | api clean; web 0 errors, the 2 existing `<img>` warnings (not touched) |
| API build | clean |
| Next.js build | compiled; types checked; **12 / 12** pages generated; then the known Windows standalone symlink `EPERM` (7) |
| Database (`clothing_brand_test` only; no shadow DB) | empty DB → **82** migrations (none added in Phase 10) → seed + presets → e2e staff account recreated → `migrate status` up to date → `migrate diff` "No difference detected." |

**Found and fixed during verification (test code only):**
- **Warmed caches.** The role-matrix sweep calls every cached admin endpoint, and it warmed Redis caches that a later
  analytics test expects cold: 1 of 786 failed in Redis mode (dashboard headline 0 vs 1000). The matrix now drops the
  cache families it touched.
- **Fixed sleeps.** One first run on a fresh DB failed once and didn't reproduce in 8 further runs. The two audit
  assertions waited a fixed 200 ms for fire-and-forget writes; they now poll for the row (up to 5 s).

## 8. Known limitations

- **Permissions are role-level.** There are no custom roles, per-admin grants or data scoping (e.g. STAFF limited to
  some orders); that needs a table and UI, and nothing asks for it yet.
- **Cost of the DB check:** one indexed primary-key read of `AdminUser` per admin request. There is deliberately no
  cache, so revocation stays immediate.
- **Customer revocation:** customer access tokens are not re-checked per request. A reset password revokes refresh
  tokens and the 15-min access token then lapses; unchanged from before.
- **Rate limits:** still in-memory (TARGET §15).
- **Open policy:** PD-10.1 and PD-10.2 need the owner. Until then, today's STAFF capabilities stand.
- **Next.js build:** the standalone copy step still fails with the known Windows symlink `EPERM`.

## 9. Deferred

- Custom roles, per-admin permission grants, per-staff scoping.
- Redis-backed rate limits.
- Encrypted provider credentials (ProviderConfig).
- Per-request customer token revocation.
- Constant-time compare on `/api/revalidate`.
- Installer/config packs, StoreProfile/CommerceSettings redesign, country packs, per-order currency, daily facts,
  event sourcing, Kafka, multi-region, tracing, UI redesign.
