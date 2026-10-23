# Courier costs — shipment charges, rider contributions, returns and exchanges

Status: implemented 2026-10-21 on `feat/courier-costs` (built on `feat/owner-books`). Owner: Orders + Finance.

Every physical parcel leg has its own money record: what the courier **actually** charged for it, what the customer paid
the **rider** toward that charge, and what is left **uncovered** (or paid in **excess**). It is an operational and
reconciliation record. It posts nothing to the ledger and never touches the order's payments: a customer's contribution
to the rider is not revenue or cash received.

## 1. Audit (what existed, and what the courier API gives)

| Area | Finding |
|---|---|
| Courier | Steadfast only (`providers/courier/steadfast.ts`), one consignment per order on the `Order` row. Status by webhook (re-verified with `status_by_cid`), a 15-minute cron and a 2-minute auto-sync when an order is opened. |
| Statuses | Steadfast says `in_review / pending / hold / delivered / partial_delivered / cancelled` (+ `_approval_pending`). `partial_delivered` → order `PARTIALLY_DELIVERED`, reconciled item by item (`reconcilePartialDelivery`). `cancelled` covers both "voided before pickup" and "came back". |
| Exchanges | An approved exchange creates a separate replacement `Order` (`ReturnRequest.exchangeOrderId`), booked like any order. No record of the parcel coming back. |
| Existing cost data | `CourierLossEvent` — an estimate (Settings › courier return fee) logged on cancellation after booking and on partial returns. Owner's books: rate-card estimates booked per order, replaced by payout actuals in the ledger. |
| **Per-parcel API data** (checked live 2026-10-21, read only) | consignment id, tracking code/link, status, `cod_amount` as **booked**. **No charge, no weight, no zone, no amount collected.** |
| **Payout API** | `GET /payments`: per payout `amount` (cash collected), `due_bills` (delivery + return charges of its parcels), `charges` (COD charge), `total` (paid). `GET /payments/:id`: its parcels. Charges exist **only per payout**. |
| Return requests API | `GET /get_return_requests`: `{ id, consignment_id, status, reason, consignment }` (all `pending` so far). |
| Rider contributions | **Not available from any API.** Only staff can record them (from the rider, the customer or the merchant panel). |

## 2. Data model (migration `20261124100100_courier_costs`)

`Shipment` — one row per leg: `OUTBOUND` (the order's own parcel, including a refused one — the courier bills that trip on
its consignment), `RETURN` (the item coming back after delivery), `REPLACEMENT` (an exchange's new parcel). Linked to the
original order (`orderId`), the order the parcel was booked against (`parcelOrderId`) and the return / exchange request.

Charges are kept apart: `standardCharge` (rate card, else Settings › courier fee by inside / outside Dhaka),
`estimatedCharge` (for the outcome), `quotedCharge`, and `actualCharge` with `chargeStatus`
`MISSING → ENTERED → VERIFIED | COURIER_CONFIRMED` plus source and reference. Only VERIFIED / COURIER_CONFIRMED count.

Contributions: `contributionReported`, `contributionVerified`, `contributionStatus`
`NOT_RECORDED | REPORTED | VERIFIED | UNVERIFIED`, source and reference. Treatments: uncovered
`UNDECIDED | ABSORBED | RECEIVABLE | RECOVERED`; excess `UNDECIDED | REFUND_DUE | REFUNDED | KEPT_BY_COURIER | OTHER_INCOME |
ALLOCATED_WITHIN_EXCHANGE`. Courier facts from payouts: `courierPayoutRef`, `bookedCodAmount`, `courierCollected` (only when
the payout's totals pin it down).

`ShipmentCostEvent` — append-only history (DB trigger refuses updates): action, `{ field: { from, to } }`, reason, note,
source, reference, admin. `version` guards every save (stale → 409; an identical replay is a no-op).

Guards (raw partial unique indexes): one leg per (courier, consignment, type); one untracked delivery / replacement leg per
parcel order; one RETURN leg per request. CHECK constraints: money ≥ 0; a non-MISSING charge has an amount.

Backfill: one OUTBOUND / REPLACEMENT leg for every consignment already booked, charge `MISSING` — nothing assumed.

## 3. Calculation rules (`packages/shared/src/courier-costs.ts`, used by the API and the drawer's live preview)

- A contribution applies to RETURN and REPLACEMENT legs and to an OUTBOUND parcel that came back or was partly delivered —
  never to a normal delivery (the customer paid shipping inside the order).
- **Uncovered** = max(0, actual charge − verified contribution). **Excess** = max(0, verified contribution − actual charge).
- A reported or unverified contribution covers nothing. An entered (unverified) charge is provisional: shown grey, never a
  confirmed expense.
- An uncovered amount is not a receivable until someone records it as one (RECEIVABLE); ABSORBED = business-borne expense.
- Exchange summary: sums of the legs; excess marked "applied to the exchange" offsets the other legs' uncovered amount once;
  what is left of it is excess again.
- Money is integer minor units in the rules, Decimal(10,2) in the database, server-side only.

## 4. Statuses

Operational (`operationalStatus`): Booked, In transit, Delivered, Partly delivered, Return requested, Return in transit,
Returned, Cancelled — driven by the courier for tracked legs, by staff for the rest. Exchanges show In progress / Completed.

Financial (`financialStatus`, derived and stored): Not due yet, Awaiting actual charge, Awaiting contribution details,
Excess — review required, Not covered, Partially covered, Fully covered, Reconciled, Needs review. A parcel can be
Returned while its money record still awaits the charge or the contribution. The existing `PARTIALLY_DELIVERED` order
status and its item reconciliation are unchanged; the money side lives on the leg.

## 5. Courier evidence (`domain/shipments/courier-evidence.ts`)

"Check Steadfast payouts" / "Retrieve from Steadfast" record each parcel's payout, booked COD and (when determinable) the
cash collected, mark a `cancelled` parcel that was billed in a payout as RETURNED, and check charges:
- every parcel of the payout is a leg here and their charges (recorded, else the standard estimate) add up **exactly** to
  `due_bills` → each becomes COURIER_CONFIRMED;
- exactly one parcel lacks a charge and the others are confirmed → it is the remainder;
- all confirmed but the sum differs → every leg is flagged Needs review with both totals.
Nothing else is assumed. **On the real data (QA copy, 2026-10-21) all three payouts include parcels booked directly on
Steadfast's panel (11, 6, 18 — the "outside sales"), so no charge can be confirmed from them yet.**

## 6. Permissions and API

`courier_costs.read` (all roles incl. finance viewer), `courier_costs.record` (STAFF, owner, finance admin, accountant —
enter / report, add legs, refresh), `courier_costs.verify` (owner, finance admin, accountant — verify, decide treatments,
reconcile, reopen, clear review). Changing a verified / confirmed figure or a reconciled record needs a reason.

| Route | Permission |
|---|---|
| `GET /api/shipments/orders/:orderId` — legs, exchange summaries, history | read |
| `POST /api/shipments/orders/:orderId` — add a return / replacement leg (Idempotency-Key) | record |
| `PATCH /api/shipments/:id/costs` — save (with `version`) | record (+ verify per field) |
| `POST /api/shipments/:id/refresh`, `POST /api/shipments/payouts/sync` | record |
| `POST /api/shipments/:id/reconcile` · `/reopen` · `/clear-review` | verify |
| `GET /api/shipments/report` — totals, attention counts, filtered legs | read |

UI: order detail › **Courier costs** (legs, exchange summary, side drawer); Finance › Sales & payments › **Courier costs**.

## 7. Open questions for the owner

1. Contributions that Steadfast remitted in a payout (a refused parcel marked partial with the delivery fee collected) reach
   the books as COD collected by the owner's-books payout import. Should that part be booked as courier-cost recovery rather
   than order money? Today nothing changes in the ledger.
2. Standard rates: Settings has 60 / 120 by default (`courierReturnFee…`); the brief says 55 / 115. Set the rate card or
   Settings to the real tariff — it only affects the reference figures.
3. Should receivables from customers be collected through the existing payment / store-credit flows? Today RECEIVABLE /
   RECOVERED are recorded on the leg only.
