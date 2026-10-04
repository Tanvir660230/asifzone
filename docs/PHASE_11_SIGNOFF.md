# Phase 11 Sign-off: Production Readiness — Identity Integrity, Sessions, Observability & Safe Operations

**Branch:** `phase-11/production-readiness`, from the contract `0d01810` on `phase-11/contract`, itself from Phase 10 `0ac16a9`.
**Contract:** [PHASE_11_IMPLEMENTATION_CONTRACT.md](PHASE_11_IMPLEMENTATION_CONTRACT.md).
**Decisions:** [BUSINESS_DECISIONS.md](BUSINESS_DECISIONS.md), Phase 11 section (BD-11.1 to 11.7, F-26, F-27, R-1, readings P11-1 to P11-5).
**Status:** ready for review, awaiting approval. Phase 11 is **not** declared approved here.

**Invariant delivered (SSOT_REGISTRY I37):**
- unverified contact data never grants access;
- customer sessions are revocable server-side;
- failures are traceable;
- deploys never serve new code on an unmigrated schema.

## 1. Data model (migration `20261006100000_phase11_customer_identity`, additive)

| Change | Purpose |
|---|---|
| `Customer.phoneVerifiedAt` (nullable) | the phone was proven by OTP; NULL for every existing row (no backfill) |
| `Customer_phone_verified_key`: partial unique index on `phone` `WHERE "phoneVerifiedAt" IS NOT NULL` (raw SQL) | at most one verified owner per phone; unverified duplicates allowed |
| `CustomerRefreshToken` | DB-tracked session families: `familyId`, hashed token, `tokenVersion` snapshot, `persistent`, fixed `expiresAt`, rotation and revocation markers |
| `CustomerClaim` | a pending proof-before-claim: hashed token, pending password hash, name, phone, expiry |
| `OutboxEvent.correlationId` (nullable) | observability only |

- **Pre-migration data:** inspected on `clothing_brand_test`: 0 duplicate phone values, 17 credential-less customers.
- **Production check:** the owner should run the two queries in the contract §10. They can't block the migration,
  because nothing is verified at creation.

## 2. Identity (BD-11.1, 11.2, 11.6 a, 11.7 a, F-24 to F-27)

**Phone lifecycle:** unverified → OTP challenge → verified. Changing a verified phone requires an OTP to the new number;
the old one stays the login until then.

- **OTP sign-in:** resolves only `phone = P AND phoneVerifiedAt IS NOT NULL`. Otherwise no unverified profile is signed
  in. With a name and email, the proof of P either claims the unclaimed guest record holding P plus that email (else P
  with no email), or creates an account. The phone becomes verified; the email stays unverified (F-26), and its own
  link is sent.
- **Registration:** a new email creates a new account (any phone given is unverified contact data). An email held by
  an unclaimed placeholder answers **202** "check your email": `CustomerClaim` sends a link, and only following it
  attaches the password, atomically and audited. Anything else → 409.
- **Guest checkout:** attaches to the verified owner of the phone, else the owner of a **verified** email. Otherwise it
  uses a guest placeholder keyed by the exact (phone, email) pair (P11-1); a placeholder never has a login.
- **Password reset:** is a claim by email proof on a placeholder (audited). It is refused for a phone-proven account
  whose email is unproven (P11-3).
- **Google, customer and admin:** require `email_verified === true`. A customer Google identity links only to a
  placeholder (a claim, audited) or to an account whose email is verified (P11-4).
- **Every claim is audited** as `customers.claim` with method `email_link`, `phone_otp`, `google` or `password_reset`.
- **Nothing moves:** no order, address, point, payment or refund changes owner.
- **Unchanged:** `isBlocked` keeps its meaning.

## 3. Sessions (BD-11.3)

```text
issued (login: new family, expiresAt = login + 7 d) → active → rotated (new token, same family, same expiresAt)
   → revoked (logout = this family · logout-all / password change / password reset = every family + tokenVersion++ ·
              reuse outside 10 s = this family)            → expired (refused; cleaned up daily after 1 day)
```

- **Reuse:**
  - A rotated token presented again **within 10 s** (tabs refreshing together) gets a new access token but no new
    refresh token. The family neither forks nor is revoked (P11-5).
  - **After 10 s** the whole family is revoked.
- **Legacy tokens:** stateless refresh JWTs issued before the deploy are accepted once, converted into a family that
  never outlives the JWT, and recorded as rotated, so a second use is reuse. Logout-everywhere also kills unconverted
  ones (via `tokenVersion`).
- **Cookies:** "remember me" off stays a browser-session cookie across rotations.
- **New endpoints:** `POST /api/customers/logout-all`, `POST /api/customers/me/password`, `POST /api/customers/me/phone/otp`,
  `POST /api/customers/me/phone/verify`, `POST /api/customers/claim/confirm`.
- **Logout:** `POST /api/customers/logout` now revokes server-side.

## 4. Observability (BD-11.4)

- **Correlation ID:** a client `X-Correlation-Id` is kept only if it matches `^[A-Za-z0-9._-]{8,64}$`, otherwise a
  UUID is generated. It is echoed on the response and carried by AsyncLocalStorage through the request, onto
  `OutboxEvent.correlationId`, into the consumer run (and its provider calls), and into BullMQ jobs: campaign sends
  carry it; scheduled ticks get their own.
- **Logger:** one JSON line per event (`ts, level, msg, correlationId, operation, …`) with redaction:
  - credential keys become `[redacted]`;
  - phones and emails are masked;
  - JWTs and long hex tokens are removed.

  It replaced `morgan` and all **76** `console.*` calls. The SMS dev log no longer prints the body, which was an OTP
  leak.
- **Error capture:** `captureError` captures HTTP 5xx, worker failures, outbox consumer failures, scheduled jobs and
  fire-and-forget paths. It has a pluggable reporter, no vendor and no DB writes, and never throws.
- **Health:** `/health` is liveness (unchanged). `/health/ready` checks PostgreSQL, Redis (queue connection) and the
  dispatcher heartbeat, each with a 2 s timeout; it answers 200 or 503 with booleans only.
- **Attention:** `/api/v1/ops/attention` returns the Phase 9 reliability report reduced to counts: outbox failed and
  old-undelivered, dispatcher, stuck campaigns, unknown courier outcomes, ledger drift and violations, stock, loyalty
  and read-model drift. It needs an `ops.read` session or `Authorization: Bearer $OPS_MONITOR_TOKEN` (disabled when
  unset).

## 5. Deployment (BD-11.5)

- **Script:** `docker/deploy.sh` runs backup → verify (size, `gzip -t`) → build → **migrate before switching** → switch
  → readiness gate (≤ 120 s) → nginx.
- **Failure handling:** any failure stops with rollback instructions. The CI deploy job runs it.
- **Runbook:** [DEPLOYMENT.md](DEPLOYMENT.md).

## 6. Rate limits (in-memory store kept)

| Route | Limiter |
|---|---|
| `POST /api/coupons/best` | `couponValidateRateLimit` (existing, 20 / 10 min) |
| `POST /api/auth/refresh`, `POST /api/customers/refresh` | `refreshRateLimit` (new, 60 / 10 min) |
| `POST /api/customers/resend-verification` | `emailSendRateLimit` (new, 5 / 15 min) |
| new customer routes | existing `loginRateLimit` / `otpRequestRateLimit` |

**OTP attempts:** a wrong guess consumes an attempt with one conditional `UPDATE … WHERE attempts < 5 RETURNING`, so
the per-code cap can't be exceeded through a race. Existing limits are unchanged.

## 7. Small hardening

- **F-14:** `resolveSeedAdminCredentials` allows the public defaults only for `NODE_ENV` development or test, and
  refuses them, or missing values, anywhere else. The seed never prints a real password.
- **F-20:** the legacy coupon split is `clampNonNegative(subtract(m(discount), bundle))` in minor units.

## 8. Deviations from the contract (deliberate, recorded)

| Contract | Implemented | Why |
|---|---|---|
| §5.2: inside the grace window "answer 401 without revoking" | access token issued, **no** refresh token, no revocation (P11-5) | A 401 would sign the second tab out; this keeps it working with no fork and no unlimited window |
| §5.1: verifying an existing account's phone | additionally, an OTP sign-in by the owner of an unclaimed record (R-1) claims it, after asking for name and email | This is how existing OTP-only customers regain OTP login (R-1) without auto-verification |
| — | guest placeholders keyed by the exact (phone, email) pair (P11-1) | Needed so a later claim can't expose another guest's orders (found while implementing BD-11.7) |

## 9. Evidence

### 9.1 Tests added (60 in the Phase 11 suites, plus updated Phase 10 guards)

| Suite | Tests | Covers |
|---|---|---|
| `domain/identity/customer-identity.integration.test.ts` | 16 | Phone identity: attacker sets the victim's phone (victim's OTP and later guest order never reach the attacker); unverified can't sign in, verified can; unverified duplicates allowed, a second verified owner refused (service 409 and DB P2002); phone change only by OTP with the old phone kept until then; OTP sign-up doesn't verify the email; concurrent wrong guesses capped; a deterministic stale-pre-check race can't push a code past its cap. Claims: email-matched → link only (202, nothing attached), history kept, audited, single-use; phone-matched → only OTP (registration makes a separate account); a different phone's OTP can't claim an email match; concurrent claims → exactly one wins; an OTP account can't be taken by registering or resetting through its unproven email. Guest attachment: verified phone/email attach; unverified don't (separate placeholder, foreign email not used as key, repeat guest reuses). Google: customer verified creates/claims/links; unverified refused; no link to an account with an unproven email; admin verified signs in, unverified refused with no link. `isBlocked` doesn't gate sign-in |
| `domain/identity/customer-sessions.integration.test.ts` | 14 | issue (7-day family); rotate (same family, expiry never extended); expired refused; concurrent refresh (one rotates, one gets an access token only, family alive); grace replay vs replay after 11 s (whole family revoked, the legitimate holder too); the grace constant is exactly 10 s; revoked token can't replay; logout (only this session); logout-all; password change (all revoked, new session works, wrong current password refused); password reset (all revoked, `tokenVersion` +1); `isBlocked` irrelevant; legacy JWT accepted once then reuse; logout-all kills unconverted legacy tokens; over HTTP the cookie rotates, remember-me-off stays a session cookie, and logout revokes server-side; logout-all needs a session |
| `domain/observability/observability.integration.test.ts` | 11 | correlation generated / preserved / unsafe replaced; request → outbox rows → consumer context; job context inherited or new; redaction of keys, phones, emails, JWTs and long tokens; login and OTP requests leave no password, code or phone in the logs; 5xx captured and 4xx not; worker and outbox-consumer failures captured (and re-thrown); readiness per dependency, hung probe times out, real endpoint matches actual Redis state, `/health` stays liveness; attention 401 (anonymous, customer), 200 (`ops.read`, monitor token), monitor path disabled when unset, wrong token refused, counts only |
| `domain/identity/hardening.integration.test.ts` | 5 | each new limiter blocks past its limit with earlier calls allowed (coupons/best, both refresh routes, resend-verification); seed credential rules; legacy price adjustment exact |
| `domain/identity/deploy-script.test.ts` | 4 | `docker/deploy.sh` with stubbed steps: success order; failed or empty backup stops before anything; failed migration stops before switch; readiness timeout fails with rollback text and no proxy restart |
| `domain/identity/phase11.guard.test.ts` | 10 | phone lookups state verification; only identity code verifies phones; registration never writes an existing record; Google checks `email_verified` before linking; no `console.*` and no SMS body in logs; observability writes nothing; correlation wiring; attention uses `ops.read` or the token; no destructive migrations and the partial index present with no backfill; no float money in the legacy path |
| Phase 10 `authorization.guard.test.ts` (updated) | - | pinned public surface + `/api/customers/claim/confirm`, `/health/ready`, `/api/v1/ops/attention` (the last asserted to carry `requireOpsReadOrMonitorToken`) |

### 9.2 Mutation testing: **34 / 34 source mutants killed, plus the database-level mutant (35 / 35)**

The source mutants:
- OTP lookup without `phoneVerifiedAt`;
- the uniqueness index made non-unique in the migration;
- silent registration takeover restored;
- OTP claiming an email-matched record without phone proof;
- the claim link ignoring a record that gained a verified phone;
- guest attachment through an unverified email;
- guest attachment through an unverified phone;
- OTP sign-up marking the email verified;
- customer Google skipping `email_verified`;
- admin Google skipping `email_verified`;
- verified phone changed without OTP;
- logout not revoking;
- logout-all not revoking;
- rotation disabled;
- reuse detection disabled;
- grace window unbounded;
- rotation extending the family;
- password change not revoking;
- password reset not revoking;
- non-atomic OTP attempts;
- four limiters removed (coupons/best, customer refresh, admin refresh, resend verification);
- correlation not stamped on outbox rows;
- consumer running outside the event's correlation context;
- readiness ignoring Redis;
- readiness treating a failing probe as healthy;
- log redaction removed;
- the SMS dev log printing the body;
- error capture missing 5xx;
- the attention endpoint without authorization;
- seed defaults allowed in production;
- float money restored.

**Database-level mutant:** the partial unique index was dropped on `clothing_brand_test`, the identity suite failed,
and the index was recreated.

**First run:** 31/34. Three survivors exposed test gaps, all closed:
- OTP claim by email only;
- an unbounded grace window, because the test used the imported constant;
- non-atomic attempts, because the concurrent test's pre-checks serialised and the race was never opened. A
  deterministic stale-pre-check test was added.

**Final run:** it was interrupted by a tool time limit after 27 mutants, all killed. Interrupting it left one mutant
in place: the stray script had kept running and applied the redaction mutant. That file was restored from git, and
the remaining 7 were re-run cleanly: 7/7 killed.

### 9.3 Regression (2026-10-01)

| Gate | Result |
|---|---|
| Phase 11 suites (`src/domain/identity`, `src/domain/observability`) | **60 / 60**, 3x with Redis and 3x without, on a freshly migrated DB |
| Full API suite, Redis connected | 65 files, **848 / 848**, 0 skipped (75.9 s) |
| Full API suite, without Redis | 65 files, **848 / 848**, 0 skipped (83.4 s) |
| Authorization guards (Phase 10) | green, inside the full suite |
| Playwright desktop + mobile | **194 passed, 2 skipped (viewport-scoped, pre-existing), 0 failed** (6.5 min) |
| TypeScript (api, web) / ESLint / API build | clean / api clean, web 0 errors and 2 existing `<img>` warnings / clean |
| Next.js build | compiled; types checked; 12 / 12 pages; then the known Windows standalone symlink `EPERM` (7) |
| Database (`clothing_brand_test` only; no shadow DB) | empty DB -> **83** migrations -> seed (credential rules active) + presets -> e2e staff -> `migrate status` up to date -> `migrate diff` "No difference detected." (the partial index coexists with the drift check) |

**Live check of the e2e API:**
- `/health` -> `liveProviders: false`;
- `/health/ready` -> `{"ready":true,"checks":{"postgres":true,"redis":true,"outboxDispatcher":true}}`;
- `X-Correlation-Id` on every response.

**The e2e API log (13,948 lines):**
- every line is JSON;
- 13,927 request lines carry a correlation ID;
- 0 OTP or SMS-body lines and 0 unmasked phone numbers;
- 0 outbound provider attempts. Provider credentials were blank, the guard was installed, and courier errors were
  "not configured" `AppError`s.

## 10. Known limitations

- **Historical `emailVerifiedAt`:** OTP sign-ups before Phase 11 had their email marked verified without proof
  (F-26). That historical data isn't changed, so such records can still be linked by a verified Google email
  (P11-4).
- **Access tokens:** a revoked session's access token stays valid for up to 15 minutes (stateless; per-request
  revocation is deferred).
- **Rate limits:** in-memory and per process, unchanged until the worker/scaling phase.
- **R-1 UX:** an existing OTP-only customer is asked for their name and email once on their first OTP sign-in after
  the deploy.
- **Monitor token:** `OPS_MONITOR_TOKEN` must be added to the deploy secrets to enable the external monitor path.
  It is not set automatically.
- **Next.js build:** the standalone copy step still fails with the known Windows symlink `EPERM`.
