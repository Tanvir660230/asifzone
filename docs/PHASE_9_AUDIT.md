# Phase 9 Audit: Commerce Reliability & Operational Hardening

**Status:** audit and design, 2026-09-30, branch `phase-9/reliability-hardening` (from Phase 8 `855b56c`).

**Objective:** every critical commerce operation stays correct under retries, concurrency, crashes, provider failures
and recovery, without a second source of business truth.

**Method:** traced every mutation path (orders, transitions, exchanges, inventory, ledger, courier, loyalty, outbox),
every outbound provider call (`fetch`, `https.request`, SDK clients), every inbound webhook, every idempotency
mechanism, every cache and every drift detector. Where a claim depends on earlier phases, that phase's tests are cited
rather than re-derived.

---

## A. Order / exchange concurrency

| Path | Transaction | State machine | Idempotency | Locking | Verdict |
|---|---|---|---|---|---|
| Status transitions (admin, bulk, courier, returns, gateway confirm) | yes | `getOrderTransition` under lock | same-status = no-op | `SELECT … FOR UPDATE` on the order | ✅ (Phase 1 concurrency tests). A stale admin request is refused by the matrix |
| Cancel vs payment / cancel vs ship | yes | yes | — | both lock the order row | ✅ (Phase 4: a late success on a CANCELLED order doesn't revive it) |
| Return / exchange review | yes | — | claim `updateMany … status: PENDING` | conditional update | ✅ one reviewer wins |
| **Exchange fulfilment** | yes | — | — | line release is a conditional update | ❌ **defect D-1**: `createExchangeOrder` ignores what `releaseOrderLines` released. If the original line was already restocked (a second approved exchange for the same item, or the line returned or reconciled first), the release silently does nothing, **but the replacement order is still created and shipped** and any price difference charged or refunded. The customer gets a second item without returning one |
| Return request creation | no | order must be DELIVERED | "one PENDING per order" (find-then-create, racy) | none | ⚠️ early UX guard only. D-1's fix is the real protection |
| Duplicate checkout / retry after timeout | yes | — | `Order.idempotencyKey` unique **if sent**; otherwise a Redis lock on the session plus a duplicate lookup | Redis `SET NX`, **fails open** | ❌ **defect D-2**: the storefront sends no `Idempotency-Key`. With Redis unavailable (or the lazy client's first-command drop), a double submit or timeout retry can create two orders |

## B. Inventory

InventoryService is the only stock writer:
- Sales are conditional decrements; oversell is allowed only for an already-paid gateway order, with an alert.
- Releases and returns are conditional on `quantity − restockedQuantity`. A concurrent or duplicate release matches
  zero rows.
- Every change writes a `StockMovement`.
- Phase 1 tests prove stock = Σ ledger and that no line can be restocked twice.

The defect in this area is **D-1**, a missing check of the release result by a caller, not a stock-writer defect.
Flash-sale quotas are claimed under a lock (Phase 2 D4). ✅

## C. Payments / refunds (Phase 4 ledger, unchanged)

| Operation | Guard | Verdict |
|---|---|---|
| Gateway callback / IPN / duplicate / concurrent | session claim (`updateMany` ACTIVE → …) + unique `Payment.paymentSessionId`; server-to-server verification (SSLCommerz validator, EPS verify) | ✅ (Phase 4 concurrency tests) |
| Refund record | order row lock + `refundable` cap + optional `Idempotency-Key` (unique) | ⚠️ **defect D-3**: the admin UI sends **no** key. A double click or timeout retry records **two refunds** whenever both fit under `refundable`. The lock serialises them but can't tell a retry from a second refund |
| Refund complete | conditional `REQUESTED → COMPLETED` claim | ✅ |
| Manual payment / manual order | optional key (unique) | ⚠️ same as D-3: the UI sends none |
| Overpayment / exchange downgrade | ledger positions | ✅ |

## D. Courier / shipping

`bookOrderWithSteadfast`:
1. checks `courierConsignmentId` is null;
2. calls Steadfast `create_order` (no timeout);
3. writes the consignment.

The bulk booking works the same way per order. Nothing is locked between the check and the write.

**Defect D-4:** two simultaneous bookings (double click, two admins, single and bulk at once) both pass the check and
both create consignments: two shipments, two tracking codes, two charges. The last write wins locally.

**Provider idempotency:** `invoice = orderNumber` is sent, but Steadfast's duplicate-invoice behaviour isn't verified,
and no lookup by invoice is wired. **The local boundary must prevent it.**

**Webhook and status sync are safe:** token-authenticated, re-fetched server to server by consignment id, and applied
through the locked state machine; the 15-min cron is a backstop.

## E. Outbox / worker operations (Phase 8)

- **Restarts:** after an API or worker restart, rows are in PostgreSQL, the reaper returns expired `PROCESSING` and
  stale `ENQUEUED` rows, and the dispatcher resumes. After a Redis restart, rows stay `PENDING` until an enqueue
  succeeds.
- **Retry limit:** 8 attempts, then `FAILED`, kept until an operator retries.
- **Cleanup:** deletes only `PROCESSED` rows older than 30 days, never active work.

**Defect D-5:** provider calls have **no timeout** (BulkSMSBD `fetch`, Resend SDK). A hung call that outlives the 5-min
worker lease lets the reaper redeliver while the first call is still in flight, which means a concurrent duplicate SMS.
Meta already has a timeout.

## F. Webhooks

| Webhook | Signature | Idempotency | Transaction | Duplicate-safe | Retry-safe | Failure response |
|---|---|---|---|---|---|---|
| SSLCommerz success / fail / cancel (browser redirects) | none: payload not trusted; validator API server-to-server | session claim + unique payment per session | ledger tx | ✅ | ✅ | redirect to storefront result page |
| SSLCommerz IPN | none: validator API | same | ledger tx | ✅ | ✅ (SSLCommerz retries IPN) | 200 after processing |
| EPS success / fail / cancel | none: EPS verify API | same | ledger tx | ✅ | ✅ | redirect; the reconciliation cron (5 min) is the backstop |
| Steadfast notify | shared token (constant-time compare) | status re-fetched by consignment id | locked transition | ✅ (converges on the provider's status) | ✅ | always 200 after the token check; 15-min cron backstop |

Reordered delivery converges because every handler re-reads the provider's current state instead of applying the
payload. No change needed.

## G. Idempotency inventory

| Operation | Idempotency key | Owner | Persistence | Duplicate result |
|---|---|---|---|---|
| Checkout (COD) | `Idempotency-Key` → `Order.idempotencyKey` (unique); fallback Redis session lock | order.service | DB (if sent) / Redis | existing order, **only if a key is sent (D-2)** |
| Checkout (gateway pre-order) | `Idempotency-Key` → `PaymentSession` | payment.service | DB | same attempt returned, **only if sent** |
| Quote | none (read-only, deterministic) | pricing | — | same quote |
| Gateway settlement | session claim + unique `paymentSessionId` | ledger | DB | settled once |
| Refund record | `Idempotency-Key` → `Refund.idempotencyKey` | ledger | DB | replayed refund, **only if sent (D-3)** |
| Refund complete | `REQUESTED → COMPLETED` claim | ledger | DB | 409 |
| Manual payment / manual order | `Idempotency-Key` (unique) | ledger / order.service | DB | replayed, **only if sent** |
| Exchange / return approval | request claim `PENDING → …` | return-request.service | DB | 409 |
| Exchange fulfilment | line release | InventoryService | DB | **not enforced (D-1)** |
| Courier booking | `courierConsignmentId` check | courier.service | DB | **not enforced (D-4)** |
| Status transition | same-status no-op under lock | order.service | DB | no-op |
| Loyalty award / reversal | row lock + existence / cap (Phase 8) | customer.service | DB | no-op / capped |
| Manual points adjustment | none; balance checked outside a lock | customer.service | DB | ⚠️ **D-6**: concurrent deductions can take the balance negative |
| Webhooks | provider re-verification | payments / courier | DB | converge |
| Outbox consumers | row claim + provider keys (Phase 8) | outbox | DB | skipped |

## H. Cache consistency

- **Settings:** Redis, 300 s, deleted after commit; storefront tag revalidated (Phase 7). **Products:** Redis prefix
  cleared and ISR revalidated after commit. **Metrics:** 60 s by design (Phase 5).
- **Nothing caches uncommitted data.** Every fill reads committed rows.
- **Redis unavailable:** reads fall through to the DB.
- **Residual race:** a reader filling from a pre-commit read after the post-commit delete leaves a stale entry for at
  most the TTL (300 s). It is bounded, and no business decision reads a cache. Documented, not changed.

## I. Recovery / reconciliation

| Subsystem | Detect | Report | Repair |
|---|---|---|---|
| Inventory | stock vs Σ `StockMovement` (inventory.service drift query) | admin endpoint | manual (M4 script, owner-approved counts) |
| Payments / refunds | `paymentLedgerDrift` | `/api/payments` ledger drift, script | `repairPaymentLedger` (dry-run default) |
| Read model | `readModelDrift` / `findStaleProductIds` | admin | 15-min rebuild cron, rebuild script |
| Outbox | status endpoint (Phase 8) | yes | reaper + operator retry |
| **Loyalty** | **none** | — | — | ⚠️ **D-7**: `Customer.rewardPoints` should equal Σ `RewardPointsEntry.points` (every writer writes both), but nothing checks it |
| Courier bookings | none | — | — | (see D-4) |

## J. Operator visibility

- Outbox, payment ledger, inventory and read model each have their own endpoint or script.
- **There is no single place** that answers "what is stuck, failed or inconsistent right now". Stuck campaigns
  (`SENDING` with nothing progressing) and unfinished courier bookings are not visible at all.

## K. External-provider isolation in tests (mandatory)

**Defect D-8:**
- Automated tests reach **live providers**. The vitest run loads the real `.env` credentials, and every order a test
  places fires the Steadfast `fraud_check` for real (the `HTTP 429` lines in test output are live responses).
- Phase 8's e2e run made real BulkSMSBD calls, which the provider refused (IP not whitelisted).
- SMS and email skip only when `NODE_ENV === "test"`. The API that Playwright talks to runs as development. Steadfast,
  SSLCommerz, EPS (`https.request`), Meta and Anthropic have no test switch at all.

---

# Phase 9 Boundary

### MUST FIX
1. **D-8 Provider isolation.**
   - A network guard refuses every non-local outbound request under vitest, and in the API when started with
     `LIVE_PROVIDERS=off`. It patches `fetch` plus `http(s).request`, so it covers SDKs and EPS too.
   - SMS and email adapters use dev mode whenever live providers are off. Meta CAPI is disabled.
   - `/api/health` reports whether live providers are enabled.
   - The Playwright global setup refuses to run against an API with live providers.
   - The vitest setup asserts the guard is active.
2. **D-1 Exchange fulfilment.** The replacement ships only if the original units were actually taken back. Otherwise
   the whole approval rolls back with 409. Creation also refuses an exchange for a line already restocked.
3. **D-4 Courier booking.**
   - An atomic DB claim (`Order.courierBookingStartedAt`, additive) before the provider call, for single and bulk
     booking. A concurrent booking gets 409.
   - The claim is released on a definite failure and **kept** (visible, 10-min lease) when the outcome is unknown
     (timeout/network).
   - Steadfast calls get timeouts.
4. **D-2 / D-3 Client idempotency keys.**
   - The web sends a stable `Idempotency-Key` per submit attempt: reused on retry of the same payload, new after
     success or a change.
   - Covered: checkout (COD and gateway), admin manual order, refund record, manual payment. The existing unique
     columns become the DB backstop, Redis or not.
5. **D-5 Provider timeouts below the outbox lease:** SMS and email 20 s, Steadfast 20 s.

### SHOULD FIX
6. **D-6 / D-7 Loyalty.** Manual adjustment is row-locked, so the balance can't go negative. Add a loyalty drift
   detector (report only).
7. **Operator reliability report**, `GET /api/v1/ops/reliability` (admin). One view of:
   - outbox undelivered and failed;
   - courier bookings in progress or with unknown outcome;
   - payment ledger drift, inventory drift, read-model drift and loyalty drift counts;
   - campaigns stuck `SENDING`.

   Each item names the affected aggregate and says whether it can be retried safely.

### DEFER
- Notifications, back-in-stock and price-drop via the outbox; campaign-send repair (only detected here).
- A separate worker process.
- The settings-cache race (bounded by its 300 s TTL).
- A Steadfast lookup by invoice for automatic recovery of an unknown booking outcome (needs provider verification).
- Installer, country packs, `ProviderConfig`, per-order currency, daily facts, roles/permissions (Phase 10), event
  sourcing, Kafka, multi-region, general refactoring.
