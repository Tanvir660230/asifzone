# Financial Core — Phase 4: Purchasing, Suppliers / AP & Inventory Costing

Status: **4A (foundations) implemented, not committed.** It sits on Phase 3 (`31c6ae7`). Sub-phases 4B–4H follow the
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
| 4A Foundations | schema, accounts and mappings, permissions, suppliers, tax codes, valuation ledger, costing engine (not wired) | **implemented** |
| 4B Costing engine | cost determination at stock exit, wiring into `inventory.service`, valuation postings, activation flag, benchmark | next |
| 4C Valuation cutover | owner-approved cutover batch, deletion guard, switch-on | — |
| 4D Purchasing | purchase orders, goods receipts (including approved no-PO receipts), supplier returns | — |
| 4E Invoices / AP | supplier invoices and credit notes, 3-way / 2-way matching, GRNI → AP | — |
| 4F Supplier payments | Treasury movement kind, allocation, reconciliation | — |
| 4G Reports / reconciliation | purchasing, AP, valuation, costing reports and checks | — |
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
