# Warehouse Operations

How an order's physical journey is shown, picked, printed and checked. Read with `docs/ORDER_OPERATIONS.md` (queues,
scanning, confirmation calls) and `docs/ORDER_STATE_MACHINE.md` (statuses and their effects).

Branch `feat/warehouse-ops` (2026-10-31) also carries the unified scanner (receive without a return request, item-level
inspection, courier money, receipt corrections — `docs/ORDER_OPERATIONS.md` "Receive and inspect"), merged in from
`feat/unified-scanner` (§7).

## 1. What was already right, and what was missing

Kept as they are (verified in code and tests, 2026-10-31):

- One state machine (`packages/shared/src/order-state.ts`); SHIPPED moves no stock; cancellation after shipping restocks
  only on physical receipt; returns restock only on receipt + inspection (owner decision M2).
- Booking and handover are already separate facts: `courierBookedAt` vs `handedOverAt` (dispatch scan), plus
  `receivedBackAt` and `returnInspectedAt`. `shippedSmsTrigger` (BOOKING | HANDOVER) decides when the "shipped" SMS goes.
- Steadfast: every status is stored raw; only `delivered`, `partial_delivered` and `cancelled` move the order; a late word
  never reopens a finished order; webhook + poll are deduplicated; `CourierStatusChange` logs every change.
- "Courier issues" already includes `hold`, `unknown` and every `*_approval_pending` (live audit item 5 is fixed on main).

Missing, and built on this branch:

| Gap | Built |
| --- | --- |
| Staff read SHIPPED as "left the building" | `describeParcel` — one stage per parcel from the physical facts (§2) |
| No age, priority or next action per courier state | Same function: `since`, `ageHours`, `overdue`, `priority`, `nextAction` |
| Conflicts (booked-but-PACKED, Delivered vs courier partial…) visible only in SQL | Exception Center (§5) |
| Cancel after booking leaves the Steadfast booking live, silently | `cancelInCourierPanel` exception (Steadfast's API has no cancel — §6) |
| No product-wise picking | Pick list + packing sheets (§3) |
| No product labels | Product label page: Code128 + QR of the variant barcode, else SKU (§3) |
| Printing untracked; reprints invisible | `PrintRun` / `PrintRunItem`, append-only, reprint detection (§3) |
| 19 queues, no order of work | Today page: five stages + exceptions (§5) |

## 2. Parcel stage (`packages/shared/src/parcel-lifecycle.ts`)

The order status says what the business decided; the parcel stage says where the parcel physically is, as far as the
facts prove. Derived on read, never stored, never moves stock or money.

| Stage | Facts | Next action | Late after |
| --- | --- | --- | --- |
| NOT_BOOKED | open order, no consignment | — | — |
| BOOKED_WITH_US | consignment, no handover, courier `pending`/`in_review`/none | Hand to rider, scan out | 24 h |
| WITH_COURIER | handover recorded | — | stuckInTransitDays |
| ON_HOLD | `hold` | Call customer, update Steadfast | now (priority 3) |
| UNKNOWN | `unknown`, `unknown_approval_pending`, or a failing sync | Check Steadfast panel / support | 24 h |
| DELIVERY_CONFIRMING | `delivered_approval_pending`, `partial_delivered_approval_pending` | — (order stays open) | 72 h |
| CANCEL_CONFIRMING | `cancelled_approval_pending` | — | 72 h |
| PARTIAL_TO_RECONCILE | PARTIALLY_DELIVERED, not reconciled | Reconcile units | — |
| CANCEL_IN_COURIER_PANEL | CANCELLED, booked, no handover/receipt, courier still `pending`/`in_review` | Cancel in Steadfast panel, or receive when back | now |
| RETURNING | units owed back, not received | Scan in on arrival | returnNotBackDays |
| RETURN_TO_INSPECT | received, not inspected | Inspect each item | 48 h |
| DELIVERED / CLOSED | finished | conflicts only | — |

What Steadfast can't tell us, so the stage never claims it: `pending` is both "waiting for rider" and "rider has it" (no
pickup status exists); `cancelled` is both "cancelled before pickup" and "failed, coming back"; `*_approval_pending` is the
rider's word. Only our own handover scan proves the parcel left; only the return scan proves it is back.

## 3. Picking, packing, printing

- `POST /api/warehouse/pick-list {orderIds ≤ 300}` → lines grouped by variant (category → product → size S<M<L… → colour),
  each with the orders it serves; one packing sheet per order (customer, address, COD to collect from the payment ledger,
  courier note, label barcode, lines, print history). Orders not to be picked are returned as `skipped` with a reason:
  PENDING (not confirmed), already handed over, finished/cancelled, in Trash, not found. Read-only.
- `GET /api/warehouse/product-labels?search|variantIds` → variants with `code` = barcode, else SKU (0 of 146 live variants
  have a barcode, so SKU is the working default). The label carries the same code as Code128 and QR, so the existing
  scanner resolves either.
- `POST /api/warehouse/print-runs` (orders.manage) records PICK_LIST, PACKING_SHEET, COURIER_LABEL, PRODUCT_LABEL or
  MANIFEST. Idempotent on `clientRunId` (unique index; a race or retry returns the first run). Reprint = this order/variant
  printed before in this kind, decided inside a serializable transaction. A courier-label reprint needs a reason. Both
  tables are append-only (trigger). Printing changes nothing else.
- `GET /api/warehouse/print-runs?orderId|kind` — history.

UI: Orders → select → **Pick list** (`/admin/orders/pick-list`); **Product labels** (`/admin/orders/product-labels`, 50×30
or 38×25 mm stickers, one label per page); the courier-label page logs each print and asks why on a reprint. The packing
sheet's tick boxes are an on-screen aid only; packing verification by scan belongs to the scanner branch.

## 4. Data changes

Migration `20261208100000_warehouse_print_runs` — additive: tables `PrintRun`, `PrintRunItem`, CHECK constraints, an
append-only trigger. No existing row changes. Rollback = drop both tables and the function (nothing references them).

## 5. Today's Operations and the Exception Center

`/admin/orders/today`. Five stages with the existing queue counts (`/api/orders/stats`) — Confirm, Prepare & book, Hand over,
Out for delivery, Returns — and an Exception Center from `GET /api/orders/exceptions`. Each exception is one server predicate;
the orders list filters `?exception=<id>` by exactly the ids the count counted (cap 2,000).

| Exception | Predicate |
| --- | --- |
| handoverOverdue | booked 24 h–7 d ago, open, no handover/receipt, courier `pending`/`in_review`/none |
| courierOnHold | open, booked, `hold` |
| courierUnknown | open, booked, `unknown` / `unknown_approval_pending` |
| deliveryConfirmOverdue | open, rider-reported delivery older than 72 h (age from `CourierStatusChange`, else booking) |
| courierSyncFailing | open, booked, `courierSyncError` set |
| cancelInCourierPanel | CANCELLED, booked, no handover/receipt, courier `pending`/`in_review`/none |
| inspectionOverdue | received > 48 h ago, not inspected |
| bookedButPacked | booked, status still pre-shipment |
| deliveredButCourierPartial / …Cancelled / WithoutCourierStatus | DELIVERED, booked, courier `partial_delivered` / `cancelled` / none |

The stages show the time-based courier exceptions; the Exception Center itself lists only `cancelInCourierPanel`, `inspectionOverdue`, the three Delivered conflicts and `bookedButPacked` (§11). `partialToReconcile` counts PARTIALLY_DELIVERED orders not yet reconciled.

Thresholds are code defaults (`DEFAULT_PARCEL_TIMING`); stuck/return-overdue keep using the StoreSetting values.

## 6. Decisions and why

- **No new order status.** Adding HANDED_OVER or splitting SHIPPED would ripple through the courier sync, cancellation rules,
  finance and both stores' history. The physical facts already exist; the gap was presentation and exceptions.
- **No automatic Steadfast cancel.** The code's Steadfast client and the public endpoint list (create, bulk, status, payments,
  return requests, balance, fraud check) have no cancel call. The exception tells staff to cancel in the panel.
- **No automatic correction of historical conflicts.** Exceptions list them with what to check; a person corrects through
  the existing commands (reconcile, receive, status change).
- **Print before log.** A failed log never blocks paper; the failure is shown.

## 7. The unified scanner (merged)

Built in `feat/unified-scanner`, merged here: scan-code resolution (Steadfast return slip and QR = tracking link, our label,
order number, a product or phone listing every matching parcel, codes linked by hand), receive-without-request in one
confirmation, item-level inspection (good / damaged / missing / wrong / other), courier money as order money for what was
kept and a return charge for the rest (never sales by default), corrections by compensating entries. Migration
`20261207100000_parcel_receipts` runs before `20261208100000_warehouse_print_runs`; both are additive. Not built: packing
verification by scan (the packing sheet's ticks are on-screen only).

## 8. Historical reconciliation (no production data changed)

Each historical group from the 2026-10-31 live audit is now an exception list, so the owner works through them in the UI:

| Audit group | Exception | Safe correction |
| --- | --- | --- |
| 9 booked but PACKED | bookedButPacked | Check Steadfast; move to SHIPPED (or the courier's final outcome) by hand |
| 3 Delivered vs courier partial | deliveredButCourierPartial | If units came back: record the item return; receive + inspect |
| 10 Delivered without courier status | deliveredWithoutCourierStatus (booked ones only) | Sync; unbooked = hand delivery, not an exception |
| 24 unknown | courierUnknown (open orders) | Look up in Steadfast; finished orders keep their outcome |
| 163 cancelled after booking | cancelInCourierPanel (where Steadfast still says pending) | Cancel in panel or receive the parcel |
| 54 partial deliveries | needsAction / PARTIAL_TO_RECONCILE | Reconcile per order (existing command) |

Read-only SQL for the owner (prod, read-only role):

```sql
SELECT 'bookedButPacked' k, count(*) FROM "Order" WHERE "deletedAt" IS NULL AND "courierConsignmentId" IS NOT NULL AND status IN ('PENDING','CONFIRMED','PROCESSING','PACKED')
UNION ALL SELECT 'deliveredButCourierPartial', count(*) FROM "Order" WHERE "deletedAt" IS NULL AND "courierConsignmentId" IS NOT NULL AND status='DELIVERED' AND "courierStatus"='partial_delivered'
UNION ALL SELECT 'cancelInCourierPanel', count(*) FROM "Order" WHERE "deletedAt" IS NULL AND "courierConsignmentId" IS NOT NULL AND status='CANCELLED' AND "handedOverAt" IS NULL AND "receivedBackAt" IS NULL AND ("courierStatus" IS NULL OR "courierStatus" IN ('pending','in_review'));
```

## 9. Owner decisions still open

1. `shippedSmsTrigger`: switch to HANDOVER (the "shipped" SMS at the dispatch scan) once staff scan every parcel out.
   Today's default BOOKING sends it before the parcel leaves.
2. Handover-late threshold (24 h) and inspection-late threshold (48 h) — code defaults; move to Settings if they differ by store.
3. Whether to print our own barcode onto variants (fill `ProductVariant.barcode`) or keep SKU as the scanned code.

## 10. Failure scenarios covered here

| # | Scenario | Behaviour | Test |
| --- | --- | --- | --- |
| 1 | Booked, not dispatched | BOOKED_WITH_US; handoverOverdue after 24 h | order-exceptions.integration |
| 2 | Printed, not packed | Print recorded; status unchanged; sheet shows print count | warehouse.integration |
| 6 | `pending` without pickup | Never treated as handed over | order-exceptions.integration |
| 7 | Unknown status | courierUnknown, priority 2 → 3 after 24 h | order-exceptions.integration |
| 8 | Courier hold | courierOnHold, priority 3 | order-exceptions.integration |
| 9 | Delivery confirmation too long | deliveryConfirmOverdue from the status log | order-exceptions.integration |
| 10 | Cancel before pickup, still booked | cancelInCourierPanel | order-exceptions.integration |
| 16 | One SKU in many orders | Pick list lists every order per line | warehouse.integration |
| 23 | Out-of-order events | Unchanged (state machine; existing tests) | courier tests on main |
| 31 | Wrong product-wise picking | Pick list per order + sheet per order to check against | warehouse.integration |
| — | Duplicate / concurrent print | One run per clientRunId | warehouse.integration |
| — | Reprint of a courier label | Needs a reason; recorded | warehouse.integration |
| — | Editing print history | Refused by trigger | warehouse.integration |

Scanning, receipt, inspection and COD scenarios (3–5, 12–14, 17–22, 25–26, 28, 30, 32–33) are covered by `parcel-receive.integration.test.ts` and `parcel-scan.integration.test.ts` (§7).

## 11. Real-life walkthrough on the demo data (2026-10-31)

A day's work done on a copy of the 2026-10-20 demo mirror (1,094 orders, 872 bookings; dates moved to today), desktop and
phone. What got in the way, and what changed:

| Found | Changed |
| --- | --- |
| A pending order's main button (and the phone list's Confirm) confirmed without the call, so the call panel went unused | Main button is **Call & confirm** and opens the call panel; the list's Confirm opens the order on it. Confirming without a call stays under Change status |
| Without scanning, "booked, not handed over" grew to 98 and meant nothing | **Rider took these** on the orders list: a dispatch batch from the selection, same checks and audit, marked "not scanned" (POST /api/parcel-scans/handover) |
| Today counted the same parcels twice (98 still with us + 101 booked-but-Packed) and put "Needs action" under Returns | Today is one list of five steps with one shortcut each (Call next, Open, Receive); zeros hidden; courier timing problems stay in their step; the Exception Center lists only facts that disagree |
| 42 partial deliveries had no count of their own | `partialToReconcile` in the Returns step |

Not changed (recommended next): the orders list renders ~500 buttons and links per page and three filter rows above it;
Home's "Needs your attention" mixes finance and site errors with order work — a staff account would land better on Today.

Second pass (doing the work, not just opening pages), 2026-10-31:

| Found | Fixed |
| --- | --- |
| **Bug (also on main):** the call panel treated every claim as a colleague's — after "Take next call" the operator's own outcome buttons were locked for 15 minutes | The panel compares the claim with the signed-in admin; the server already allowed the claimer |
| After each call the operator went back to the list for the next customer | **Next customer** button after a saved call: 3 calls = 7 taps, ~11 s on the demo |
| **Bug:** "Print both" recorded the pick list and packing sheets at once; the serializable check made one fail (409) and the pick list went unrecorded | The server retries a lost serialization race (up to 4 tries); the page sends the two one after the other |
| On a phone the scanned parcel opened below the fold | The parcel card scrolls into view after a scan |
| Partly delivered parcels (received on this page) weren't counted on Returns in; zero chips took space | "Partly delivered" chip; chips with nothing in them are hidden |

Checked end to end on the demo copy: a partial delivery received by phone moved PARTIALLY_DELIVERED → RETURNED, stock +1 once,
৳100 as a return charge (not sales), the ৳80 courier charge on the shipment, one ParcelReceipt; a second scan says it was
already received.
