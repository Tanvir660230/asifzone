# Phase 11 Implementation Contract

**Phase 11: Production Readiness: Customer Identity Integrity, Sessions, Observability & Safe Operations**

**Status:** contract for review. **Nothing is implemented.** No schema change, no migration, no production code.

**Base:** Phase 10 final, `0ac16a9` (`phase-10/authorization-hardening`). This document lives on `phase-11/contract`.

**Inputs:**
- the Phase 11 audit (findings F-01 to F-23);
- the owner's decisions BD-11.1 to BD-11.5 and the rate-limit and small-item instructions;
- **four new findings made while preparing this contract** (§0). Two of them need owner decisions before
  implementation can start.

---

## 0. New findings made while preparing this contract (read first)

Tracing every code path that writes or matches a customer phone or email surfaced defects the audit missed.
**The audit statement "guest checkout does not link orders by phone" was wrong.** It is corrected here.

| ID | Severity | Defect | Evidence |
|---|---|---|---|
| **F-24** | **Critical** | **Registration silently claims an existing credential-less customer by email or by phone, with no proof of ownership, and logs the registrant straight in.** Every guest checkout creates or links such a row (§F-25), and phone-OTP sign-ups also create rows without a password. Two consequences: anyone who knows a past guest's email or phone can register and read that guest's **entire order history**, with names, addresses and items, through `/api/customers/me/orders`; and an OTP-only customer's real account can be **taken over** by registering with its email | `customer.service.ts:134-136` (`isClaimable` = no password and no Google), `:138-170` (`registerCustomer`: claims `existingByEmail`, else `findFirst({ phone, passwordHash: null, googleId: null })`, then `issueCustomerTokens`) |
| **F-25** | **High** | **Guest checkout attaches each order to any existing customer whose phone *or* email matches, verified or not.** Combined with F-01 (anyone can set any phone or email on their profile), a stranger's guest order can land in an attacker's account | `order.service.ts:173-177` → `customer.service.ts:101-125` (`findOrCreateGuestCustomer`: `findFirst({ OR: [{ phone }, { email }] })`) |
| **F-26** | High | **OTP sign-up marks the supplied email as verified** (`emailVerifiedAt: new Date()`), although only the phone was proven. It also claims an existing claimable row by email, which is F-24 again | `customer.service.ts:495-510` |
| **F-27** | Medium (customer) / **High (admin)** | **Google sign-in links to an existing account by email without checking Google's `email_verified` claim**, on both the customer and the **admin** paths. An account whose Google email is unverified can be linked to another person's account | `customer.service.ts` Google login (~`:395-425`); `auth.service.ts:66-95` (admin `googleLogin`) |

All four break the principle BD-11.1 adopts, that **unverified contact data never grants access**. F-26 and F-27 are
plain defects with one correct fix, proposed in scope in §2. F-24 and F-25 change customer-visible behaviour,
namely who sees which past orders. They need the owner decisions BD-11.6 and BD-11.7 (§1.2). **Implementation
of the identity work package must not start until those two are answered.** The other work packages (W3 to W7)
don't depend on them.

---

## 1. Final business decisions

### 1.1 Adopted (owner, 2026-10-01)

| ID | Decision |
|---|---|
| **BD-11.1** | A customer phone is a **verified login identifier**. OTP login authenticates only against a phone that was successfully verified. A phone is unique among **verified** customer phones. Unverified phones may exist as contact data and may be duplicated. Changing the login phone requires verifying the new number first. OTP verification never authenticates an account just because an unverified profile contains that phone. Phone OTP login stays |
| **BD-11.2** | No automatic merges. No historical record moves between accounts. Existing duplicates stay unverified; **no existing phone is promoted to verified**. Existing customers verify by OTP before their phone becomes a login identifier. The uniqueness rule applies only to verified phones, so existing duplicates never block the migration |
| **BD-11.3** | DB-tracked customer refresh sessions, 7-day maximum, rotating, with reuse detection. Logout revokes the current session server-side. Add log-out-everywhere. Password change and password reset revoke all sessions; `tokenVersion` stays compatible. `isBlocked` keeps its meaning (a CRM field; doesn't block login or checkout). No self-service account deletion. Historical commerce data is never deleted |
| **BD-11.4** | Provider-neutral observability: correlation IDs, structured logs, an error-capture abstraction, a readiness endpoint and reliability attention signals. No vendor in the business or domain layer |
| **BD-11.5** | Brief downtime is acceptable; no blue/green. Deploy runs backup, verify backup, migrate, start, wait for readiness, and fails if not ready. Rollback is explicit. Expand/contract compatibility |
| Rate limits | Keep the in-memory store. Close the gaps on `/api/coupons/best`, `/api/auth/refresh`, `/api/customers/refresh` and `/api/customers/resend-verification`. Make OTP attempt counting atomic |
| Small items | F-14: the seed refuses the default OWNER credentials outside local/test. F-20: no float money in the legacy price-adjustment path |

### 1.2 Required before the identity work package (W1) starts: new, not yet decided

Options are listed without ranking. Every option keeps historical orders on the customer row they are attached to
today (BD-11.2), and none deletes data.

**BD-11.6: When may a new credential attach to an existing credential-less customer row** (a guest placeholder or
an OTP-only account)? Today registration claims it by email or phone, with no proof (F-24).

| Option | Behaviour | Consequence |
|---|---|---|
| (a) Claim only after proving the matched identifier | A row matched by email is claimed only after the email-verification link is followed; a row matched by phone only after an OTP to that phone. Until then the new credential works on a fresh, empty session that can't read the placeholder's orders | Repeat guests still get their history, once they've proven ownership. Needs a pending-claim step, either a column or a short-lived token. More flows to test |
| (b) Never claim; registration always creates a new account | Placeholder history stays on the placeholder, visible to staff, not to the customer | Simplest and safest. Repeat guests don't see past guest orders in their account. **`Customer.email` is unique**, so registering with an email that a placeholder holds would need either the placeholder's email released (moved to a non-unique contact column; touches the schema) or registration refused with "check your email to claim". Both are visible changes |
| (c) Claim only by a **verified** email (link) and never by phone | Phone-matched placeholders are never claimed; email-matched ones only after verification | Middle ground. Phone-only guests' history is never attached to a login |

**BD-11.7: Which existing customer may a guest checkout attach its order to?** Today any phone or email match is
used, unverified (F-25).

| Option | Behaviour | Consequence |
|---|---|---|
| (a) Verified identifiers only | Attach to the customer with that **verified** phone, or that **verified** email; otherwise reuse or create a credential-less placeholder matched only among other placeholders | A guest order can't land in a stranger's account. Repeat-guest recognition in the admin CRM is kept among placeholders. Some customers may appear twice (placeholder plus account) until they claim (BD-11.6) |
| (b) Keep matching for CRM, but gate customer visibility | Orders still attach as today; `/me/orders` shows only orders whose phone or email is verified on the account | CRM grouping unchanged. Adds a visibility rule to every customer order read, and stays sensitive to matching mistakes |
| (c) Never attach guest orders to credentialed accounts | Guest orders attach only to placeholders | Logged-in checkout is the only way an order joins an account. CRM shows guest and account customers separately |

---

## 2. Exact Phase 11 scope (work packages)

| WP | Scope | Blocked by |
|---|---|---|
| **W1 Identity integrity** | Verified login phone (F-01): phone-verification state, OTP login only against verified phones, a phone-change flow. Claim rules (F-24) per BD-11.6. Guest-order attachment (F-25) per BD-11.7. Fix OTP sign-up marking the email verified (F-26). Require `email_verified` on the customer **and admin** Google paths (F-27; the admin change is a one-line identity fix that leaves the Phase 10 permission model untouched) | BD-11.6, BD-11.7 |
| **W2 Customer sessions** | DB-tracked rotating refresh sessions with family reuse detection; server-side logout; log-out-everywhere; logged-in password change; reset revokes all sessions; `tokenVersion` compatibility (F-02) | W1 identity rules (same files) |
| **W3 Observability** | Correlation IDs end to end, structured logger with redaction, error-capture interface, liveness/readiness, reliability attention signals (F-03) | — |
| **W4 Deployment** | Backup → verify → migrate → start → readiness gate → fail; explicit rollback runbook (F-04) | W3 readiness endpoint |
| **W5 Rate limits** | Limiters on the four gaps; atomic OTP attempt counting (F-05 gaps) | — |
| **W6 Seed safety** | No default OWNER credentials outside local/test (F-14) | — |
| **W7 Money** | Exact arithmetic in the legacy price-adjustment fallback (F-20) | — |

## 3. Exact non-scope

- Dedicated worker process; Redis-backed rate-limit store; object storage.
- ProviderConfig; StoreProfile redesign; installer/config packs; country packs; localization redesign.
- Per-order currency; daily fact tables.
- Courier automatic recovery.
- Moving the remaining notifications to the outbox.
- Custom roles, per-admin grants, data scoping, admin authorization redesign. F-27 changes Google identity
  verification only, never permissions.
- Pricing, payment-ledger, metrics-SSOT and outbox semantic redesign; Kafka; event sourcing; multi-region.
- `isBlocked` semantics; self-service account deletion.
- Automatic account merging, or moving any historical record.
- Customer access-token per-request revocation (§15 R-2).

## 4. Data model changes (all additive)

| Change | Purpose | Notes |
|---|---|---|
| `Customer.phoneVerifiedAt DateTime?` | the phone in `Customer.phone` has been proven by OTP **as of this timestamp** | NULL for every existing row (BD-11.2: no promotion). Cleared whenever `phone` changes to a different value |
| Partial unique index `Customer_phone_verified_key` ON `"Customer"("phone") WHERE "phoneVerifiedAt" IS NOT NULL` | at most one verified owner per phone | Raw SQL in the migration (Prisma can't express partial indexes). Same pattern as `ReturnRequest_orderId_pending_key` (migration `20260810121000`), which the drift check already accepts. Can't fail on existing data, because no row is verified when it's created |
| New `CustomerRefreshToken` table: `id`, `customerId` (FK, cascade), `familyId`, `tokenHash` (unique), `tokenVersion` (snapshot), `expiresAt`, `createdAt`, `rotatedAt?`, `replacedById?`, `revokedAt?`, `revokedReason?`, `userAgent?`; indexes `(customerId)`, `(familyId)` | DB-tracked customer refresh sessions (§5.2) | Mirrors the admin `RefreshToken`, plus `familyId` for reuse detection. `revokedReason` ∈ `logout`, `logout_all`, `password_change`, `password_reset`, `reuse_detected`, `expired_cleanup` |
| `OutboxEvent.correlationId String?` | carries the request's correlation ID to the worker (§6) | NULL for existing rows and system-generated events |
| `PhoneOtp`: no column change | — | Attempt counting becomes a conditional atomic update (§8) |
| BD-11.6 (a) only: a pending-claim marker, a column or a short-lived token row | proof-before-claim | Shape decided after BD-11.6 |

No column is dropped, renamed, narrowed or made `NOT NULL` on existing data. **Nothing is backfilled to "verified".**

## 5. API and auth changes

### 5.1 Phone verification lifecycle

```text
unverified ──(OTP challenge sent to this exact phone)──► challenge pending ──(correct code, within TTL & attempt budget)──► verified
     ▲                                                                                                                    │
     └───────────────────────────── phone changed to a different value (verified flag cleared) ◄──────────────────────────┘
```

- **Eligible for OTP login** when, and only when: `phone = P AND phoneVerifiedAt IS NOT NULL`. The partial
  unique index guarantees at most one such customer.
- **OTP login** (`POST /api/customers/otp/verify`, code correct):
  - if a customer is verified with P, log in as that customer;
  - otherwise, **never** log into an account whose profile merely lists P as an unverified phone;
  - instead, the new-account path creates a customer with `phone = P, phoneVerifiedAt = now` (subject to the
    claim rules of BD-11.6). Unverified duplicates of P may still exist; the unique rule covers verified rows
    only;
  - the supplied email is **not** marked verified (F-26). The normal email-verification link applies.
- **Verifying an existing account's phone (first time):** an authenticated customer calls `POST
  /api/customers/me/phone/otp` (sends OTP to the account's phone or a new one), then `POST
  /api/customers/me/phone/verify` (code). On success, in one transaction: `phone = P, phoneVerifiedAt = now`. If P
  is already verified by another customer, the unique index raises a conflict → **409**, with nothing changed and
  no existence detail beyond "this number is already in use".
- **Changing the login phone:**
  - `PATCH /api/customers/me` may change `phone` only while the current phone is **unverified** (contact data);
    the verified flag stays NULL.
  - If the current phone is verified, `PATCH /me` with a different phone → **409** "verify the new number". The
    change goes through the two endpoints above, and the old verified phone stays the login identifier until the
    new one is verified. Nobody is locked out mid-change.
- **Registration** (`POST /api/customers/register`) never sets `phoneVerifiedAt`; claims follow BD-11.6.
- **Admin-created customers** (`POST /api/customers/admin`) never set `phoneVerifiedAt`.
- **Guest checkout** never sets `phoneVerifiedAt`; attachment follows BD-11.7.
- **OTP request** (`POST /otp/request`): unchanged per-IP limit and per-phone DB budgets. It sends to any valid
  phone; possession is proven at verify.

### 5.2 Customer session lifecycle

```text
issued ──► active ──(refresh)──► rotated (old token: rotatedAt, replacedById; new token issued, same familyId) ──► … active
   │          │
   │          ├──(logout)──────────► revoked (reason=logout; this token's family)
   │          ├──(logout everywhere / password change / password reset)──► revoked (all families of the customer)
   │          ├──(reuse of a rotated or revoked token)──► revoked (reason=reuse_detected; whole family)
   └──────────┴──(now ≥ expiresAt)──► expired (refused; may be cleaned up later)
```

- **Issue** (login of any kind, registration, OTP, Google): a new family with
  `familyId = new id, expiresAt = issuedAt + 7 days`.
- **Fixed maximum:** the 7-day lifetime is **fixed per family**. Rotation copies the family's `expiresAt`; it
  never extends it. This preserves today's maximum.
- **Token format:** an opaque random token (as admin); only its SHA-256 hash is stored. The cookie name and the
  options of `customer_refresh_token` stay the same.
- **Refresh** (`POST /api/customers/refresh`), in one transaction:
  1. Find the token by hash.
  2. Refuse if missing, expired, or `tokenVersion ≠ customer.tokenVersion`.
  3. Claim with a conditional update `WHERE id = ? AND rotatedAt IS NULL AND revokedAt IS NULL`.
  4. Insert the successor with the same family; set the cookie; issue a new access token.
- **Reuse detection:** a presented token that already has `rotatedAt` or `revokedAt` set is a replay.
  - If it was rotated **within a 10-second grace window**, the request is treated as a concurrent refresh, such
    as two tabs. Answer 401 **without** revoking, and let the client use the cookie the winning request set.
  - Otherwise, revoke **every token in that family** (`reuse_detected`) and answer 401. The family's legitimate
    holder must log in again: an attacker and a victim can't both keep a stolen session alive.
- **Logout** (`POST /api/customers/logout`): revoke the presented token's family (`logout`), then clear cookies.
  It answers 204 even when the token is already invalid, so the endpoint doesn't reveal whether a token exists.
- **Log out everywhere** (new `POST /api/customers/logout-all`, customer-authenticated): revoke all of the
  customer's families (`logout_all`) and increment `tokenVersion`, which also kills legacy tokens (§11).
- **Password change** (new `POST /api/customers/me/password`, customer-authenticated): requires the current
  password, or allows setting a first password for an account without one. It revokes all families
  (`password_change`), increments `tokenVersion`, and issues a fresh session for the current device.
- **Password reset** (existing): keeps incrementing `tokenVersion` and additionally revokes all families
  (`password_reset`).
- **Access token:** stays a 15-minute stateless JWT with `typ: customer`, as in Phase 10. A revoked session's
  access token lapses within 15 minutes (§15 R-2).
- **`isBlocked`:** not consulted anywhere in the session flow (BD-11.3).

### 5.3 Other API changes

| Change | Detail |
|---|---|
| Google sign-in (customer and admin) | refuse to link or create unless `payload.email_verified === true` (F-27) |
| New customer routes | `POST /me/phone/otp`, `POST /me/phone/verify`, `POST /me/password`, `POST /logout-all`. All `requireCustomer`, all rate limited (§8). The customer-route surface is listed in the Phase 10 guard, so the pinned list gains them deliberately |
| `/health` | stays as **liveness**, same JSON (`status`, `liveProviders`). Playwright's global setup and the CI `wait-on` keep working |
| New `/health/ready` | readiness, public, no PII, no counts (§6.4) |
| New `GET /api/v1/ops/attention` | machine-checkable attention signals (§6.5) |
| Response shapes | `/api/customers/me` adds `phoneVerified: boolean`; no other customer response changes. Admin customer views add `phoneVerifiedAt` |

## 6. Observability architecture

All new code lives in `apps/api/src/lib/observability/`. Domain services never import a vendor.

### 6.1 Correlation ID

- **Ingress:** middleware first in the chain.
  - Accept the client's `X-Correlation-Id` only if it matches `^[A-Za-z0-9._-]{8,64}$`; otherwise generate a
    UUID v4.
  - Echo it in the response `X-Correlation-Id` header.
  - It is never derived from request data: no user id, email or phone.
- **Context:** an `AsyncLocalStorage` context holds `{ correlationId, operation }` for the request's whole async
  chain. Logger and error capture read it implicitly, so no function signature changes.
- **Outbox:** `recordOutboxEvents(tx, …)` stamps `correlationId` from the context on every row it writes. Rows
  written outside a request stay NULL.
- **BullMQ:**
  - Outbox delivery jobs carry only `eventId` today; the worker reads `correlationId` from the row, so no payload
    change is needed.
  - Other jobs (crons, campaign send) start a **new** context per tick or job, with a generated ID and
    `operation = <queue>:<job>`.
  - A job enqueued from a request (campaign send) gets the request's ID in its data (`correlationId` field).
- **Provider adapters:** they log through the logger, so the context ID appears on every provider call log line.
  The ID is **not** sent to providers.

### 6.2 Structured logger

- **Output:** a `logger` with `debug | info | warn | error`, writing one JSON object per line to stdout. Fields:
  `ts` (ISO UTC), `level`, `msg`, `correlationId`, `operation`, `route` or `job`, `durationMs` (where measured),
  `errorClass` (`AppError` status / `provider_timeout` / `provider_rejected` / `db` / `unexpected`), plus extra
  fields.
- **Redaction:** before serialising, keys matching `password|passcode|otp|code|token|secret|authorization|cookie|
  apiKey|secretKey|hashKey|accessToken|refreshToken` are replaced with `"[redacted]"`. Phone numbers and emails are
  masked: `01*******78`, `j***@d***.com`. A unit test asserts redaction.
- **Request log:** one line per request, replacing `morgan`: method, route pattern (not the raw URL with query
  values), status, `durationMs`, correlation ID. No bodies.
- **Migration from `console.*`:** the 76 `console.*` calls in API src (server and jobs 24, payments 12, lib 16, …)
  move to the logger. A guard test forbids new `console.*` in `src/` outside the logger.

### 6.3 Error capture

- **Interface:** `captureError(err, context?)` in `lib/observability/error-capture.ts`. The default reporter writes
  a structured `error` log line with `errorClass`, correlation ID and a stack (server-side only).
- **Pluggable:** `registerErrorReporter(reporter)` lets a hosted or self-hosted tracker be attached later from
  `server.ts`, behind env. No vendor SDK is added in Phase 11.
- **Call sites:**
  - the Express error handler, for 5xx and unexpected errors only (4xx `AppError`s aren't errors);
  - every BullMQ worker's `failed` event;
  - outbox consumer failures;
  - scheduled-job failures;
  - fire-and-forget paths: `notify`, `recordAudit`, best-effort emails.
- **Never business truth:** `captureError` returns `void`, never throws, and doesn't write to the database. A guard
  test checks it has no Prisma import.

### 6.4 Liveness and readiness

- **`GET /health` (liveness):** the process is up. Unchanged.
- **`GET /health/ready` (readiness):** answers 200 `{ ready: true, checks }` or 503 `{ ready: false, checks }`.
  Checks, each with a 2-second timeout:
  - `postgres`: `SELECT 1`;
  - `redis`: `PING` on the **queue** connection (the cache client drops its first command);
  - `outboxDispatcher`: `outboxStatus().dispatcher.healthy`.
- **Output:** the result is a boolean per check, with no counts, ids or PII. Readiness reads state only and never
  repairs anything.

### 6.5 Reliability attention signals

- **Endpoint:** `GET /api/v1/ops/attention` returns
  `{ generatedAt, needsAttention: <total>, signals: { outboxFailed, outboxUndeliveredOld, stuckCampaigns, courierOutcomeUnknown, paymentLedgerDrift, ledgerViolations, stockDrift, loyaltyDrift, readModelDrift, dispatcherUnhealthy } }`.
- **Contents:** **counts and booleans only**, derived from the same detectors as the Phase 9 reliability report
  (one code path, no new calculation). No ids, names or amounts.
- **Authorization: two callers, one data shape.**
  - (i) An admin session with `ops.read`, which is the existing permission, with no new role logic.
  - (ii) An external monitor presenting `Authorization: Bearer <OPS_MONITOR_TOKEN>`, compared in constant time.
  - If `OPS_MONITOR_TOKEN` is unset, path (ii) is disabled.
  - This is a narrow integration-credential boundary like the courier webhook token, **not** a second permission
    system. The guard test pins it as the one non-session ops route.
- **Not business state:** signals are computed on read. Nothing is stored.

## 7. Deployment changes (`.github/workflows/ci.yml` deploy job and `docker/` scripts)

1. **Backup:**
   - `pg_dump` of the production DB to `backups/predeploy-<sha>-<ts>.sql.gz`, reusing `docker/backup.sh`'s method
     on the running `postgres` container, before any image is rebuilt.
   - **Verify:** the exit code is 0, the file size is above a floor, and `gzip -t` passes. If not, **abort the
     deploy**; nothing has changed yet.
2. **Build** the new `api` and `web` images (`docker compose build`) while the old containers keep serving.
3. **Migrate:** `docker compose run --rm api npx prisma migrate deploy`, with the **new** image against the live DB,
   before switching. Additive migrations keep the **old** code working on the new schema (expand phase).
   - A migration failure aborts the deploy; the old containers are still running.
4. **Switch:** `docker compose up -d api web`. Brief downtime is accepted.
5. **Readiness gate:** poll `/health/ready` through the internal network for up to 120 s. If it isn't ready, fail
   the job and print the rollback instructions.
6. **Restart nginx** (as today).
7. **Rollback runbook** in `docs/DEPLOYMENT.md`:
   - Code rollback: redeploy the previous image tag. Safe without a DB change, because migrations are additive.
   - Data rollback: restore the step-1 dump. Only for a data-corrupting incident, and it loses writes made since
     the backup; stated explicitly.

No second application stack; no blue/green.

## 8. Rate-limit changes (in-memory store kept)

| Route | Limiter | Rationale |
|---|---|---|
| `POST /api/coupons/best` | existing `couponValidateRateLimit` (20 / 10 min) | same coupon-probing risk as `/validate` |
| `POST /api/auth/refresh` | new `refreshRateLimit` (60 / 10 min per IP) | token-guessing and abuse ceiling; generous for multi-tab |
| `POST /api/customers/refresh` | `refreshRateLimit` | same |
| `POST /api/customers/resend-verification` | new `emailSendRateLimit` (5 / 15 min per IP) | it sends email (cost, spam) |
| New `/me/phone/otp` | existing `otpRequestRateLimit` | it sends SMS |
| New `/me/phone/verify`, `/me/password`, `/logout-all` | existing `loginRateLimit` | credential-bearing |

Existing limits are unchanged. **Atomic OTP attempts:** each wrong code consumes one attempt with a single
conditional statement, `UPDATE "PhoneOtp" SET attempts = attempts + 1 WHERE id = $1 AND attempts < $max RETURNING
attempts`. If no row is returned, the code is exhausted and the answer is "too many attempts". The check and the
increment can't be separated, so N concurrent wrong guesses consume N attempts, and the cap holds.

## 9. Security invariants (each one gets a test)

- **S-1:** OTP login resolves only `phone = P AND phoneVerifiedAt IS NOT NULL`. A profile with P unverified is
  never authenticated by an OTP for P.
- **S-2:** At most one customer has a given verified phone. This is enforced by the partial unique index, not by
  application checks alone.
- **S-3:** No existing phone becomes verified except through a successful OTP to that phone.
- **S-4:** No historical order, payment, refund, points entry or address changes `customerId` in Phase 11. The
  claim rules (BD-11.6) attach credentials to rows; they never move rows.
- **S-5:** No unverified email or phone grants access to an existing account or its history (F-24, F-25, F-26):
  registration, OTP sign-up and Google linking claim or link only per the adopted rules.
- **S-6:** Google linking requires `email_verified` (customer and admin).
- **S-7:** A refresh token works at most once. Replay outside the grace window revokes its family. Logout,
  logout-everywhere, password change and password reset revoke server-side, and a revoked token is refused.
- **S-8:** The family lifetime never exceeds 7 days from login.
- **S-9:** `isBlocked` is not read by authentication or checkout.
- **S-10:** No log line or captured error contains a password, OTP, JWT, refresh token, provider credential or
  unmasked phone or email.
- **S-11:** Observability (logs, error capture, readiness, attention) never writes business state, and readiness
  never repairs.
- **S-12:** Redis holds no business truth. Sessions, phone verification and OTP budgets are in Postgres; rate-limit
  counters stay in memory.
- **S-13:** Exactly one permission system. The attention endpoint uses the existing `ops.read`, or the monitor
  token as an integration credential.
- **S-14:** The Phase 10 boundaries hold. Every admin route has one permission, customers reach only their own
  resources, and `toCustomerOrder` is unchanged.

## 10. Migration strategy

**One migration** (expand-only), applied by `migrate deploy`:
1. `ALTER TABLE "Customer" ADD COLUMN "phoneVerifiedAt" TIMESTAMP(3);`
2. `CREATE UNIQUE INDEX "Customer_phone_verified_key" ON "Customer"("phone") WHERE "phoneVerifiedAt" IS NOT NULL;`
3. `CREATE TABLE "CustomerRefreshToken" (…)` plus its FK and indexes.
4. `ALTER TABLE "OutboxEvent" ADD COLUMN "correlationId" TEXT;`
5. (BD-11.6 (a) only) the pending-claim structure.

**Pre-migration data inspection** (informational; it can't block, because no row is verified):
- `SELECT phone, COUNT(*) FROM "Customer" WHERE phone IS NOT NULL GROUP BY phone HAVING COUNT(*) > 1;`
- `SELECT COUNT(*) FROM "Customer" WHERE "passwordHash" IS NULL AND "googleId" IS NULL;` (claimable rows, for
  BD-11.6 and BD-11.7 sizing)

These run on `clothing_brand_test` in development. On production, the **owner** runs them (production DB reads
are blocked for automation) and the results are recorded in the sign-off.

**Verification:**
- empty-DB chain on `clothing_brand_test`, then seed, e2e staff, `migrate status`, and the drift check
  (`migrate diff --from-schema-datasource … --exit-code`);
- the partial index is declared in the migration only, as for `ReturnRequest_orderId_pending_key`;
- no shadow DB other than the test database;
- no data backfill and no destructive statement.

## 11. Backward compatibility

| Area | Strategy |
|---|---|
| Legacy stateless customer refresh tokens (issued before deploy) | **Accepted once** during transition: verify the JWT signature, expiry and `tokenVersion` as today, then convert it into a new DB family with `expiresAt` = the legacy token's own `exp` (never longer) and a rotated opaque cookie. Logout and logout-everywhere also increment `tokenVersion`, which kills unconverted legacy tokens. After 7 days no legacy token can be valid, and the legacy branch is removed in a later contract step (noted, not Phase 11) |
| Old code on the new schema (during deploy, or after a code rollback) | New column, index and table are unused by old code. Old code still writes `phone` without `phoneVerifiedAt`, which is allowed. Old code ignores `correlationId` |
| New code on rows written by old code | `phoneVerifiedAt` NULL = unverified (correct); `correlationId` NULL tolerated everywhere |
| Customer UX | Existing customers who use OTP login must verify their phone once, through an OTP to that phone, before OTP login finds their account. If the verification of an existing account and the OTP-login flow would collide, the UX copy and route are defined in W1 implementation. Email/password and Google logins are unaffected (Google needs a verified email) |
| `/health` | unchanged (liveness); readiness is a new path |
| Admin and customer API shapes | additive fields only (`phoneVerified`, `phoneVerifiedAt`) |

## 12. Test strategy

- **Identity (integration):**
  - the attacker-sets-victim-phone scenario (OTP login never lands in the attacker's account);
  - duplicate unverified phones plus one verified (login resolves the verified one only);
  - two customers verifying the same phone concurrently (exactly one succeeds, the other 409);
  - phone change keeps the old login phone until the new one is verified;
  - OTP sign-up doesn't mark the email verified;
  - the F-24 and F-25 scenarios under the chosen BD-11.6 and BD-11.7 options;
  - Google without `email_verified` is refused (customer and admin);
  - no `customerId` changes on historical rows (S-4).
- **Sessions (integration):**
  - rotation works;
  - replay after rotation revokes the family;
  - concurrent refresh within the grace window doesn't revoke;
  - logout revokes the family; logout-everywhere revokes all, plus legacy tokens;
  - password change and reset revoke all;
  - the 7-day ceiling holds across rotations;
  - a legacy token is converted once;
  - `isBlocked` is irrelevant.
- **Concurrency:** atomic OTP attempts (N parallel wrong codes consume exactly N; the cap never exceeded); the
  verified-phone race; the refresh race.
- **Observability:**
  - the correlation ID is present on the response header, log lines, outbox rows and worker logs for one request;
  - invalid client IDs are replaced;
  - the redaction unit test (tokens, OTP, passwords, phone/email masking);
  - `captureError` is called from the error handler and workers, writes no DB rows and never throws;
  - readiness returns 503 with Postgres down, Redis down, or the dispatcher unhealthy, and 200 when all are healthy;
  - attention counts equal the reliability report's;
  - the monitor token works, is refused when wrong, and is disabled when unset.
- **Rate limits:** each new limiter trips at its limit; existing limits unchanged.
- **Seed:** production `NODE_ENV` without `SEED_ADMIN_*` exits non-zero with a clear message; dev/test is
  unchanged.
- **Money:** the legacy price-adjustment fallback is exact on values that drift in floating point (e.g. 0.1 + 0.2
  patterns).
- **Guards:**
  - no `console.*` outside the logger;
  - error capture never imports Prisma;
  - OTP login only queries verified phones;
  - no direct `customer.update` setting `phoneVerifiedAt` outside the verification service;
  - the pinned public and customer route lists are updated deliberately.
- **Mutation tests**, at least one per invariant S-1 to S-12, for example:
  - OTP login on an unverified phone;
  - partial index condition removed;
  - claim without proof;
  - guest attach by an unverified match;
  - `email_verified` check removed;
  - no family revocation on reuse;
  - logout clears cookies only;
  - expiry extended on rotation;
  - redaction removed;
  - readiness ignoring Redis;
  - non-atomic OTP increment;
  - seed fallback restored.
- **Full regression:** API suite with and without Redis; Phase 1–10 guards and mutations; Playwright with
  `LIVE_PROVIDERS=off`; TypeScript; ESLint; API build; Next build (known Windows `EPERM` accepted); empty-DB
  migration chain, status and drift.

## 13. Rollback strategy

- **Code:** redeploy the previous image. The schema stays expanded and old code ignores the additions.
  Consequences:
  - customers holding new opaque refresh tokens must log in again, because old code can't read them;
  - verified-phone protection is lost until re-deploy, since old code still has F-01, F-24 and F-25. This is
    stated in the runbook.
- **Migration:** if the migration itself fails, the deploy aborts before switching; old code keeps running.
- **Schema (contract):** never in Phase 11. Dropping the new structures would be a separate, explicitly approved
  step.
- **Data:** restore from the pre-deploy backup only for corruption, accepting loss of later writes.

## 14. Acceptance criteria

1. S-1 to S-14 hold and each has a passing test plus a killed mutant.
2. W1 implements the owner's BD-11.6 and BD-11.7 choices exactly.
3. No historical commerce row changes owner; no data deleted; no existing phone auto-verified.
4. Customer refresh sessions rotate, detect reuse, and are revoked by logout, logout-everywhere, password change and
   password reset; the maximum stays 7 days.
5. Every request has a correlation ID visible end to end, including outbox and worker.
6. No `console.*` remains in API src outside the logger, and logs are JSON with redaction.
7. `/health/ready` reflects Postgres, Redis and dispatcher; `/api/v1/ops/attention` exposes the signals.
8. The deploy job backs up and verifies, migrates before switching, gates on readiness, and documents rollback.
9. The four rate-limit gaps are closed, and OTP attempts are atomic.
10. The seed refuses default credentials outside dev/test, and the legacy price-adjustment path is exact.
11. The full regression is green in both Redis modes; Playwright is green with live providers off; the
    migration chain, status and drift are clean.

## 15. Known risks

| ID | Risk | Mitigation |
|---|---|---|
| R-1 | Existing OTP-only customers must verify once before OTP login finds their account. The owner must confirm this is acceptable, since BD-11.2 forbids auto-promotion | clear UX; email/Google logins unaffected; verification is one OTP |
| R-2 | Revoked sessions keep a valid **access** token for up to 15 minutes (stateless JWT) | accepted in BD-11.3 scope; a per-request check is deferred |
| R-3 | BD-11.6 and BD-11.7 change which past orders a customer sees in their account | owner decides; staff still see everything; nothing moves |
| R-4 | The legacy refresh-token transition branch must be removed later | tracked as a follow-up after 7 days |
| R-5 | A readiness gate tied to Redis fails the deploy during a Redis outage | intended (fail closed); the runbook covers it |
| R-6 | The monitor token is a new secret | env-only, constant-time compare, disabled when unset, counts-only response |
| R-7 | Partial indexes are invisible to the Prisma schema | the existing precedent and drift check are proven; a guard test asserts the index exists |
| R-8 | In-memory rate limits remain per process | accepted until the worker split or multi-instance work (Phase 12) |

## 16. Explicitly deferred

Dedicated worker; Redis rate-limit store; object storage; ProviderConfig; StoreProfile; installer/config packs;
country packs; localization; per-order currency; daily facts; courier auto-recovery; remaining notifications to
the outbox; custom roles, grants, scoping; per-request customer access-token revocation; removing the legacy
refresh branch (after 7 days); dropping any column or table; Kafka, event sourcing, multi-region.

---

## Design check (performed for this contract)

| Must not | Design status |
|---|---|
| expose customer PII | **Closes** three existing leaks (F-24, F-25, F-01). Readiness and attention return booleans and counts only. Logs mask phone and email |
| allow OTP login through an unverified phone | S-1; login queries `phoneVerifiedAt IS NOT NULL` only |
| allow duplicate verified phones | S-2; partial unique index plus a concurrent test |
| invalidate historical order ownership | S-4; no `customerId` rewrite anywhere |
| delete historical commerce records | no delete paths; no account deletion |
| make `isBlocked` change meaning | S-9; not read by auth or checkout |
| leak tokens into logs | S-10; redaction and test; opaque refresh tokens stored hashed |
| make observability authoritative | S-11; computed on read, no DB writes |
| make Redis authoritative | S-12; sessions, verification and OTP budgets in Postgres |
| introduce a second permission system | S-13; the existing `ops.read`; the monitor token is an integration credential |
| require blue/green | §7 runs on one stack with brief downtime |
| break old code during the additive migration | §11; nullable column, unused table and index; old writes stay valid |

**Open before W1:** BD-11.6 and BD-11.7. **Confirmation requested:** the in-scope fixes F-26 and F-27, especially
the admin Google `email_verified` check, and risk R-1.
