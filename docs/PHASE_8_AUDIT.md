# Phase 8 Audit: Outbox & Reliable Side Effects

**Status:** audit and design, 2026-09-30, branch `phase-8/outbox-reliable-side-effects` (from Phase 7 `cb8d137`).

**Central invariant:** if business truth commits, required side-effect intent is durable. If delivery is retried,
consumers stay safe. External side effects never become business truth.

**Method:** traced every BullMQ queue and worker, every `$transaction`, and every post-commit or fire-and-forget call
(`void (async …)`, `.catch(console.error)`, un-awaited promises). That covered order creation, transitions, payment
settlement, refunds, exchanges, courier, inventory, catalog, campaigns, notifications, SMS, email, Meta and cache/read
model code. **There is no event table, event bus or `afterCommit` hook today.** Every side effect is called inline after
the transaction.

---

## A. Event / side-effect inventory

| Event / side effect | Producer | Business transaction | Current delivery | Failure mode | Idempotency | Retry | Criticality | Outbox needed? |
|---|---|---|---|---|---|---|---|---|
| Customer order SMS: PLACED (checkout) / CONFIRMED (gateway-created order) | `insertOrderRecord` → `sendCustomerOrderSms` | order create tx | post-commit, fire-and-forget | crash after commit, or SMS provider error/outage → **lost silently** | none (provider has none) | **none** | high: the customer's order receipt | **yes** |
| Admin new-order alert SMS | `insertOrderRecord` → `sendAdminOrderAlertSms` | order create tx | post-commit, fire-and-forget | same → lost | none | none (per-phone errors logged) | high: staff act on it | **yes** |
| Customer status SMS: CONFIRMED / SHIPPED / DELIVERED / CANCELLED | `runTransitionSideEffects` (all transitions: admin, bulk, courier sync, returns) | transition tx | post-commit, fire-and-forget | lost | none | none | high | **yes** |
| Payment confirmed: SMS CONFIRMED + receipt email | `settlePaymentSession` (existing order) / `insertOrderRecord` via settlement (new order) | ledger settlement tx | post-commit, fire-and-forget | lost | none | none | high: proof of payment | **yes** |
| Meta CAPI Purchase | `insertOrderRecord` → `enqueueMetaPurchase` | order create tx | post-commit enqueue (BullMQ, jobId `purchase-<orderId>`, 8 attempts, exponential) + inline fallback if Redis is down | crash between commit and enqueue → lost | event_id `purchase_<orderNumber>` (Meta dedupes 48 h) | BullMQ | medium: marketing attribution | **yes** (same pattern, closes the commit→enqueue window) |
| **Loyalty points award (D8)** | `runTransitionSideEffects` → `awardDeliveryPoints` | transition tx | **post-commit write of business truth** | crash after commit → points never awarded; two concurrent awards → possible double award (find-then-create, no lock) | partial (existence check, unlocked) | none | **high: business truth** | **no: must be in the transaction**, not a worker |
| **Loyalty points reversal (D8)** | `runTransitionSideEffects` / ledger `recordRefund` / `completeRefund` → `reverseDeliveryPoints` | transition / refund tx | **post-commit write of business truth** | crash → reversal lost (customer keeps points) | capped and row-locked | none | **high** | **no: must be in the transaction** |
| Admin bell notifications (`notify`) | many | various | post-commit DB insert, fire-and-forget | lost on crash | none | none | low: operational; money-risk states are also shown from truth (refund queue, amount due) | defer |
| Back-in-stock / price-drop emails | `notifyReplenished` / `notifyPriceDrop` | inventory / catalog tx | post-commit, fire-and-forget | lost | `StockAlert.alertedAt`, `WishlistItem.alertedAt` markers | none | low: marketing | defer |
| Delivery-score check (Steadfast fraud check) | `insertOrderRecord` | order create tx | post-commit, fire-and-forget | lost | overwrite (cache on customer) | admin "Check score" | low: derived cache | not needed |
| Cart mirror clear | `insertOrderRecord` | — | post-commit | stale mirror → abandonment sweep uses `Cart.updatedAt` | overwrite | — | low: derived | not needed |
| Courier booking (Steadfast create) | admin command `bookOrderWithSteadfast` | **none**: external call, then DB write | synchronous request/response | concurrent double click → possible duplicate consignment | `invoice = orderNumber`; `courierConsignmentId` check (not locked) | admin retries | medium | **not an outbox case** (a command whose result the admin needs now). Locking is a separate hardening item, deferred |
| Courier status sync | cron | per order, `updateOrderStatus` | BullMQ cron every 15 min | self-healing (next run) | status-idempotent | cron | — | not needed (its SMS is covered via transitions) |
| Storefront read-model refresh | product / flash-sale services | catalog tx | post-commit eager refresh + **15-min rebuild cron** | refresh lost → rebuilt within 15 min | derived, rebuildable | cron | medium | not needed (self-healing projection, Phase 3) |
| Cache invalidation / ISR revalidation | catalog / settings services | — | post-commit, best effort | stale until TTL/ISR window | overwrite | TTL | low | not needed (bounded staleness by design) |
| Campaign send | admin → `campaign-send` queue | campaign row | BullMQ | enqueue failure → campaign stays SENDING | recipient rows | BullMQ | medium | defer (separate campaign reliability item) |
| Payment reconciliation / flash-sale / campaign scheduler crons | BullMQ schedulers | — | cron | next run | idempotent sweeps | cron | — | not needed |
| Gateway callbacks / IPN | `settlePaymentSession` | ledger tx (synchronous truth) | request | provider retries IPN | settlement idempotency (Phase 4) | provider | — | **no** (ledger stays synchronous) |
| Inventory mutations | InventoryService | business tx | synchronous | — | ledger | — | — | **no** (stock truth stays synchronous) |

## B. Transaction boundary audit

| Flow | Truth commit | Side-effect publication | Atomic? | Window |
|---|---|---|---|---|
| Checkout / admin order | `insertOrderRecord` tx (order, lines, stock, coupon, ledger) | SMS ×2, Meta enqueue, notify: after commit | **no** | commit → process crash / provider error → lost |
| Status transition | `applyOrderTransition` tx (status, history, stock, COD collection, courier loss) | SMS, **points**, notify: after commit | **no** | same, and business truth (points) lost |
| Gateway settlement | ledger tx (+ confirm transition) | SMS CONFIRMED + email: after commit | **no** | same |
| Refund record / complete | ledger tx | **points reversal**: after commit | **no** | business truth lost |
| Meta | order tx | enqueue after commit | **no** | commit → crash before enqueue |

**The opposite case** (external effect published, then DB rolls back): none found. No producer calls a provider inside
a business transaction. Courier booking calls Steadfast before its DB write, but that write is a single row update of
the result, not a transaction the call depends on. The Phase 8 guard keeps it that way.

## C. Existing queue audit

**Infrastructure:**
- BullMQ on its own ioredis connection (`lib/queue.ts`, `maxRetriesPerRequest: null`), separate from the fail-fast
  cache connection.
- Workers start inside the API process (`server.ts`). There is no worker process yet (TARGET §14).
- Default concurrency is 1 per worker.

**Queues:**

| Queue | Purpose | Retries / backoff | Retention |
|---|---|---|---|
| `meta-capi` | Meta Purchase | 8 attempts, exponential 30 s; jobId `purchase-<orderId>` | `removeOnComplete`; failed kept 7 d |
| `campaign-send` | campaign sends | — | — |
| `campaign-scheduler` | scheduler (`upsertJobScheduler`) | — | — |
| `courier-status` | courier status sync | — | — |
| `flash-sale` (+ read-model rebuild) | schedulers | — | — |
| `payment-reconciliation` | scheduler | — | — |

**Gaps:**
- There is no dead-letter concept beyond BullMQ's failed set.
- There is no operational visibility beyond logs.
- Redis unavailable means `queue.add` rejects: Meta falls back inline and everything else simply has no queue.

**Verdict:** keep BullMQ as the transport (no replacement). Put the durable state (pending, attempts, failure) in
PostgreSQL, where it can be queried and survives a Redis loss.

## D. Idempotency audit

| Side effect | Business identity | Repeat safe today? | Provider idempotency | Local record needed? |
|---|---|---|---|---|
| Customer order SMS | (order, touchpoint / status-history row) | no: resend = duplicate SMS | **none** (BulkSMSBD) | **yes**: the outbox row itself (processed state + claim lease) |
| Admin alert SMS | (order, placed) | no | none | yes (same) |
| Payment receipt email | (order, paid) | no | **Resend `idempotencyKey`** (24 h) | outbox row + provider key |
| Meta Purchase | order | yes | **event_id** (48 h) | outbox row (skip after processed) |
| Points award | (order, `order_delivered`) | not under concurrency | — | in-transaction row lock |
| Points reversal | (order, cumulative cap) | yes (capped, locked) | — | — |

With SMS, a crash **after** the provider accepted but **before** the row is marked processed means the event is
delivered again once its claim lease expires. **At-least-once. Exactly-once SMS is not claimed.**

## E. Business-truth audit

The outbox holds **intent only**: event type, consumer, idempotency key and a minimal payload. Orders, inventory,
payments, refunds, pricing, points and metrics stay owned by their Phase 1–7 writers. Consumers read the order row at
send time, which is current contact and totals; money amounts are immutable after payment (I26). Consumers never write
business truth. Loyalty points, the only business truth currently written after commit, move **into** their business
transactions instead.

---

# Proposed Phase 8 Boundary

### MUST IMPLEMENT
1. **Transactional outbox** (`OutboxEvent`, additive migration).
   - Rows are written only with a transaction client, inside the business transaction, for:
     - customer order SMS (placed/confirmed on creation, every status touchpoint on transition);
     - the admin new-order alert SMS;
     - the payment receipt email.
   - The `sendCustomerOrderSms`, `sendAdminOrderAlertSms` and `sendPaymentConfirmationEmail` post-commit calls are
     removed.
2. **Dispatcher.**
   - Claims due rows with `FOR UPDATE SKIP LOCKED` and a claim lease.
   - Enqueues to BullMQ with a per-attempt job id.
   - Marks them enqueued only after the enqueue succeeds.
   - Is safe with any number of instances.
   - Leaves rows pending while Redis is unavailable.
3. **Worker.**
   - Claims the row (skips it if already processed or claimed).
   - Validates event type and version.
   - Runs the consumer.
   - Marks the row processed, or schedules a retry (exponential, max attempts), or marks it failed (non-retryable or
     exhausted).
4. **Loyalty points in the business transaction.**
   - `awardDeliveryPoints` / `reverseDeliveryPoints` run inside the transition, refund-record and refund-complete
     transactions.
   - The award becomes row-locked, so concurrent awards can't double-count.
   - This is not an outbox item: a worker must never write business truth.
5. **Operator visibility.** `GET /api/v1/outbox/status` (counts, oldest pending, recent failures, attempts, last error,
   dispatcher heartbeat) and `POST /api/v1/outbox/:id/retry` for a failed event.
6. **Retention.** Processed rows are kept for 30 days, then deleted by the dispatcher's daily cleanup. Failed rows are
   kept until an operator retries them.

### SHOULD IMPLEMENT (same architecture, low cost, done)
7. **Meta CAPI Purchase through the outbox.**
   - Closes the commit→enqueue window.
   - Keeps the Meta event_id dedupe.
   - The shopper's IP/user agent are scrubbed from the payload once sent.

### DEFER
- Admin bell notifications, back-in-stock and price-drop emails, campaign reliability, and courier-booking locking.
  They are low-criticality or separate command hardening, and can adopt the same outbox later.
- A separate worker process (TARGET §14).
- Event sourcing, Kafka, multi-region messaging, distributed tracing, replacing BullMQ.
- Generic domain-event refactoring (TARGET §6's full catalogue).
- Installer/config packs, roles, daily facts, per-order currency, `ProviderConfig`.
