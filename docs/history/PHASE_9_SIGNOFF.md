# Phase 9 Sign-off: Commerce Reliability & Operational Hardening

**Branch:** `phase-9/reliability-hardening` (from Phase 8 `855b56c`).
**Audit and boundary:** [PHASE_9_AUDIT.md](PHASE_9_AUDIT.md).
**Status:** ready for review, awaiting approval.

**Invariant delivered (SSOT_REGISTRY I35):** a money- or shipment-creating operation happens once per intent under
retries and concurrency, and automated tests can't reach a live provider. No second source of business truth was added.
Every guard sits on the aggregate's existing owner.

## 1. Scope delivered

| Defect | Fix | Owner |
|---|---|---|
| D-8 tests reach live providers | `lib/provider-guard.ts`: `liveProvidersEnabled()` (false under vitest and with `LIVE_PROVIDERS=off`), and a network guard patching `fetch` + `http(s).request/get` that refuses non-local hosts. Installed by the vitest setup (which throws if live mode is on) and by `server.ts` when `LIVE_PROVIDERS=off`. SMS, email and Meta adapters gate on it. `/health` reports `liveProviders`. The Playwright `globalSetup` refuses to run unless the API reports `liveProviders: false` | provider adapters |
| D-1 exchange ships a free replacement | `createExchangeOrder` refuses a line already restocked (409), and after `releaseOrderLines` requires the released units to equal the line quantity, else the whole approval rolls back (409). Exchange-request creation refuses a restocked line | return-request.service |
| D-4 duplicate courier consignments | `Order.courierBookingStartedAt` (additive). An atomic conditional `updateMany` claim (no consignment, no live claim) happens before any Steadfast call, for single and bulk booking. A definite failure releases the claim. An **unknown outcome** (timeout, network error, 5xx) keeps it, flagged "Booking outcome unknown … check Steadfast for invoice X", for a 10-min lease (BUSINESS_DECISIONS P9-1) | courier.service |
| D-9 duplicate webhook timeline and notification noise (found during implementation and final verification) | Courier sync applies transitions with `quietNoop`: a same-status replay writes nothing. It notifies admins only when the locked transition reports `changed` (`changeOrderStatus`, which returns the outcome's existing flag; `updateOrderStatus` is unchanged for its callers) | order.service, courier.service |
| D-2 / D-3 no client idempotency keys | `web/lib/idempotency.ts`: one key per operation scope, reused while the payload is unchanged, replaced after success. Sent as `Idempotency-Key` by checkout (COD + gateway), manual order, refund and manual payment. The existing unique columns are the DB backstop, with or without Redis | web + existing unique columns |
| D-5 unbounded provider calls | 20 s timeouts, below the 5-min outbox lease: SMS (`AbortSignal.timeout`), Resend (`Promise.race` → retryable error), Steadfast (single `steadfastFetch`) | adapters |
| D-6 unlocked points adjustment | `adjustRewardPoints` checks and writes under `SELECT … FOR UPDATE` in one transaction | customer.service |
| D-7 no loyalty drift check | `loyaltyDrift()`: balance ≠ Σ ledger, report only | customer.service |
| §J operator visibility | `GET /api/v1/ops/reliability` (admin, read-only): outbox, courier bookings (`outcomeUnknown`, `safeToRetry`), payment-ledger, stock, read-model and loyalty drift, and campaigns stuck `SENDING` over 30 min. Each section names its repair path | ops |

**Audit correction:** return-request creation is not racy. The partial unique index
`ReturnRequest_orderId_pending_key` already allows one PENDING request per order (audit §A, corrected).

**Test tooling:** `scripts/with-test-db.ts` refuses any database but `clothing_brand_test`.

**Migration:** `20261005100000_phase9_courier_booking_claim` adds one nullable column. It is additive only.

**Earlier-phase files touched, and why:**
- `order.service.ts` gets the `quietNoop` option and `changeOrderStatus`. This is D-9, a proven duplicate-timeline and
  duplicate-notification defect; admin behaviour is unchanged.
- The Phase 7 settings test is fixed so it passes on a fresh DB.
- No Phase 1–8 architecture changed.

## 2. Reliability invariants

1. One checkout, manual order, refund or manual payment per `Idempotency-Key`. The unique column decides, not Redis.
2. At most one Steadfast `create_order` per order while a booking is in progress or its outcome is unknown.
3. An exchange replacement exists only if the original line's units were released in the same transaction.
4. A manual points deduction can't take a balance below zero.
5. Duplicate or reordered courier webhooks converge: one transition, one history entry, one COD payment, one admin
   notification.
6. No automated test, and no API started with `LIVE_PROVIDERS=off`, can open a connection to a non-local host.
7. Every provider call finishes or fails within 20 s, well inside the outbox lease.
8. Detectors report and never repair: stock, ledger, read model, loyalty, courier claims, outbox.
9. **Outbox and recovery interaction (Phase 8, unchanged):** side-effect intents commit with their business
   transaction. Provider timeouts (20 s) end every attempt inside the 5-min lease, so the reaper can't redeliver while
   a first attempt is still in flight. A blocked or failed provider call is a normal failed attempt, retried or
   `FAILED`. Cleanup deletes only `PROCESSED` rows older than 30 days, never active or failed work (tested). The ops
   report lists failed and undelivered events with the existing retry endpoint.
10. **Cache invalidation (Phase 7, re-verified):** a settings save deletes the Redis copy after commit and revalidates
    the storefront tag. Removing the delete is a killed mutation (stale settings after a save). No business decision
    reads a cache. The residual fill race is bounded by the 300 s TTL (§5).

## 3. Evidence (integration and concurrency, `domain/reliability/reliability.integration.test.ts`)

| Area | Test | Result |
|---|---|---|
| Provider isolation | guard installed, external `fetch` / `https.request` refused; SMS with a key configured stays in dev mode | ✅ |
| Exchange | second exchange of an exchanged line refused, full rollback, no second replacement | ✅ |
| Exchange × return race | 5 rounds: returned units exactly 1; a replacement exists only if the exchange won | ✅ |
| Exchange, deterministic interleaving | the test holds the replacement variant's row lock and waits (via `pg_stat_activity`) until the approval blocks past its pre-check, then returns the line and commits: approval → 409, no replacement, request still PENDING, replacement stock unchanged, returned units exactly 1 | ✅ |
| Courier concurrency | 5 rounds × (4 single + 1 bulk) → exactly **1** Steadfast call per order, claim cleared | ✅ |
| Courier unknown outcome | claim kept; retry → 409; ops report `safeToRetry: false`; booking succeeds after the lease | ✅ |
| Courier definite rejection | claim released, immediate retry allowed | ✅ |
| Webhook duplicates | 3 concurrent notifications + 1 replay → 1 DELIVERED history entry, 1 COD payment, 1 admin notification (was 3 before the fix) | ✅ |
| Checkout idempotency | 5 rounds of concurrent checkouts with one key → 1 order | ✅ |
| Refund idempotency | 5 rounds: one key → 1 refund; a different key → a second refund | ✅ |
| Refund over HTTP | the endpoint honours the `Idempotency-Key` header | ✅ |
| Loyalty | 5 rounds of 5 concurrent deductions → never below 0; drift detected and reported, not repaired | ✅ |
| Recovery | outbox cleanup never deletes active or failed rows; ops report admin-only with every section | ✅ |

## 4. Verification (2026-10-01)

| Gate | Result |
|---|---|
| Phase 9 integration (`domain/reliability/reliability.integration.test.ts`) | **16 passed** (provider isolation ×2, exchange ×3, courier ×4, idempotency ×3, loyalty ×2, recovery ×2). Repeated 3× without Redis, and 3× with Redis on the earlier revision, all green. Re-run on a freshly migrated and seeded DB together with the settings/cache and outbox suites: 6 files, **64 / 64** |
| Guards (`domain/reliability/reliability.guard.test.ts`) | **6 passed** |
| Source mutations (scripted edit → suite → restore) | **18 / 18 killed** on the final code. See the list below this table |
| Full API suite, Redis connected | 57 files, **759 / 759** passed, 0 failed, 0 skipped (59.6 s) |
| Full API suite, without Redis | 57 files, **759 / 759** passed, 0 failed, 0 skipped (63.5 s) |
| Playwright desktop + mobile | **194 passed, 2 skipped, 0 failed** (196 = 98 × desktop + mobile, 6.4 min, run twice with the same result; the numbers here are from the final run), against an API started with `LIVE_PROVIDERS=off` and blank provider credentials. The global setup confirmed `liveProviders: false` first. During the run the API's network guard blocked 4 outbound calls, all to the EPS sandbox host `sandboxpgapi.eps.com.bd`, and SMS stayed in dev mode. No request reached a provider |
| TypeScript (api, web) | clean |
| ESLint | api clean; web 0 errors, 2 existing `<img>` warnings (`low-stock-table.tsx`, `top-products-chart.tsx`, not touched in Phase 9) |
| API build (`tsc -p tsconfig.json`) | clean |
| Next.js build | compiled; types checked; **12 / 12** pages generated. Then the standalone copy step fails with the known Windows symlink `EPERM` (7 symlinks, 14 `EPERM` lines). This is the existing environment limitation, not a new failure |
| Database (`clothing_brand_test` only; no shadow DB) | empty DB → full chain of **82** migrations applied → seed + presets → e2e staff account recreated → `migrate status` "Database schema is up to date!" → `migrate diff --exit-code` "No difference detected." The Phase 9 migration is additive (one nullable column). The API starts on the fresh DB |

**Test-database guard:** `scripts/with-test-db.ts`, which runs `migrate reset` and the seeds, now refuses any
`DATABASE_URL` whose database isn't `clothing_brand_test`. It was verified with a copy pointed at `clothing_brand`:
refused, exit 1.

**Defect found during final verification (fixed):**
- **D-9, second half:** concurrent duplicate courier webhooks still sent one admin notification each (3 for one
  delivery). The guard `updated.status !== mapped` could never fire. This was reproduced with a new assertion (expected
  1, got 3). It is fixed with `changeOrderStatus` / `changed`, and covered by a new mutant.

**Test gap found during final verification (fixed):**
- **The exchange release check** was killed only by the probabilistic exchange-vs-return race. It survived one mutation
  run, because the second-exchange test is stopped earlier by the pre-check. A deterministic interleaving test now
  kills it every time: 3 of 3 targeted runs, and in the full 18/18 run.

**Fixes to test code during verification:**
- **Loyalty tests:** 1 of 758 failed on one Redis run with "Customer only has -150 points". The lock-bypass and
  removed-transaction mutants deliberately drive the test customer's balance negative, and that customer persists
  across runs. At first it was the fixture customer shared by every test file. The next honest run then failed its own
  seed step. The loyalty tests now use dedicated customers, and each round starts from a zero balance.
- **Settings suite on a fresh database:** the Phase 7 settings suite read the `StoreSetting` singleton directly. The
  seed doesn't create it (`getSettings` does, on first use), so on a fresh database the file failed whenever it ran
  first. This was reproduced on a reset DB with `NotFoundError: No StoreSetting found`. The suite now calls
  `getSettings()` first.

The guards (`reliability.guard.test.ts`, 6) check that:
- adapters gate on `liveProvidersEnabled()`, never on `NODE_ENV` alone;
- the test setup, server and Playwright use the guard;
- SMS, Resend, Meta and Steadfast have timeouts, and Steadfast has exactly one raw `fetch`;
- both booking paths claim before calling Steadfast;
- the exchange release check exists;
- every web money call passes a key.

The 18 source mutations were:
- **lock bypass:** the courier claim always granted; bulk booking skips the claim; the points deduction runs without
  `FOR UPDATE`;
- **removed transaction:** the points check and write run outside a transaction;
- **duplicate operation:** an exchange ships without the original units coming back;
- **removed idempotency:** the refund key isn't stored; the checkout key isn't stored;
- **retry bypass:** an unknown courier outcome releases the claim; a Steadfast timeout is classified as a definite
  failure;
- **webhook duplicate:** a same-status courier sync writes another timeline entry; every duplicate courier webhook
  notifies admins again;
- **recovery failure:** loyalty drift is never detected; the ops report calls an unknown-outcome booking safe to retry;
- **provider isolation:** SMS is gated on the key only; the network guard isn't installed for tests; live mode ignores
  `NODE_ENV=test`;
- **timeout:** the SMS call loses its timeout (killed by the static guard);
- **stale cache:** the settings cache isn't invalidated on save (run with Redis; 3 of the settings suite's tests
  fail).

## 4a. E2E provider safety

E2E can't use live provider credentials. Three layers protect it:
1. **Active refusal in the API.** The API under test is started with `LIVE_PROVIDERS=off`. `server.ts` then installs
   the network guard: every `fetch` / `http(s).request` to a non-local host throws `LiveProviderBlockedError`. The SMS,
   email and Meta adapters also switch to dev mode. `/health` reports `{"status":"ok","liveProviders":false}`, and the
   startup log says "live providers OFF — outbound requests to non-local hosts are blocked".
2. **Blank credentials.** The e2e API was also started with every provider credential blank: `BULKSMSBD_API_KEY`,
   `RESEND_API_KEY`, `META_ACCESS_TOKEN`, `META_PIXEL_ID`, `ANTHROPIC_API_KEY`, `STEADFAST_API_KEY` /
   `STEADFAST_SECRET_KEY`, `SSLCOMMERZ_STORE_ID` / `SSLCOMMERZ_STORE_PASSWORD`, the `EPS_*` credentials and the
   `WEB_PUSH_*` keys.
3. **Playwright refuses to start** unless the API reports `liveProviders: false` (`e2e/global-setup.ts`). Checked
   against a stub `/health`: `liveProviders: true` was refused, a missing mode was refused, and `false` was allowed.

Under vitest, `test-setup.ts` throws if live mode is on and installs the same network guard, so a configured key in
`.env` can't reach a provider either. The mutation runs prove this.

## 5. Known limitations

- **Unknown courier outcome needs a person.** After a timeout or 5xx the order is blocked for 10 min and flagged. The
  operator checks the Steadfast portal for the invoice (= order number). There is no automatic lookup by invoice,
  because the provider's behaviour isn't verified.
- **Client keys live in memory.** A full page reload before the retry generates a new key. Checkout still has the
  session-based duplicate lookup; admin refunds and payments don't.
- **Settings-cache race.** A read that fills the cache from a pre-commit value after the post-commit delete stays stale
  for at most 300 s. No business decision reads the cache.
- **SMS stays at-least-once** (Phase 8). The timeout narrows, but doesn't remove, the lease-overlap window.
- **The shared fixture customer.** API test files share one checkout customer. Any test asserting on that customer's
  mutable state must use its own, as the loyalty tests now do.
- **Next.js standalone copy step:** the known Windows symlink `EPERM`.

## 6. Deferred

- Steadfast lookup by invoice for automatic unknown-outcome recovery.
- Notifications, back-in-stock and price-drop emails, and campaign sends via the outbox. Stuck campaigns are only
  detected.
- A separate worker process; fixing the settings-cache race.
- Roles/permissions (Phase 10), installer/config packs, `ProviderConfig`, per-order currency, daily facts (the audit
  found no reliability need), event sourcing, Kafka, multi-region.
