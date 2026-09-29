# Payment Ledger — Phase 4 (Order Payment & Refund SSOT)

**Status:** Phase 4 — **implemented** (2026-09-29), branch `phase-4/payment-ledger`, awaiting owner sign-off. Test
evidence: §15. Evidence and scope selection:
[PHASE_4_AUDIT.md](PHASE_4_AUDIT.md). It builds on D1, D6 and D8 ([BUSINESS_DECISIONS.md](BUSINESS_DECISIONS.md)), the
order state machine ([ORDER_STATE_MACHINE.md](ORDER_STATE_MACHINE.md)) and the Phase 2 totals formula
([PRICING_INVARIANTS.md](PRICING_INVARIANTS.md) §6). It changes none of them.

```
database truth   Payment rows (every settlement: gateway, COD collected, manual)   Refund rows (REQUESTED → COMPLETED)
                 Order.total (charged, Phase 2 snapshot + adjustment)              Order.paymentMethod, Order.status
   → pure engine    packages/shared/src/engines/payment-ledger.ts
                    derivePaymentPosition()  → paid, refunded, refundPending, netPaid, amountDue, codToCollect,
                                               refundable, refundDue, overpaid, settled, status
                    checkRefund(), checkManualPayment()
   → domain service apps/api/src/domain/payments/payment-ledger.service.ts   (the ONLY writer of Payment, Refund
                    and the Order.paymentStatus projection; every command runs under the order row lock)
   → read model     OrderPaymentSummary (position + payments + refunds), attached to admin order DTOs
   → API            /api/orders/:id/payment · /payments · /refunds · /refunds/:id/complete
                    /api/payment-admin/ledger/drift · /repair
   → consumers      courier booking (Steadfast cod_amount), admin order page, shipping labels, order list/stats
                    queue, payments overview, the order state machine (T4 COD collection, T8 guard), loyalty (D8)
```

---

## 1. The facts and the projection

| Element | Class | Meaning |
|---|---|---|
| `Payment` (status `SUCCEEDED`) | **fact** (append-only) | Money received for an order: a verified gateway settlement (`SSLCOMMERZ`, `EPS_PG`), cash the courier collected on delivery (`COD`), or an out-of-band payment staff recorded (`MANUAL`: bKash/bank/cash before dispatch). `amount` is what was applied to the order. |
| `Payment` (status `FAILED`) | fact | A definitive, re-verified gateway failure. It records no money, but it's the input for the `FAILED` status. |
| `Refund` (status `COMPLETED`) | **fact** (append-only once completed) | Money sent back, recorded by staff after they made the transfer (no gateway refund API exists). |
| `Refund` (status `REQUESTED`) | fact (a commitment) | Money owed back and not yet paid out: a D6 exchange downgrade. Completing it is the only mutation a refund row ever gets. |
| `Order.total` | snapshot | What the order charges: the Phase 2 quote plus any admin adjustment made **before** money was received (PL-7). |
| **`Order.paymentStatus`** | **projection** | `derivePaymentPosition(...).status`, written only by `refreshPaymentStatus` in the same transaction as the fact that changed it. Kept as a column because many filters, indexes and SQL reports read it. |

Nothing else stores payment truth. `PaymentSession` keeps the gateway attempt lifecycle (unchanged). `PaymentEvent`
keeps the gateway attempt timeline (unchanged). Payment and refund commands also append a note to
`OrderStatusHistory` (status unchanged), so the order's own timeline shows money movements.

## 2. Single writer

| Table / column | Writer | Anything else |
|---|---|---|
| `Payment` (create) | `payment-ledger.service.ts` | forbidden (architecture guard, PL-4) |
| `Refund` (create, complete) | `payment-ledger.service.ts` | forbidden |
| `Order.paymentStatus` | `payment-ledger.service.ts` `refreshPaymentStatus` | forbidden. Orders are inserted with the column default `UNPAID`, and the ledger then decides |

`payment.service.ts` keeps orchestrating gateway sessions (`PaymentSession`: initiate, claim, verify, expire,
reconcile). When it has a verified outcome, it calls the ledger. `order.service.ts` (insert, T4, manual order,
adjustment guard), `return-request.service.ts` (exchange downgrade) and `courier.service.ts` (booking amount) call the
ledger or read its position. None of them writes payment truth.

## 3. The engine (pure)

`packages/shared/src/engines/payment-ledger.ts`: no Prisma, no clock, integer minor units (`Money`).

```ts
derivePaymentPosition({
  currency, total: Money, paymentMethod: string, orderStatus: string,
  settlements: Money[],        // SUCCEEDED Payment amounts (zero-amount settlements count as "settled")
  failedAttempts: number,      // FAILED Payment rows
  refundsCompleted: Money[], refundsRequested: Money[],
}): PaymentPosition
```

| Output | Definition |
|---|---|
| `paid` | Σ settlements |
| `refunded` | Σ completed refunds |
| `refundPending` | Σ requested refunds |
| `netPaid` | `max(0, paid − refunded)` |
| `amountDue` | `max(0, total − paid)`: what the customer still owes (refunds never create a new debt) |
| `codToCollect` | `amountDue` if `paymentMethod = COD` and the order isn't closed (`CANCELLED`/`RETURNED`/`REFUNDED`), else 0. What the courier collects at the door |
| `refundable` | `max(0, paid − refunded − refundPending)`: the most a new refund may be |
| `refundDue` | order `CANCELLED` or `RETURNED` (the goods never reached, or came back from, the customer): `netPaid − refundPending`; otherwise the overpayment `netPaid − total − refundPending`. Floored at 0. The refund-queue amount |
| `overpaid` | `max(0, netPaid − total)` |
| `settled` | at least one settlement exists |
| `status` | §4 |

`checkRefund(position, amount)` → ok, or `NOT_POSITIVE` / `EXCEEDS_REFUNDABLE`.
`checkManualPayment(position, amount)` → ok, or `NOT_POSITIVE` / `EXCEEDS_AMOUNT_DUE`.

## 4. Payment status derivation (PL-1)

Evaluated in this order:

| # | Condition | Status |
|---|---|---|
| 1 | `refunded > 0 ∧ refunded ≥ paid` | `REFUNDED` |
| 2 | `settled ∧ netPaid ≥ total` | `PAID` (this also covers a refunded duplicate payment: the order is still fully paid) |
| 3 | `refunded > 0` | `PARTIALLY_REFUNDED` *(new, additive enum value — planned as M8 since Phase 0)* |
| 4 | `¬settled ∧ failedAttempts > 0` | `FAILED` |
| 5 | otherwise | `UNPAID` (includes `settled ∧ paid < total`, which no Phase 4 command can produce: see PL-7) |

These rules preserve every pre-Phase-4 meaning:
- `PAID` still means "the order total has been received".
- `FAILED` still means "the last attempt failed and nothing was received". A later success moves the order to `PAID`,
  as before.
- `REFUNDED` still means "fully refunded", which is what the state machine's T8 guard requires.
- A free exchange (total 0) is `PAID` because it's settled by a zero-amount `MANUAL` settlement. A COD order with total
  0 becomes `PAID` at delivery through a zero-amount `COD` settlement, exactly as T4 did before.

## 5. Commands (domain service)

Every command runs in one transaction that first takes `SELECT … FOR UPDATE` on the `Order` row. Concurrent money
commands on one order serialise, and each one validates against the position it sees under the lock.

| Command | Called by | Rule |
|---|---|---|
| `recordGatewaySettlement(tx, {orderId, paymentSessionId, provider, amount, verifiedAmount, providerTransactionId, rawResponse})` | `payment.service` `settlePaymentSession` (existing order), `insertOrderRecord` (pre-order session materialising its order, same transaction) | one `Payment` per session (unique `paymentSessionId`). A second session succeeding on a paid order is still recorded (money was taken) and surfaces as `overpaid` / `refundDue` |
| `recordFailedAttempt(tx, {orderId?, paymentSessionId, provider, amount, rawResponse})` | `markPaymentSessionFailed` | a pre-order session (no order) records the row only |
| `recordCodCollection(tx, orderId, actor)` | order state machine, T4 (`→ DELIVERED`) | COD order, not already fully settled → `COD` settlement of `amountDue` (0 allowed, so a total-0 COD order is still settled). Replaces the Phase 1 direct `UNPAID → PAID` write. D1 unchanged |
| `recordManualPayment(orderId, {amount, kind: MANUAL \| COD_COLLECTED, method, note}, adminId, idempotencyKey)` | `POST /orders/:id/payments`; `createManualOrder(markPaid)` (in the order's own insert transaction) | `0 < amount ≤ amountDue`. `MANUAL`: order not closed; for a COD order, not after courier booking (the parcel's COD amount is fixed at booking). `COD_COLLECTED`: COD order in `PARTIALLY_DELIVERED` (the courier collected part; the state machine can't know how much). Doesn't change the order status |
| `recordRefund(orderId, {amount, reason, method}, adminId, idempotencyKey)` | `POST /orders/:id/refunds` | `0 < amount ≤ refundable`. Partial and repeated refunds allowed. Status follows §4 (`PARTIALLY_REFUNDED` or `REFUNDED`). Post-commit: D8 point reversal of `amount ÷ rewardable` (existing capped reversal) |
| `requestRefund(tx, orderId, {amount, reason}, adminId)` | exchange approval (D6 downgrade), inside the approval transaction | `0 < amount ≤ refundable`, else 409 (the approval rolls back) |
| `completeRefund(refundId, {method, note}, adminId)` | `POST /orders/:id/refunds/:refundId/complete` | `REQUESTED → COMPLETED` (one-way; a completed refund is never changed). Re-checks `refunded + amount ≤ paid`. Post-commit D8 reversal as for `recordRefund` |
| `refreshPaymentStatus(tx, orderId)` | every command above; the repair command | recomputes §4 and writes the projection if it changed |

### Guard on the order total (PL-7)

`adjustOrderPrice` is refused (409 `ORDER_ALREADY_PAID`) once `paid > 0`, and it now runs under the order row lock.
The total the customer paid against is frozen, so `PAID` keeps meaning "this total was received". Money corrections
after payment go through refunds. The owner can overrule this recorded interpretation (BUSINESS_DECISIONS, Phase 4
notes, P4-1).

## 6. The order state machine

| Transition | Before Phase 4 | Phase 4 |
|---|---|---|
| T4 `→ DELIVERED` (COD) | writes `paymentStatus = PAID` | `recordCodCollection`: a `COD` settlement of the balance due, then the projection (→ `PAID`). Same result, now backed by a money record |
| T6/T7 cancel/return of a paid order | alert "refund may be owed" | same alert. The owed amount is now the position's `refundDue` |
| T8 `→ REFUNDED` | requires `paymentStatus = REFUNDED` | unchanged. Only a full refund satisfies it; `PARTIALLY_REFUNDED` does not |
| Gateway settlement | `syncOrderPaymentStatus` writes `PAID`, then `PENDING → CONFIRMED` | ledger settlement + projection + the same `PENDING → CONFIRMED` transition, in **one** transaction |

## 7. Read model — `OrderPaymentSummary`

```ts
{
  status, currency,
  total, paid, refunded, refundPending, netPaid, amountDue, codToCollect, refundable, refundDue, overpaid,  // major units
  payments: [{ id, provider, status, amount, method, note, backfilled, settledAt, recordedBy }],
  refunds:  [{ id, status, amount, reason, method, requestedBy, completedBy, completedAt, createdAt }],
}
```

Attached as `order.payment` to the admin order detail (`GET /api/orders/:id`) and the bulk label fetch
(`POST /api/orders/bulk/get`). The web renders these numbers and computes none of them:
- **Courier booking** sends `codToCollect` as Steadfast's `cod_amount`, for both single and bulk booking. This is a
  server read of the same position; the web never passes an amount.
- **Booking confirmation, shipping labels and the admin payment panel** display `codToCollect`, the payment totals and
  the refund list.
- **Payment status labels** come from one label map (`lib/format.ts`), replacing three inline ternaries.
- The **refund form** defaults to `refundable`, not `order.total`.

The refund queue ("cancelled but paid") is one shared predicate, `REFUND_QUEUE_WHERE = { status: CANCELLED,
paymentStatus ∈ {PAID, PARTIALLY_REFUNDED} }`, used by the order list filter, the order stats and the payments overview.

## 8. API contract

| Method & path | Auth | Body | Success | Errors |
|---|---|---|---|---|
| `GET /api/orders/:id/payment` | admin | — | `200 { payment: OrderPaymentSummary }` | 404 |
| `POST /api/orders/:id/payments` | admin | `{ amount, kind: "MANUAL" \| "COD_COLLECTED", method?, note? }` · `Idempotency-Key` optional | `201 { payment, summary }` | 400 `PAYMENT_EXCEEDS_AMOUNT_DUE` (`details.amountDue`), 400 `PAYMENT_NOT_ALLOWED` (closed order / courier booked / wrong kind), 404 |
| `POST /api/orders/:id/refunds` | admin | `{ amount, reason?, method? }` · `Idempotency-Key` optional | `201 { refund, summary }` | 400 `REFUND_EXCEEDS_REFUNDABLE` (`details.refundable`), 400 `NOTHING_TO_REFUND`, 404 |
| `POST /api/orders/:id/refunds/:refundId/complete` | admin | `{ method?, note? }` | `200 { refund, summary }` | 409 `REFUND_NOT_REQUESTED` (already completed), 409 `REFUND_EXCEEDS_PAID`, 404 |
| `GET /api/orders/:id/refunds` | admin | — | `200 { refunds }` (unchanged) | — |
| `PATCH /api/orders/:id/price` | admin | unchanged | unchanged | + 409 `ORDER_ALREADY_PAID` |
| `GET /api/payment-admin/ledger/drift` | admin | — | `200 { checked, drift[], violations[] }` | — |
| `POST /api/payment-admin/ledger/repair` | OWNER | `{ apply: boolean }` (default dry run) | `200 { checked, changed[], applied }` | — |

Errors use the existing envelope `{ error: "<message>", details: { code, … } }` (`AppError`, the same shape as
Phase 2's `QUOTE_CHANGED`).

## 9. Idempotency

- **Gateway:** one `Payment` per `PaymentSession` (existing unique index). The session claim is unchanged.
- **Manual payment / refund:** optional `Idempotency-Key` header (8–128 printable chars, the same rule as order
  creation), stored on `Payment.idempotencyKey` / `Refund.idempotencyKey` (unique). A repeat returns the original row.
  A unique-violation race returns the winner. Without a key, double-clicks are still bounded by the caps: a second full
  refund finds `refundable = 0`, and a second manual payment finds `amountDue = 0`.
- **COD collection:** once per order. T4 is itself idempotent (a same-status transition is a no-op), and the command
  records nothing when the order is already fully settled.
- **Refund completion:** `REQUESTED → COMPLETED` is a conditional update. The loser gets 409.

## 10. Historical truth

- `Payment` rows are never updated or deleted by application code. `Refund` rows change only `REQUESTED →
  COMPLETED`.
- No payment command writes an order money field. The only money write to `Order` is still `adjustOrderPrice`, and it
  is now refused once money was received (PL-7).
- The projection is recomputed only from the order's own ledger rows. It never reads current settings, prices or
  provider state.

## 11. Migration, backfill, compatibility

Two additive migrations. Enum values are added in the first and used by the second, because PostgreSQL can't use a
new enum value in the same transaction that adds it.

1. `20261001100000_phase4_payment_ledger`
   - `PaymentStatus += PARTIALLY_REFUNDED`
   - `PaymentProvider += COD, MANUAL`
   - `Payment.paymentSessionId` DROP NOT NULL (COD and manual settlements have no gateway session; the unique index
     stays)
   - `Payment.note`, `recordedByAdminId` (FK SetNull), `idempotencyKey` (unique), `backfilled` (default false)
   - `Refund.idempotencyKey` (unique), `completedByAdminId` (FK SetNull)
2. `20261001100100_phase4_payment_ledger_backfill`: inserts **only** settlement rows that each order's own record
   already asserts, all marked `backfilled = true` with an explanatory note:
   - (a) `paymentStatus ∈ {PAID, REFUNDED}` and no `SUCCEEDED` payment → one settlement of `total`. The provider is
     `COD` when the order is COD and its timeline has a `DELIVERED` entry (settled at that time), else `MANUAL`
     (settled at order creation).
   - (b) a COD order with a `DELIVERED` timeline entry, still `UNPAID`, with no settlement → a `COD` settlement of
     `total` (D1: delivered = collected). This is the pre-Phase-1 returned-after-delivery case that
     `refundOrderPayment` used to treat as collected implicitly.

   No `Order` row is changed. Afterwards, the drift report lists every order whose stored status differs from the
   ledger: legacy partial refunds stored as `REFUNDED`, and case (b) orders now `PAID`. The explicit repair command
   fixes the projection (dry run by default). Order statuses are never touched.

**Compatibility projections.**
- `Order.paymentStatus` keeps its name, column and every existing reader. `PARTIALLY_REFUNDED` is added to the shared
  Zod enum and web types.
- Three analytics/BI SQL predicates that meant "has a refund" (`paymentStatus = 'REFUNDED'`) also accept
  `PARTIALLY_REFUNDED`, so their numbers keep their pre-Phase-4 meaning. Their definitions are rewritten in Phase 5,
  not here.
- `refundOrderPayment` / `listRefundsForOrder` remain as thin exports delegating to the ledger, so existing imports and
  tests keep working. Removal path: callers migrate to `domain/payments` imports in Phase 5; the aliases are then
  deleted.

## 12. Reconciliation

`paymentLedgerDrift()` (API `GET /api/payment-admin/ledger/drift`, CLI `pnpm --filter api payment-ledger:reconcile`)
scans orders in batches and reports:
- **drift:** stored `paymentStatus` ≠ derived status (PL-1).
- **violations:** Σ completed refunds > Σ paid (PL-2); a COD order in `DELIVERED` whose derived status isn't
  `PAID`/`PARTIALLY_REFUNDED`/`REFUNDED` (PL-5).

`repairPaymentLedger({ apply })` (API `POST …/repair`, OWNER; CLI `--apply`) rewrites only the projection, through
`refreshPaymentStatus`. It's a dry run unless `apply` is true, and it prints before/after for every changed order.
Violations are never auto-repaired; they need a person.

## 13. Invariants (each has a test)

| ID | Invariant | Test |
|---|---|---|
| PL-1 | `Order.paymentStatus = derivePaymentPosition(ledger).status` after every command | engine table tests; integration after each command; drift report empty after a mixed scenario |
| PL-2 | Σ completed refunds ≤ Σ paid per order; a refund never exceeds `refundable` | engine; integration (cap, cumulative partials, concurrent refunds); API 400 contract |
| PL-3 | a partial refund leaves `PARTIALLY_REFUNDED`, and further refunds up to the rest are accepted; the full amount → `REFUNDED`; refunding only an overpayment leaves `PAID` | engine; integration |
| PL-4 | only `payment-ledger.service.ts` writes `Payment`, `Refund` or `Order.paymentStatus` | architecture guard test (+ self-test) |
| PL-5 | a COD order that reached `DELIVERED` has a COD settlement and status ∈ {PAID, PARTIALLY_REFUNDED, REFUNDED} (extends I16) | state-machine integration |
| PL-6 | the courier's COD amount = `codToCollect`; a prepaid COD order is booked with 0 | engine; integration (manual-paid COD order); booking amount unit test |
| PL-7 | a paid order's total never changes (`adjustOrderPrice` → 409) | integration |
| PL-8 | exchange downgrade → `REQUESTED` refund → completable exactly once → status follows | integration |
| PL-9 | ledger rows are append-only; refund completion is one-way | integration (double completion → 409) |
| PL-10 | Idempotency-Key on payment/refund returns the same row | integration |
| PL-11 | gateway settlement of an existing order writes the `Payment`, the projection and `PENDING → CONFIRMED` atomically | integration |

Mutation tests (`payment-ledger.mutation.test.ts`) deliberately break each engine rule (cap, status order, refunded
threshold, COD scope, due floor) and assert that the invariant tests detect the change.

## 14. Deferred (not Phase 4)

| Item | Phase |
|---|---|
| Revenue, net sales, refunds, returns, collected cash (`Σ Payment − Σ Refund`), outstanding COD (`Σ codToCollect`) and AOV as registered metrics; BI refund cost from `Σ Refund.amount` | 5 |
| Raw `NOW()` windows and store-timezone business days in analytics | 5 |
| Customer lifetime spend net of refunds | 5 |
| Exchange orders through the single order writer; "exchange is not a sale" predicate | 5 |
| Coupon `usedCount` drift report, low-stock count definition | 5 |
| Gateway refund APIs, `PaymentProvider` as string keys (`ProviderConfig`) | 7 |
| `payment.succeeded`, `refund.recorded` outbox events (post-commit calls today) | 8 |
| Permission for refunds and manual payments (`refunds.create`) | 10 |
| Cancelling a `REQUESTED` refund (no business rule asks for it yet) | — |

## 15. Verification (Phase 4 sign-off run, 2026-09-29)

| Gate | Result |
|---|---|
| Engine unit tests (`lib/payment-ledger-engine.test.ts`) | 15 passed |
| Mutation tests (`lib/payment-ledger.mutation.test.ts`) | 12 passed: canonical engine clean, 11/11 mutants killed |
| Source mutations (run by hand against the integration suite, then reverted) | 5/5 killed: courier COD = total; T4 without COD collection; projection never written; refund cap removed; price-adjustment guard removed (both the pre-check and the in-lock re-check — either one alone still blocks it) |
| Architecture guard (`domain/payments/payment-ledger-writer.guard.test.ts`) | 2 passed |
| Integration + HTTP contract (`domain/payments/payment-ledger.integration.test.ts`) | 18 passed |
| Full API suite | 41 files, 500 tests passed |
| Playwright desktop + mobile | 194 passed, 2 skipped (viewport-scoped by the specs), 0 failed |
| TypeScript (api, web) · ESLint (api, web) · API build | clean |
| Next.js build | compiled, type-checked, 12/12 pages generated; the standalone copy step fails with the known Windows symlink `EPERM` (not a code error) |
| Test DB (`clothing_brand_test`) | reset + all 78 migrations from zero, seeded; `migrate status` up to date; `migrate diff` (datasource → datamodel, read-only) no drift; ledger drift report 0 |

The one integration fixture that changed (`payment.integration.test.ts`) had built a `REFUNDED` order by writing the
status directly with no payment or refund rows. It now builds the order through a real settlement and refund, because
the status is derived from those rows.
