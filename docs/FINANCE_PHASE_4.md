# Financial Core — Phase 4: Purchasing, Suppliers / AP & Inventory Costing

Status: **4A committed (`cf4a1b2`); 4B (costing integration) implemented and verified, not committed — costing stays OFF
until the 4C cutover.** It sits on Phase 3 (`31c6ae7`). Sub-phases 4B–4H follow the
approved sequence, and each one stops for review. The architecture is the approved proposal
(`FINANCE_PHASE_4_PROPOSAL.md`), with the owner's locked decisions recorded in §2.

Phase 4 builds one chain:

> Supplier → Purchase order → Goods receipt → inventory quantity **and** cost → Supplier invoice → GRNI → AP → Supplier
> payment → bank/cash → reconciliation → COGS

It converges with the existing chain (inventory → sale → revenue recognition → COGS → ledger). There is one inventory
truth (`StockMovement`, written only by `inventory.service.ts`), one costing engine (`costing.service.ts`), and one
posting engine (`journal.service.ts`).

## 1. Sub-phases

| Sub-phase | Contents | State |
|---|---|---|
| 4A Foundations | schema, accounts and mappings, permissions, suppliers, tax codes, valuation ledger, costing engine (not wired) | committed `cf4a1b2` |
| 4B Costing integration | cost determination at stock exit, wiring into `inventory.service`, valuation postings, activation flag, benchmark (§9) | committed `4b68828` |
| 4C Valuation cutover | owner-approved cutover batch, deletion guard, switch-on — see `FINANCE_PHASE_4C.md` | committed `29e6ad1` (not run on live data) |
| 4D Purchasing | purchase orders, goods receipts (including approved no-PO receipts), supplier returns — see `FINANCE_PHASE_4D.md` | **implemented** |
| 4E Invoices / AP | supplier invoices and credit notes, 3-way / 2-way matching, GRNI → AP — see `FINANCE_PHASE_4E.md` | **implemented** |
| 4F Supplier payments | Treasury movement kind, allocation, reconciliation — see `FINANCE_PHASE_4F.md` | **implemented** |
| 4G Reports / reconciliation | purchasing, AP, valuation, costing reports and checks — see `FINANCE_PHASE_4G.md` | **implemented** |
| 4H Foreign currency (optional) | document currency, rates, realised FX | — |

## 2. Locked owner decisions

1. **Suppliers:** suppliers and AP are installation-scoped. `Supplier.code` is permanent, so suppliers can be merged
   across installations later. No `brandId` is added where it isn't needed.
2. **Purchase orders:** a PO is the normal path. A receipt without a PO is an explicit, approved exception: reason,
   responsible user, approval, audit, supplier, quantities, actual cost and evidence (4D).
3. **Cutover:** a one-time, approved, immutable valuation cutover at a defined financial date. An unexplained difference
   goes to **5150**. **3900** is used only for a proven opening-balance error (4C).
4. **No hard-deleting history:** a product or variant with stock, valuation, purchase, cost or accounting history is
   never hard-deleted; it is archived instead (4A at the database level for valuation history, 4C in full).
5. **Manual restocking:** allowed, but it is identifiable (reason, user, evidence, audit, costing treatment) and reported.
   It never passes as a supplier purchase.
6. **Tracked stock only:** purchased goods must be stock-tracked. A receipt for an untracked product is rejected (4D).
7. **Cost at stock exit:** the cost is determined when stock leaves, recorded immutably with that stock movement, and
   used later by revenue recognition. It is never recalculated (4B, which starts with the interaction audit).
8. **One costing engine:** `costing.service.ts` is the only writer of valuation records (guard test).
9. **Weighted average:** per variant, accounting for discounts, freight, landed costs, recoverable and non-recoverable
   tax, returns, damage, adjustments, currency and rounding (§5).
10. **Negative inventory:** commerce behaviour is unchanged. The provisional cost is explicit, and the true cost comes
    from the next receipt through 5150, with no rewritten journal (§5.3).
11. **Late cost:** history is never rewritten. The units still held are revalued; the share already sold goes to 5150.
12. **Price differences:** there is no standard-cost variance system. A difference between invoice or receipt value and
    what was recognised goes to 5150 (via `cogs.purchase_price_differences`). A PO-versus-invoice difference is a
    matching issue.
13. **Purchase flow:** GRN posts Dr Inventory / Cr 2115 GRNI. The invoice moves GRNI to AP, with 3-way matching for stock
    and 2-way for expense lines. Payments go through Treasury.
14. **Supplier payables:** derived from journal lines with the supplier as party. No mutable balance.
15. **Supplier payments:** Phase 2 Treasury, with the minimum new movement kind.
16. **Supplier returns:** go out at the recorded cost.
17. **Tax:** configurable tax codes, with no hard-coded country rules.
18. **Currency:** the books stay in the base currency. Document currency comes last (4H).
19. **Mappings:** every account is reached through a mapping key (§3).
20. **Events:** the stock movement is the authoritative fact. Notification and ad events are never treated as
    accounting events.
21. **Purchase stock reasons:** `PURCHASE_RECEIPT` and `PURCHASE_RETURN`, owned by `inventory.service`.
22. **Multi-brand:** installations stay separate and databases are not merged (§6).

## 3. Accounts and mappings (4A)

New template accounts and mapping keys. Existing businesses get them from `POST /api/v1/purchasing/setup`
(`purchasing-setup.service.ts`, which shares `chart-provisioning.ts` with the Phase 3 set-up). Set-up is idempotent and
audited, and never overrides an owner's change.

| Key | Default account |
|---|---|
| `asset.inventory` | 1610 Merchandise inventory (existing) |
| `liability.payable_trade` | 2110 Trade payables (existing) |
| `liability.grni` | **2115 Goods received not invoiced** |
| `liability.supplier_returns` | 2115 (alias — returned, not yet credited) |
| `asset.vat_input` | 1710 VAT input recoverable (existing account, new key) |
| `cogs.cost_adjustments` | **5150 Inventory cost adjustments** |
| `cogs.purchase_price_differences` | 5150 (alias) |
| `cogs.count_adjustments` | **5210 Inventory count adjustments** |
| `cogs.inventory_shrinkage` | 5200 (existing) |
| `expense.freight_in` | **6650 Freight-in & purchase charges** |
| `expense.non_recoverable_tax` | **6960 Non-recoverable purchase tax** |
| `expense.purchases_other` | 6900 Other operating expenses (existing account, new key) |
| `income.purchase_discounts` | **7200 Purchase discounts received** |

**Aliases:** a template account may carry extra keys (`aliases`). Each key is its own mapping row and can be re-mapped
on its own.

## 4. Permissions (4A)

| Permission | OWNER | STAFF | FINANCE_ADMIN | ACCOUNTANT | FINANCE_VIEWER |
|---|---|---|---|---|---|
| `suppliers.read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `suppliers.manage` | ✓ | ✓ | ✓ | ✓ | |
| `purchasing.read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `purchasing.manage` | ✓ | ✓ | ✓ | | |
| `purchasing.receive` | ✓ | ✓ | | | |
| `purchasing.approve` | ✓ | | ✓ | | |
| `ap.read` | ✓ | | ✓ | ✓ | ✓ |
| `ap.manage` | ✓ | | ✓ | ✓ | |
| `costing.read` | ✓ | | ✓ | ✓ | ✓ |
| `costing.adjust` | ✓ | | | | |

Purchasing configuration (set-up, tax codes) uses the existing `finance.configure`, which is OWNER-only. Every check is
enforced on the server (`requirePermission`).

## 5. The costing engine (`costing.service.ts`)

### 5.1 Method

The method is a perpetual moving weighted average per variant. Integer arithmetic only:

- values are BigInt minor units;
- the average is a scaled integer (major units × 10⁶, stored `Decimal(18,6)`);
- every division rounds half-to-even.

A variant's position has three parts:

- `valuedQty` units worth `value`;
- `unvaluedQty` units held with no known cost. These are never valued at zero (PHASE_6_AUDIT).
- `deficitQty` units issued beyond stock (negative inventory), each with the provisional cost it was issued at
  (`deficitLayers`, FIFO).

Physical units = valuedQty + unvaluedQty − deficitQty.

### 5.2 Operations

| Operation | Effect |
|---|---|
| INFLOW (receipt, customer return at the line's cost, count gain) | Covers any deficit first (FIFO). The remainder adds value; the average is recomputed. With no known cost, the units go to `unvaluedQty`. |
| OUTFLOW — SNAPSHOT basis (order lines) | Valued units leave at the line's own unit cost. The last valued unit takes all remaining value (no residue). A stale snapshot larger than the value held falls back to the average. Then unvalued units leave, then deficit units are issued at the snapshot as their provisional cost. |
| OUTFLOW — AVERAGE basis (write-off, supplier return) | Proportional share `round(value × n / qty)`. |
| REVALUE (late price difference, landed cost) | The share still held revalues the stock; it is capped so stock value never goes negative. |
| CUTOVER | Sets the variant's first position, once. |

### 5.3 The one adjustment rule

Every entry records `valueChange` (the valuation's move) and `bookValue` (what the ledger's 1610 moves for the same
fact). Order-linked units are booked by Phase 3 at the line snapshot; other movements by their Phase 4 document.
`costAdjustment = valueChange − bookValue` is posted against 5150, so **the ledger always equals the valuation.**

| Case | What happens |
|---|---|
| Sale beyond stock | The provisional cost is credited to 5150 at issue. |
| Covering receipt | The covered units' true cost is debited to 5150. |
| Net effect in 5150 | Exactly (true − provisional) × units sold short. |
| Rounding at zero quantity | An explicit 5150 entry. |
| Late price difference or landed cost | Only the sold share reaches 5150. |
| Old journals | Never rewritten. |

### 5.4 Persistence and invariants

`recordValuationInTx` locks the variant's row (the lock `inventory.service`'s stock update takes), writes one
`InventoryValuationEntry`, and moves `InventoryCostState`.

Database (migration `20261014100000_finance_phase4a_foundations`):

- **Entries are append-only.**
- **Continuity:** each entry must continue exactly from the variant's current state, and a cutover can only be a
  variant's first entry.
- **Cost state:** must equal the variant's latest entry; it can't be deleted.
- **CHECKs:** the adjustment rule; kind/quantity consistency; non-negative positions; value is 0 when valued quantity
  is 0.
- **Restrict foreign keys** to `ProductVariant` and `StockMovement`: a variant or movement with valuation history
  can't be hard-deleted.
- **No TRUNCATE.**
- **Audit:** valuation rows are not audited row by row. Each is tied 1:1 to its audited movement or source document,
  and append-only.

**4A is inert:** nothing calls the engine from `inventory.service` yet (a test pins this). Checkout, inventory and
Phase 3 behave exactly as before.

## 6. Suppliers and tax codes

**`Supplier`** (business = installation level, no `brandId`):

- **Code:** permanent (`SUP-0001` automatic, or given). A database trigger keeps it unchanged.
- **Fields:** legal and display name, contact, structured address, tax and VAT ids, currency, payment terms, credit limit
  (a warning only), default tax code, default expense account (must be an active EXPENSE or COGS posting account), notes,
  evidence references.
- **Status:** ACTIVE / ON_HOLD / INACTIVE. Holding or deactivating needs a reason.
- **History:** never deleted (trigger). Every change is audited (F-6 trigger).
- **Balance:** none stored (guard test). The balance is the AP ledger by party (4E).
- **Currency:** must equal the base currency until 4H.

**`TaxCode`:**

- **Fields:** code, name, rate %, recoverable %, and the mapping keys for the recoverable part (default
  `asset.vat_input`, must be an ASSET account) and the non-recoverable part (default `expense.non_recoverable_tax`, must
  be an EXPENSE account).
- **Permanent:** rate, share and keys never change (trigger). A new rate is a new code; old codes are deactivated.
- **Precision:** rates are validated and stored as decimal strings, never floats.

**Ownership boundary:** suppliers, tax codes and settings are business (installation) level. POs, GRNs, returns and the
valuation ledger (`brandId` on entries) are brand / installation level. Invoices, allocations and payments are
transaction level, with the brand on each journal line.

## 7. API (`/api/v1/purchasing`, 4A)

| Route | Permission |
|---|---|
| `GET /status` | `purchasing.read` |
| `POST /setup` | `finance.configure` |
| `GET /suppliers`, `GET /suppliers/:id` | `suppliers.read` |
| `POST /suppliers`, `PATCH /suppliers/:id`, `POST /suppliers/:id/status` | `suppliers.manage` |
| `GET /tax-codes` | `purchasing.read` |
| `POST /tax-codes`, `PATCH /tax-codes/:id` | `finance.configure` |

Request schemas: `packages/shared/src/schemas/finance-purchasing.ts`. UI: Finance → Suppliers, Finance → Purchase tax
codes.

## 8. Tests (4A)

- **`costing.test.ts`** — the method, figure by figure, all hand-computed:
  - first and second receipts, sale between receipts, rounding at zero, average-basis outflow, stale snapshot, customer
    return;
  - deficit cover (with and without provisional cost, FIFO across layers), unvalued units, revaluation (held / sold
    share, cap), cutover;
  - the adjustment rule over a mixed sequence; malformed input.
- **`finance-purchasing.integration.test.ts`:**
  - template mappings; provisioning an older business once;
  - suppliers (code, audit, hold reason, triggers); tax codes (permanence, validation);
  - roles; valuation persistence in decimals; append-only and continuity triggers; concurrency (8 parallel entries on
    one variant); deletion protection;
  - 4A is inert.
- **Guards:** the Phase 4 tables are written only in the finance domain; only `costing.service.ts` writes the valuation
  ledger; no supplier balance column.
- **Authorization matrix:** 418 routes, with OWNER-only purchasing configuration.

## 9. Costing integration (4B)

### 9.1 Responsibilities

| Truth | Owner |
|---|---|
| Physical quantity | `inventory.service.ts` — the only writer of `ProductVariant.stock` and `StockMovement` |
| Cost / valuation | `costing.service.ts` — the only code that computes cost (`applyCostOperation`) and the only caller of the persistence function |
| Accounting | the Phase 1 engine — postings arrive as `inventory.valued` financial events |

### 9.2 Activation

Costing is **off until the 4C valuation cutover**. `FinanceBusiness.inventoryCostingActivatedAt` is null, and a database
trigger makes it a one-way switch once set. 4C's approved cutover is the only production caller of
`activateInventoryCostingInTx`; 4B uses it only in tests. The value is shown read-only in `GET /api/v1/finance/business`.

While costing is off, behaviour is exactly as before 4B:
- order lines take the catalog cost;
- no valuation entry is written;
- Phase 3 posts and raises exceptions as before;
- the three new checks report NOT_APPLICABLE.

**Scope rule** (one function, `inScope`). A variant is costed when costing is active, its product is stock-tracked, and
it either has a cost position (cut over, or costed since) or was created after activation.

### 9.3 Cost determined at the stock exit

Every path that creates order lines goes through the same steps:
- checkout, including admin and online orders and the paid oversell settlement;
- order modification;
- exchange replacement.

1. Write the order lines as before, with the catalog cost labelled `CATALOG` (or `NONE` when there is none).
2. `recordSale` decrements stock. This takes the variant row lock — the same lock as before 4B; there is no earlier lock.
3. While holding that lock, one statement writes the `ORDER` movements and returns each variant's costing facts. Its
   snapshot is taken after the lock, and every writer of a position needs that lock, so the position is current.
4. `exitCost` reads the average and labels the cost:
   - `INVENTORY` when valued stock covers the units;
   - `INVENTORY_PROVISIONAL` when some units leave beyond valued stock;
   - `NONE` when no cost was ever known — never zero, never the catalog.
5. One call to `finance_persist_valuations` writes the valuation entry, the position, and the exit's cost, source and
   link (`costMovementId`) onto exactly the order lines created for that exit.

**Guarantees:**
- A costed exit without its lines is refused (`COSTING_EXIT_UNLINKED`), so no transaction can commit a costed exit whose
  lines don't carry its cost.
- A database trigger refuses any line whose cost differs from its exit's valuation entry, and freezes linked lines.
- `OrderItem.unitCostSnapshot` = the valuation's `unitCostMinor` = the dashboard's COGS = Phase 3's COGS.

**Untracked products** (`trackInventory = false`) are never costed: they keep the catalog cost, labelled `CATALOG`, with
no valuation and no negative inventory.

### 9.4 Every other movement

| Movement | Valued at | Ledger |
|---|---|---|
| Cancellation, return, partial-delivery release (`releaseOrderLines`) | the line's own snapshot — never today's average | Phase 3 (at snapshot), plus any 5150 adjustment |
| Units released by a modification | each source line's snapshot (lines of one variant may differ) | as above |
| Damaged return (`writeOffReturnedUnits`) | the returned line's snapshot | Phase 3 write-off, plus any adjustment |
| Restore from trash (`reReserveOrderLines`) | the line's snapshot — a compensating entry for the trash release | Phase 3 |
| Manual decrease, damaged / lost, form edit, CSV count down, variant zeroed | the running average | `inventory.valued`: shrinkage (damaged / lost) or 5210 count adjustments |
| Manual increase, count gain, opening stock of a new variant | the average, labelled ESTIMATED; held **unvalued** (MISSING) when no average ever existed | `inventory.valued` (5210); nothing when unvalued |

Phase 3's stock scan skips movements the costing engine valued. Only unvalued ones still raise
`UNVALUED_STOCK_RECEIPT` / `UNVALUED_STOCK_WRITE_OFF`.

### 9.5 Where the costing rules live — and why the database function is not a second engine

- **The rules live only in `applyCostOperation`** (plus `exitCost`, which reads the average it keeps). That covers the
  moving average, deficit cover, provisional cost, rounding at zero, revaluation and the adjustment rule.
- **`finance_persist_valuations` is a persistence path.** It receives figures already computed, makes no decision and
  does no arithmetic. It writes them in order in one round trip, so the stock lock is held briefly. The existing guard
  triggers (continuity, position = latest entry, line cost = exit valuation) run on every row it writes.
- **Guard tests enforce this:**
  - no application code writes the valuation tables directly;
  - only `costing.service.ts` calls the function;
  - no file except `costing.service.ts` uses `applyCostOperation` or sets an average.

### 9.6 Postings

One `inventory.valued` event per valuation entry that moves the ledger (`inventory-posting-rules.ts`, mapping keys only):
- the movement's own value when nothing else books it (manual and count movements);
- the cost adjustment (valuation change − ledger change) against 5150.

Order-linked units are booked by Phase 3 at the line snapshot, so Phase 3's rules are unchanged.

New reconciliation checks, each NOT_APPLICABLE while costing is off:

| Check | Verifies |
|---|---|
| `inventory.order_cost_links` | every inventory-costed line is linked to its exit at the same cost; it also counts lines by cost source |
| `inventory.quantity_vs_valuation` | stock = valued + unvalued − deficit, and every movement of a costed variant is valued |
| `inventory.valuation_postings` | each posting exists with the entry's amounts |

### 9.7 Performance (accepted)

`createOrder`, 150 orders per scenario, same database and method throughout (ms, median / p95 / p99):

| Scenario | 4A (costing off) | 4B, first wiring | 4B, lock fix | 4B, one-call persistence |
|---|---|---|---|---|
| Tracked, sequential | 18.5–21.2 / 22–24.5 / 25.5–28.5 | 31.8–32.3 / 37–38.5 / 44–49 | 24.4–26.2 / 27–30 / 31 | 18.8–24.5 / 21–30 / 22–57 |
| Tracked, 8 concurrent on one SKU | 36.5–38 / 75 / 94–105 | 69–76 / 341–511 / 1,842–1,968 | 63–67 / 207–211 / 244–261 | 40–54 / 108–131 / 148–194 |
| Untracked, sequential | 21 / 27.5–28 / 30.5 | 25.4–26.5 / 29–32 / 34–36 | 19.5–21.4 / 24–26 / 28 | 17.2–21.7 / 18.6–27.6 / 19.5–33.3 |

The remaining same-SKU tail comes from the costing writes and the safety triggers executing while orders for one SKU
queue on the existing stock lock. The owner accepted it. With costing off, the new code performs like 4A.

### 9.8 Pre-existing defect (not 4B) — fixed 2026-10-10

**Pre-existing commerce concurrency defect — separate follow-up required.**

When the **same customer**'s checkout races a store-credit item return, they deadlock. Reproduced on untouched
`cf4a1b2` without costing: 26 deadlocks in 40 operations. The likely cause is a lock-order inversion — checkout locks the
customer before the stock, the return locks the stock before the customer. Different customers don't reproduce it, with
costing off or on. It was not modified in 4B.

**Fixed (2026-10-10).** The Postgres deadlock log showed the real cycle. It was not a stock / customer order inversion
in commerce's own locks:

- **The item return** has restocked (it holds the variant row). It then reverses the order's reward points with
  `SELECT … FROM "Customer" … FOR UPDATE` (`reverseDeliveryPoints`).
- **The checkout** has inserted its order, whose customer foreign-key check holds KEY SHARE on that customer. It then
  waits for the variant row.
- **The conflict:** FOR UPDATE conflicts with KEY SHARE, so each waits on the other.

The store-credit balance lock had already moved to FOR NO KEY UPDATE for the same reason (ORDER_ADJUSTMENTS). The three
loyalty locks in `customer.service.ts` (award, reverse, manual adjust) now take FOR NO KEY UPDATE too. They only change
`rewardPoints`, a non-key column, and they still serialise every points and balance writer.

**Proof:** `modules/orders/same-customer-race.integration.test.ts` races 4 store-credit returns against 4 checkouts
of ONE customer, 5 rounds. Before the fix it deadlocked repeatedly (`40P01`, 24 in one run). After it, there were 0
across 4 runs, with stock exact. Full regression: 111 files, 1315 passed.

### 9.9 Tests (4B)

- **`finance-costing.integration.test.ts`** (21 tests, real commerce services, costing activated after a test cutover):
  - line = exit valuation = dashboard and Phase 3 COGS; the database refuses divergence;
  - uncosted or unlinked exits are refused; failures — including inside the one-call persistence and on a multi-SKU
    exit's second SKU — leave nothing behind;
  - concurrency: guarded concurrent checkouts, concurrent paid oversells (provisional and 5150), concurrent multi-SKU
    orders, returns racing orders;
  - untracked, not-cut-over and new variants; returns, damage and cancellation at the original cost; trash and restore;
    modification; exchange; manual adjustments;
  - full-cycle convergence (Δ inventory account = Σ valuation change); every new check MATCHED; one-way activation.
- **`costing.test.ts`:** the mixed inflow (valued + unvalued) case.
- **Guards:** the writer guard (function-only persistence), and the Phase 6 snapshot guard, which allows the costing
  service as the one other assigner of a costed line's cost.
- **Browser** (`e2e/admin-finance-costing.spec.ts`, costing off): checks NOT_APPLICABLE, cost-source labels, an
  inventory adjustment through the UI with no valuation and the Phase 3 exception unchanged, and activation still off.
