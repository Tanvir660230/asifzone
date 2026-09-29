# Inventory Invariants

**Status:** Phase 1 specification. Implemented in `apps/api/src/modules/inventory/inventory.service.ts`,
the only application code allowed to change `ProductVariant.stock` or write `StockMovement` rows.

## 1. Model

- **`StockMovement`** is the authoritative, append-only history: every change to a variant's stock is a
  row with a signed `change`, a `reason`, and (when it concerns an order) the `orderId`.
- **`ProductVariant.stock`** is the transactional balance — a materialised projection of the ledger kept
  so checkout can reserve stock with one atomic conditional update. It is written in the same
  transaction as its movement row, never separately.
- **`OrderItem.restockedQuantity`** (Phase 1) records, per order line, how many units have been put back
  into stock by any path (cancellation, return, partial-delivery reconciliation, exchange, trash).
  It is what makes restocking idempotent. **`OrderItem.returnedQuantity`** counts the subset that came back
  from the customer (returns, partial delivery, exchange) — used for "units sold".

## 2. Movement reasons

| Reason | Meaning | Sign | Written by |
|---|---|---|---|
| `ORDER` | sale / reservation for an order (incl. exchange shipments, restore from trash) | − | `recordSale`, `reReserveOrderLines` |
| `CANCELLATION` *(new)* | units released by a cancelled or trashed order | + | `releaseOrderLines` |
| `RETURN` | units that came back from the customer | + | `releaseOrderLines` |
| `RESTOCK` | goods received; opening stock of a new variant | + | `adjustVariantStock`, `recordInitialStock` |
| `ADJUSTMENT` | manual correction (either sign); product-form stock edits; variant removed | ± | `adjustVariantStock`, `setVariantStockFromForm`, `zeroVariantStock` |
| `IMPORT` *(new)* | stock set by a CSV import (a declared count) | ± | `setVariantStockCount`, `recordInitialStock` |
| `DAMAGED` *(new)* | units written off as damaged | − | `adjustVariantStock` |
| `LOST` *(new)* | units written off as lost / shrinkage | − | `adjustVariantStock` |

Historical rows keep their original reason (older cancellations are `ADJUSTMENT` with an `orderId`).

## 3. Mutation rules

1. **Single writer.** Only `inventory.service.ts` updates `ProductVariant.stock` or writes `StockMovement`.
   An architecture test (`inventory-writer.guard.test.ts`) scans `apps/api/src` and fails if any other
   file contains a stock increment/decrement, a `stock` field in a variant update, or a `stockMovement`
   write.
2. **Relative, atomic updates only.** Stock changes are `increment`/`decrement` with a guard
   (`stock >= n` for decreases) — never `SET stock = <value computed in application code>`.
3. **No negative stock**, except a paid gateway settlement (`allowOversell`), which is recorded and raises
   an *oversold* admin alert.
4. **Every mutation writes exactly one movement per variant touched**, in the same transaction.
5. **Idempotent order effects.** Releasing or returning units for an order line never exceeds
   `quantity − restockedQuantity`; a second cancel/return/refund/trash of the same order puts nothing back.
6. **Forms cannot overwrite concurrent changes (compare-and-set).** The product editor sends each existing
   variant's desired `stock` together with `expectedStock` (the value it last saw). Under a row lock:
   - desired = expected → the admin didn't touch stock → **no change** (a stale form never restores an old number);
   - desired = current → already there → no change;
   - expected = current → apply `desired − current` as an `ADJUSTMENT`;
   - otherwise → **409** "stock changed since this form was loaded".
   A request without `expectedStock` may only send the current value (otherwise 409). *Example:* stock 10,
   an order takes 2 (stock 8), a form still showing 10 is saved unchanged → stock stays 8.
7. **Imports are declared counts.** A CSV import sets stock to the file's value under a row lock and records
   the difference as `IMPORT`; the import preview shows the change before commit.
8. **New variants** are created with stock 0 and receive their opening stock through `recordInitialStock`
   (`RESTOCK`, or `IMPORT` from a CSV).
9. **Back-in-stock** emails fire after any mutation that takes a variant from 0 to > 0 (manual adjust,
   cancellation, return, form edit), not only from the product form.

## 4. Invariants (tested)

| ID | Invariant | Scope |
|---|---|---|
| INV-1 | `ProductVariant.stock = Σ StockMovement.change` | every variant whose whole history is in the ledger (all variants created since the ledger was completed; older ones via the reconciliation report) |
| INV-2 | `0 ≤ restockedQuantity ≤ quantity` and `0 ≤ returnedQuantity ≤ quantity` for every order line | all orders |
| INV-3 | for an order line: `Σ movements(orderId, variantId) = −quantity + restockedQuantity` | orders placed since the ledger was completed |
| INV-4 | only `inventory.service.ts` mutates stock (the Phase 3 Storefront Read Model only *reads* stock to derive `availability`; a projection rebuild writes no stock and no movement — tested) | source code (architecture test) |
| INV-5 | `stock ≥ 0` unless an oversell movement exists for a paid settlement, or the product is untracked (`trackInventory = false`, D5 — its sales are still ledgered, unguarded) | all variants |
| INV-6 | cancelling, returning, refunding, trashing an order in any order and any number of times restocks each unit at most once | state machine + INV-3 |
| INV-7 | a stale form never changes stock it did not intend to change | product update |

The reconciliation test (`inventory.integration.test.ts`) runs a mixed sequence — opening stock, sale,
cancellation, return, exchange, partial delivery, manual restock, damage write-off, form edit (fresh and
stale), import, trash and restore — and asserts after each step that INV-1..INV-3 hold and the stock equals
*opening stock + Σ valid movements*.

## 5. Drift detection and repair

- `GET /api/inventory/reconciliation` lists variants where INV-1 fails (read-only, never auto-corrects).
- The Phase 1 migration backfills `restockedQuantity` from the ledger (positive order-linked movements, capped
  at the line quantity) and sets it to the full quantity for orders already `CANCELLED`/`REFUNDED` (the old
  code restocked those), so pre-Phase-1 orders are protected from a second restock.
- Repairs are explicit admin adjustments with a reason — never silent updates.
