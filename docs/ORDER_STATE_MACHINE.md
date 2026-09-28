# Order State Machine

**Status:** Phase 1 specification (approved decisions D1–D3, 2026-09-28). Implemented in
`packages/shared/src/order-state.ts` (the table, pure, shared with the admin UI) and enforced by
`applyOrderTransition` in `apps/api/src/modules/orders/order.service.ts` (the only code that changes
`Order.status` after creation).

## 1. Rules

1. **One entry point.** Every status change — admin picker, bulk action, Steadfast webhook/cron, courier
   booking, return approval, gateway settlement — calls the same transition function. Nothing writes
   `Order.status` directly after the order is created.
2. **Explicit matrix.** A transition not listed in §3 is rejected with HTTP 400 and a message naming both
   statuses. There is no generic "any status → any status".
3. **Transaction-safe.** The transition runs in one database transaction that (a) locks the order row
   (`SELECT … FOR UPDATE`), (b) validates the transition against the *locked* status, (c) applies stock,
   payment and bookkeeping effects, (d) writes the status and an `OrderStatusHistory` row. Concurrent
   transitions on the same order serialise; the second one sees the first one's result.
4. **Idempotent.** A transition to the order's current status is a no-op: no stock, payment, points, SMS
   or courier-loss effect. If a note is supplied it is appended to the timeline so an admin can still
   annotate. Stock effects are additionally idempotent per order line (`OrderItem.restockedQuantity`,
   see [INVENTORY_INVARIANTS.md](INVENTORY_INVARIANTS.md)), so no path can put the same unit back twice.
5. **Side effects after commit.** SMS, admin bell notifications and loyalty points run only after the
   transaction commits (they are recorded in the matrix as the transition's *notification event*).
6. **No resurrection.** `CANCELLED`, `RETURNED` and `REFUNDED` never move back to an active status.
   Phase 1 defines **no** "reopen" transition; a cancelled sale is re-entered as a new order (which
   reserves stock through the normal checkout path).

## 2. Status groups

| Group | Statuses | Stock held by the order? | Goods location |
|---|---|---|---|
| Pre-shipment | `PENDING`, `CONFIRMED`, `PROCESSING`, `PACKED` | yes (reserved at placement) | warehouse |
| In transit | `SHIPPED` | yes (sold) | courier |
| Fulfilled | `DELIVERED`, `PARTIALLY_DELIVERED` | sold (partial: until reconciled) | customer |
| Closed | `CANCELLED`, `RETURNED`, `REFUNDED` | released / returned | warehouse or customer |

## 3. Transition matrix

Legend for effects: **Stock** — `release` = put back every unit not already put back (`CANCELLATION`
movement); `return` = put back every unit not already put back and count it as returned (`RETURN`
movement, `returnedQuantity`). **Payment** — change to `Order.paymentStatus`. **Refund guard** — a
precondition on refund records. **Audit event** — the event name written into `OrderStatusHistory`
(and, from Phase 8, the outbox). **Notify** — post-commit messages.

| # | From | To | Stock | Payment | Refund | Return | Audit event | Notify |
|---|---|---|---|---|---|---|---|---|
| T1 | any pre-shipment | another pre-shipment | — | — | — | — | `order.status_changed` | customer SMS if → `CONFIRMED` |
| T2 | any pre-shipment | `SHIPPED` | — | — | — | — | `order.shipped` | customer SMS |
| T3 | `SHIPPED` | `PACKED` (correction: marked shipped too early) | — | — | — | — | `order.status_changed` | — |
| T4 | pre-shipment or `SHIPPED` | `DELIVERED` | — | COD: `UNPAID → PAID` (cash collected at the door, D1) | — | — | `order.delivered` | customer SMS; loyalty points (idempotent per order) |
| T5 | pre-shipment or `SHIPPED` | `PARTIALLY_DELIVERED` | — (settled by the *reconcile* command, §4) | — (amount collected unknown; admin records it) | — | — | `order.partially_delivered` | — |
| T6 | pre-shipment or `SHIPPED` | `CANCELLED` | release | — | if `PAID`: refund is owed (see notify) | — | `order.cancelled` | customer SMS; admin alert *cancelled but paid* when `PAID`; courier-loss ledger row when a consignment was booked |
| T7 | `DELIVERED` or `PARTIALLY_DELIVERED` | `RETURNED` | return | — | if `PAID`: refund is owed (see notify) | request (if any) approved in the same transaction | `order.returned` | admin alert *returned — refund may be owed* when `PAID` |
| T8 | `DELIVERED`, `PARTIALLY_DELIVERED`, `CANCELLED`, `RETURNED` | `REFUNDED` | — (never; stock is decided by T6/T7) | must already be `REFUNDED` | requires a completed `Refund` (recorded via *Record refund*) | — | `order.refunded` | — |
| T0 | any | same status | — | — | — | — | note only (if given) | — |

Everything else is **invalid**, including (non-exhaustive): `CANCELLED → CONFIRMED/SHIPPED/DELIVERED/…`,
`RETURNED → DELIVERED/CANCELLED`, `REFUNDED → *`, `DELIVERED → CANCELLED`, `DELIVERED → pre-shipment`,
`SHIPPED → PENDING/CONFIRMED/PROCESSING`, `PARTIALLY_DELIVERED → DELIVERED`, `* → REFUNDED` without a
recorded refund.

### Why these choices

- **Pre-shipment moves are free** (T1): all four statuses hold the reservation and nothing has left the
  building, so admins can correct a mis-click without stock consequences.
- **`REFUNDED` carries no stock effect** (T8). In the old code `REFUNDED` restocked if the previous status
  wasn't `CANCELLED`/`REFUNDED`, so `RETURNED → REFUNDED` restocked a second time. Refund is a *payment*
  fact: the money side lives in `Refund` rows and `paymentStatus`; the goods side is decided by T6/T7.
- **`RETURNED` restocks** (T7) whether it comes from an approved return request or the admin picker.
  Before, only the return-request path restocked, so the same status meant two different stock states.
- **COD becomes `PAID` on delivery** (T4, D1): the courier collects the cash at the door. Placing, confirming
  or shipping a COD order is *not* cash collection. This is what makes *Record refund* possible for a
  delivered COD order.

## 4. Order commands that are not status transitions

| Command | Allowed when | Stock | Other effects |
|---|---|---|---|
| Place order (`insertOrderRecord`) | — | sale (`ORDER`) per line; `allowOversell` only for an already-paid gateway settlement | coupon usage +1; initial `OrderStatusHistory` |
| Gateway payment settled (`syncOrderPaymentStatus`) | order exists | — | `paymentStatus → PAID`; status `PENDING → CONFIRMED` **only if** still `PENDING` (a paid-late cancelled order stays `CANCELLED` and surfaces as *cancelled but paid*) |
| Reconcile partial delivery | status `PARTIALLY_DELIVERED`, not yet reconciled | `RETURN` for the declared units (capped at what is still out) | courier-loss row; auto-approved return request record |
| Move to Trash (`deleteOrder`) | not already trashed | pre-shipment: release outstanding units (`CANCELLATION`, note "moved to trash"); other statuses: none (goods already left) | hidden from default lists |
| Restore from Trash | trashed | pre-shipment: re-reserve the units released at trash time (conditional; 409 if stock is no longer there) | — |
| Record refund (`refundOrderPayment`) | `paymentStatus = PAID`, or COD order that reached `DELIVERED`/`PARTIALLY_DELIVERED`/`RETURNED` | — | `Refund` row; `paymentStatus → REFUNDED` |
| Courier booked | not closed/fulfilled | — | `PENDING/CONFIRMED/PROCESSING → PACKED` via T1 |
| Courier status report | booked | — | maps `delivered/partial_delivered/cancelled` onto T4/T5/T6; a report that would be an invalid transition only updates `courierStatus` (no status change) |

## 5. Business decisions applied

- **D1 (revenue):** status alone never recognises revenue. COD order creation, confirmation and shipment
  are not revenue and not cash; `DELIVERED` is the recognition point for COD; returns and refunds are
  subtracted separately. The metric definitions live in [TARGET_ARCHITECTURE.md §11](TARGET_ARCHITECTURE.md);
  the state machine supplies the facts they need (`DELIVERED`, `returnedQuantity`, `Refund`, `paymentStatus`).
- **Coupon usage on cancellation (D7)** and **points reversal on return/refund (D8)** were approved on 2026-09-28
  ([BUSINESS_DECISIONS.md](BUSINESS_DECISIONS.md)) and are implemented in Phase 2 as effects of T6 (pre-shipment
  only) and T7/T8. Until then the Phase 1 behaviour stands: usage not released, points not reversed.

## 6. Tests

`apps/api/src/modules/orders/order-state-machine.integration.test.ts` and
`packages`-level unit tests in `apps/api/src/lib/order-state.test.ts` cover: every valid transition, a
sample of invalid ones (including `CANCELLED → CONFIRMED`), repeated transitions, concurrent
cancellations, stock side effects of T6/T7/T8, the COD payment effect of T4, the refund guard of T8, the
return-request interaction, and the late-payment-on-cancelled-order case.
