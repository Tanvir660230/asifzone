# Financial Core — Phase 4C: Valuation Cutover

Status: **implemented and verified (2026-10-09); not run on live data.** Running it on a real installation is an owner
action (blueprint blocker B-1). It sits on 4B (`4b68828`) and follows locked decisions 3, 4 and 7 of
`FINANCE_PHASE_4.md` §2.

The cutover is the one-time step that makes inventory costing authoritative. Before it, costing is wired in but
dormant (4B). After it, every stock-tracked variant has a cost position, the inventory account equals the valuation,
and costing can't be switched off.

## 1. Lifecycle

`DRAFT → APPROVED → POSTED`. An APPROVED cutover can go back to DRAFT with a reason. POSTED is final. There is one
batch per business (`InventoryCutoverBatch`, unique `businessId`).

| Step | Who | What |
|---|---|---|
| Prepare / refresh | OWNER (`costing.adjust`) | One line per stock-tracked variant, with today's stock (information only) and a proposed, labelled cost. A refresh keeps entered costs, adds new variants and drops ones no longer tracked. |
| Set costs | OWNER | Per line: KNOWN (needs evidence), ESTIMATED (needs a cost) or MISSING (no cost, source NONE). |
| Opening-balance error | OWNER | Optional signed amount, with a reason. It is the part of the true-up that corrects a proven opening-count mistake and goes to 3900 instead of 5150. |
| Approve | OWNER | Needs the opening date set and the opening balances posted. Lines with no cost must be acknowledged (`acknowledgeMissing`). Lines are frozen and fingerprinted. |
| Post | OWNER | Atomic and idempotent. See §2. |

**Proposed costs, in order:**
1. The posted opening count's KNOWN unit cost → KNOWN, source `OPENING_COUNT`.
2. The catalog cost price (variant, else product) → ESTIMATED, source `CATALOG_VARIANT` / `CATALOG_PRODUCT`.
3. Otherwise → MISSING, source `NONE`.

The catalog price is never treated as a known cost.

## 2. Posting (one transaction, `inventory-cutover.service.ts → postCutover`)

1. Lock the batch. A POSTED batch returns as it is (`replayed: true`). Anything other than APPROVED → 409. The lines'
   fingerprint must equal the approved one, otherwise → 409 `CUTOVER_CHANGED_SINCE_APPROVAL`.
2. Lock **every stock-tracked variant** `FOR UPDATE`, in id order (the lock `inventory.service` takes), and read the
   stock under the lock.
3. A tracked variant created since the draft gets a line `ADDED_AT_POST` / MISSING. Every tracked variant therefore
   enters costing. A line whose product stopped being tracked is skipped.
4. **Valuation:** each variant gets one CUTOVER entry, through `costing.service.recordValuationsInTx` (the only
   valuation writer), for its stock **at post** × the approved unit cost:
   - MISSING lines → units held unvalued (never at zero);
   - negative stock → deficit.
   A variant that already has valuation history is refused (409 `COSTING_STATE_EXISTS`).
5. **Ledger true-up:** `adjustment = valuation + in-transit − inventory account` (§3). It is posted as one ADJUSTMENT
   journal, key `inventory-cutover:<batchId>`, dated today: Dr/Cr inventory against the opening-error share (3900) and
   the rest (5150). The opening-error share must have the adjustment's sign and be no larger than it, otherwise → 409
   `CUTOVER_OPENING_ERROR_EXCEEDS` and nothing is written. A zero adjustment posts no journal.
6. **Activation:** `activateInventoryCostingInTx` sets the activation time (one-way trigger).
7. The batch becomes POSTED with a frozen `summary`: ledger before, valuation, in-transit, adjustment split, counts,
   unvalued and deficit units, activation time.

While it posts, checkout on tracked variants waits on their locks. Run it off-peak.

## 3. The inventory ledger bridge (`inventoryLedgerBridge`) — one calculation, used by the post and by the check

Phase 3 takes cost out of the inventory account at recognition (COD: first delivery; online: first payment), at the
line's own unit cost. Units that have left stock for an order not yet recognised are therefore still in the account. So:

```
inventory account = Σ cost-state value + in-transit − inventory booked at approved estimates since activation
in-transit        = Σ over orders placed on/after the opening date of
                    (units out × line unit cost) − (KNOWN inventory credits Phase 3 posted with that order as party)
```

Damaged-return write-offs (`commerce.return.written_off`) are excluded from the credits: those units came back and left
again, so they were never units out to the order. Reversal journals count through the event of the journal they
reverse.

The check **`inventory.valuation_vs_ledger`** asserts the equation (NOT_APPLICABLE before activation).

**Limitation.** An order placed before the opening date but recognised after it is not in the bridge. The opening count
excludes its units while Phase 3 still credits them. If that happens, it shows up as a check difference.

## 4. Related changes

- **Race fix (`inventory.service.recordSale`):** the sale reads the costing switch before taking the stock lock. When
  that read said "off", it is read again after the decrement (under the lock). Otherwise a checkout that waited on the
  cutover's locks would write an unvalued exit for a variant that was just cut over. This costs one read per sale, and
  only while costing is off.
- **Locked decision 4, in full:**
  - A variant with order, stock-movement or valuation history is never hard-deleted. Removing it from a product zeroes
    its stock instead (`variantsWithHistory`).
  - A product with such a variant can't be permanently deleted (409); it stays archived in Trash.
  - A posted cutover line also protects its variant: the FK cascades only while the batch is a draft, and the line guard
    refuses the delete once posted.
- `JournalEntryKind += ADJUSTMENT`.

## 5. Database (migration `20261016100000_finance_phase4c_cutover`)

| Invariant | Rule |
|---|---|
| C-1 | Status transitions DRAFT→APPROVED, APPROVED→DRAFT, APPROVED→POSTED only. POSTED is immutable. Only a DRAFT batch can be deleted. |
| C-2 | Lines change only in DRAFT. While APPROVED, three changes are allowed: writing the posted columns, inserting `ADDED_AT_POST` / MISSING lines, and the cascade from deleting a variant with no history. POSTED lines never change. |
| C-3 | MISSING ⇔ no unit cost. Costs are ≥ 0. An opening-error amount needs a reason. Posted columns are set together. |
| C-4 | An audit entry is required at commit for every batch change (F-6). No TRUNCATE (F-10). |

## 6. API (`/api/v1/finance/inventory-cutover`)

| Route | Permission |
|---|---|
| `GET /`, `GET /lines` | `costing.read` |
| `POST /` (prepare / refresh), `PATCH /` (settings), `PATCH /lines`, `POST /approve`, `POST /reopen`, `POST /post` | `costing.adjust` |

All are OWNER-only (authorization matrix: 426 routes). UI: Finance → Valuation cutover
(`apps/web/app/admin/(shell)/finance/inventory-cutover/page.tsx`).

## 7. Verification

- `finance-cutover.integration.test.ts` (10 tests, real database):
  - proposals and validation; refresh keeps costs;
  - an opening error that is too large is refused at post, leaving nothing behind;
  - approval freezes the lines (service and trigger);
  - concurrent posts produce exactly one post and one replay;
  - entries use the stock at post (a movement after approval is included);
  - an ADDED_AT_POST variant; untracked variants are excluded;
  - the journal split (5150 / 3900);
  - all costing checks MATCHED;
  - post-cutover sales cost at the average;
  - cancelling an in-transit order moves 240 from in-transit to valuation, and the check still MATCHES;
  - immutability, and the deletion protection of a cut-over variant.
- Updated: authorization matrix (+8 routes), Phase 1 reconciliation count (+1 check), historical snapshots and product
  duplicate tests (purge now refused for products with history).
- Browser QA on a fresh `finance_qa` (desktop 1440 and 375 px):
  - prepare → set a KNOWN cost → approve → typed-confirm post;
  - true-up ৳700 = 35 × ৳20, as expected;
  - all five inventory/ledger checks "matches" in Finance → Checks.
