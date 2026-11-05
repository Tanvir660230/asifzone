# Phase 8 Sign-off: Outbox & Reliable Side Effects

**Branch:** `phase-8/outbox-reliable-side-effects` (from Phase 7 `cb8d137`).
**Audit and boundary:** [PHASE_8_AUDIT.md](PHASE_8_AUDIT.md).
**Status:** ready for review, awaiting approval.

**Invariant delivered:** if business truth commits, the side-effect intent is durable. Delivery is at least once to
idempotent consumers. No consumer writes business truth.

## 1. Event inventory (implemented)

| Event (versioned) | Producer (inside its transaction) | Consumer | Idempotency key | Payload |
|---|---|---|---|---|
| `order.placed.v1` | `insertOrderRecord` | `customer-order-sms` | `order:<id>:placed` | `{ orderId, touchpoint: PLACED \| CONFIRMED }` |
| `order.placed.v1` | `insertOrderRecord` | `admin-order-alert-sms` | `order:<id>:placed` | `{ orderId }` |
| `order.placed.v1` | `insertOrderRecord` (storefront, CAPI enabled) | `meta-capi-purchase` | `order:<id>` | `{ orderId, context }` (context scrubbed after send) |
| `order.status_changed.v1` | `applyOrderTransition` (admin, bulk, courier sync, returns, gateway confirm) | `customer-order-sms` | `status:<statusHistoryId>` | `{ orderId, touchpoint }` |
| `payment.settled.v1` | `insertOrderRecord` (gateway-created order) / `settleExistingOrder` | `payment-receipt-email` | `order:<id>:paid` | `{ orderId }` |

- **Payload rules:** payloads carry ids plus only what the consumer can't re-read, and never secrets or credentials.
  Contact details and totals are read from the order at send time; totals are immutable once paid (I26).
- **Not routed through the outbox:** the payment ledger and inventory, which stay synchronous, and the order state
  machine.
- **Loyalty points** (D8 business truth) are now written **inside** the transition / refund transactions (see §4).

## 2. Outbox schema (`OutboxEvent`, migration `20261004100000_phase8_outbox`, additive)

- **Identity and payload:** `eventType` (versioned), `consumer`, `eventKey`, unique `(consumer, eventKey)`,
  `aggregateType`/`aggregateId`, `payload` JSONB.
- **Delivery state:** `status` `PENDING → ENQUEUED → PROCESSING → PROCESSED | FAILED`, `attempts`, `availableAt`
  (backoff), `claimedUntil` (lease), `enqueuedAt`, `processedAt`, `lastError`.
- **Timestamps:** naive UTC, the established convention. Raw SQL binds go through `utcInstant`.
- **Writer:** only `domain/outbox/outbox.ts` `recordOutboxEvents(tx, …)`. It takes a transaction client and validates
  the consumer, event version and payload. An invalid intent throws, which rolls the business change back.

## 3. Delivery

**Dispatcher** (`dispatchOutbox`, a BullMQ scheduler job every 3 s, one schedule for any number of instances):
- It claims due `PENDING` rows with `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)` and a 30 s lease.
- It enqueues a `deliver` job whose job id is `outbox-<id>-<attempts>`. BullMQ drops a duplicate add of the same
  attempt.
- It marks a row `ENQUEUED` **only after** the enqueue succeeded.
- If the enqueue fails (Redis down), it releases the claim and moves `availableAt` 10 s later. Nothing is lost.

**Worker** (`processOutboxEvent`, concurrency 5):
- It claims the row atomically (`PENDING|ENQUEUED`, due → `PROCESSING`, attempts + 1, 5 min lease). A duplicate
  delivery finds it `PROCESSING` or `PROCESSED` and returns `skipped`.
- It refuses an unknown consumer, an unaccepted event version or a schema-invalid payload with `FAILED`, never
  retrying them.
- It runs the consumer. On success the row becomes `PROCESSED`, with the payload scrubbed where the consumer asks.
- On a retryable error the row goes back to `PENDING` with backoff of 30 s × 2^(n−1), capped at 6 h.
- It becomes `FAILED` on a non-retryable error, or after **8** attempts.

**Reaper:**
- `PROCESSING` rows past their lease (a worker crash) return to `PENDING`.
- `ENQUEUED` rows older than 15 min (a lost job) return to `PENDING`.

**Queue integration:**
- The existing BullMQ connection (`lib/queue.ts`) and queue `outbox`.
- Durable retry and failure state lives in PostgreSQL. BullMQ runs each job once (`attempts: 1`) and is the
  transport only.

**Failure policy:**

| Consumer | Retryable | Non-retryable |
|---|---|---|
| SMS (`SmsProviderError`) | network, HTTP 5xx/429, unreadable response | the provider rejected the message (any `response_code` ≠ 202) |
| Email (`MailProviderError`) | no status, 429, 5xx | other 4xx |
| Meta (`MetaApiError`) | 5xx, 429, `is_transient` | everything else |
| Unknown errors | retryable | — |

## 4. Consumers and idempotency

| Consumer | Side effect | Duplicate behaviour | Retry | Permanent failure |
|---|---|---|---|---|
| `customer-order-sms` | SMS to the customer (admin toggle and template read at send time) | Row claim skips it. BulkSMSBD has **no** idempotency, so a crash after the provider accepted and before PROCESSED resends once the lease expires (at-least-once, documented) | backoff, 8 attempts | FAILED, visible, operator retry |
| `admin-order-alert-sms` | SMS to each admin phone | Row claim skips it. Retried only if **every** phone failed, so a partial success is never re-sent | same | same |
| `payment-receipt-email` | receipt email | Row claim skips it, **and** Resend `idempotencyKey` = event id (24 h provider dedupe) | same | same |
| `meta-capi-purchase` | Conversions API Purchase | Row claim skips it, **and** Meta event_id `purchase_<orderNumber>` (48 h) | same | same |

**Loyalty points (D8)** are business truth, not an outbox side effect:
- `awardDeliveryPoints(tx, …)` runs in the DELIVERED transition's transaction, row-locked on the customer, so
  concurrent awards give one award.
- `reverseDeliveryPoints(tx, …)` runs in the RETURNED transition and in the refund-record / refund-complete
  transactions.
- A points write now commits or rolls back with its cause (P8-1).

## 5. Retention and observability

**Retention:**
- `PROCESSED` rows are kept **30 days**, then deleted by a daily cleanup job (03:00).
- `FAILED` rows are never deleted automatically.
- Meta shopper context is dropped from the payload on success.

**Observability:**
- `GET /api/v1/outbox/status` (admin) returns:
  - counts per status and the undelivered total;
  - the oldest undelivered event (age, attempts, last error);
  - the oldest failure age;
  - the 20 most recent failures (event, consumer, key, attempts, last error, timestamps);
  - the dispatcher heartbeat (`healthy` if it ran within 60 s).
- `POST /api/v1/outbox/:id/retry` (OWNER) re-drives a FAILED event.

## 6. Guarantees and concurrency (evidence)

| Guarantee | Evidence |
|---|---|
| Truth + intent atomic | a committed order has its intents; a rolled-back transaction has none; an invalid intent rolls the business write back; a rolled-back transition leaves neither status nor intent |
| No double dispatch | 10 rounds × 4 concurrent dispatchers × 25 events → **250/250 enqueued exactly once** (0 duplicates), in every one of 8 suite runs (3 without Redis, 5 with) |
| No double processing | 10 rounds × 5 concurrent deliveries of one event → **side effect ran exactly once in 10/10 rounds**, in every run |
| Crash windows | claim-then-crash: the lease blocks others until it expires, then the event is dispatched. Enqueue-then-crash: the redispatch reuses the job id and there is one delivery. Worker crash: the reaper returns the row and it is delivered again (at-least-once) |
| Redis unavailable | the row stays PENDING, the claim is released, and it is dispatched later |
| Real BullMQ (Redis connected) | a duplicate job id is enqueued once; record → dispatch → BullMQ worker → PROCESSED |
| Business truth isolation | a permanently failing consumer leaves order, stock movements, payments and points byte-identical |

**DB unavailable:**
- The dispatcher's claim query fails before any enqueue, so nothing is marked or lost.
- A business transaction that can't write its intent doesn't commit.
- This follows from the design; there is no dedicated test that takes the DB down.

## 7. Verification (2026-09-30)

| Gate | Result |
|---|---|
| Outbox integration (`domain/outbox/outbox.integration.test.ts`) | 23 passed (atomicity ×6, loyalty ×1, dispatcher ×5, worker ×7, real consumers + truth ×2, operator ×1, BullMQ ×1); repeated 3× without Redis and 5× with Redis, all green |
| Guards (`domain/outbox/outbox.guard.test.ts`) | 6 passed. See the list below this table |
| Source mutations (by hand, then restored) | **14/14 killed.** See the list below this table |
| Full API suite, Redis connected / without Redis | 55 files, **737 / 737** passed |
| D8 alone (`-t D8`) with Redis | 2/2 |
| Playwright desktop + mobile (API with the live outbox worker) | **194 passed, 2 skipped, 0 failed** (98 / 98). Afterwards the live status endpoint showed dispatcher **healthy**, 0 undelivered, 751 processed, 4 failed (see §8) |
| TypeScript (api, web) · ESLint (api clean; web 0 errors, 2 pre-existing `<img>` warnings) · API build | clean |
| Next.js build | compiled, 12/12 pages; the standalone copy step fails with the known Windows symlink `EPERM` (14) |
| Database (`clothing_brand_test` only; no shadow DB) | empty DB → full chain of **81** migrations → seed → `migrate status` up to date → `migrate diff` no drift; the Phase 8 migration is additive (a new enum and a new table) |

The guards check that:
- only the writer creates outbox rows, and every call passes the transaction client;
- business-transaction modules never call a provider or deliverer;
- only consumers call the deliverers;
- outbox code never writes business truth;
- there is no new direct queue publishing (the campaign enqueue is the documented exception);
- event names are versioned and every consumer states its idempotency boundary.

The source mutations were:
- outbox write removed from the order transaction;
- outbox row written outside the transaction;
- idempotency bypassed;
- retry disabled;
- ENQUEUED marked before the enqueue;
- crashed-worker events lost (reaper off);
- dispatcher ignoring leases;
- non-retryable errors retried;
- max attempts ignored;
- version check bypassed;
- duplicate intents not deduplicated;
- the payload not validated;
- points not in the delivery transaction;
- the status SMS intent dropped.

## 8. Known limitations

- **SMS is at-least-once.** The provider has no idempotency key, so a crash between the provider's acceptance and
  marking the row processed can resend after the 5-minute lease.
- **Real sends in local e2e.** The local API environment carries a real SMS provider key. With the live worker,
  Playwright's orders produced real BulkSMSBD calls, which the provider refused (`1032`, IP not whitelisted): the
  4 FAILED rows. The pre-Phase-8 code made the same calls and hid the failures. Local and CI e2e should run with
  `BULKSMSBD_API_KEY=""`, as they already do with `RESEND_API_KEY=""`.
- **Worker placement.** Workers still run inside the API process. A separate worker process is TARGET §14.
- **Meta drain worker.** The `meta-capi` BullMQ worker stays only to drain jobs queued before this deploy. It can be
  removed once that queue is empty.
- **Toggles at send time.** Consumers evaluate admin toggles and templates at send time, not at event time. An SMS
  disabled during an outage is not sent when the outage ends.

## 9. Deferred

- Admin bell notifications, back-in-stock and price-drop emails, campaign-send reliability, courier-booking
  concurrency. All can adopt the same outbox.
- The TARGET §6 generic domain-event catalogue.
- A separate worker process.
- Event sourcing, Kafka, multi-region messaging, tracing, replacing BullMQ.
- Installer/config packs, `CommerceSettings`/`StoreProfile`, country packs, `ProviderConfig`, per-order currency, daily
  facts, roles.
