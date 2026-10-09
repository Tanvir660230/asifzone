# Master Blueprint — ERP, Manufacturing, Inventory Costing & Central Finance

> **This file is the persistent source of truth for the ERP / finance / manufacturing programme.** A new session starts
> here: read §0, verify the git state it records, then continue from §27 (next eligible task). Phase-level detail lives
> in the phase specs it links (`docs/FINANCE_PHASE_*.md`, `docs/MANUFACTURING.md`); this file holds the map, the
> decisions, the dependency order and the exact status.

Labels used throughout:

- **[VERIFIED]** — read in code and covered by a test run recorded here.
- **[EXISTS-UNVERIFIED]** — present in code, not re-verified in this programme.
- **[PROPOSED]** — target design, not built.
- **[DECIDED]** — a decision taken (by the owner, or under the owner's delegation recorded in §21), with rationale.
- **[BLOCKED]** — needs an owner decision or authorisation; see §21.
- **[DEFECT]** — known wrong behaviour.
- **[DEFERRED]** — consciously out of scope for now.

---

## 0. Session resume card

| Item | Value |
|---|---|
| Worktree | `C:/dev/asifzone-finance` (dedicated; never the shared main checkout `…/OneDrive/Documents/All Website/Asif Zone`) |
| Branch | `finance/phase-1-foundation` (based on `p1/foundations` @ `f879c16`) |
| HEAD at programme start | `4b68828` feat(finance): add phase 4b inventory costing integration |
| Remote | not pushed — **never push, never deploy** |
| Test DB | `clothing_brand_test` in container `asifzone-finance-pg` (:5437); Redis `asifzone-finance-redis` (:6383). Both have no restart policy: `docker start asifzone-finance-pg asifzone-finance-redis` |
| Dev DB | `finance_dev` (same container); QA DB `finance_qa` (browser QA) |
| Baseline | `pnpm --filter api test` → **103 files, 1238/1238 passed** (2026-10-09, 157 s) |
| Stashes | 3 pre-existing repo stashes (Aug/Sep, unrelated) — never touch |
| Current phase | see §23 |

Every session: (1) `git -C C:/dev/asifzone-finance status --short && git log --oneline -5`; (2) compare with §23/§24;
(3) start containers; (4) continue at §27.

---

## 1. Executive summary and business objectives

The platform runs two brands (Asif Zone, Nasihamart) as **separate installations** of one codebase, each with its own
commerce database. A Financial Core (double-entry ledger, events, treasury, commerce accounting, purchasing foundations,
weighted-average costing) lives inside each installation's API (`apps/api/src/domain/finance`).

Objectives of this programme:

1. Finish the inventory-costing roadmap (4C cutover) so inventory value, COGS and the ledger agree.
2. Purchasing and accounts payable on one supplier / inventory / AP / finance chain.
3. **First-class manufacturing**: commission products from internal or external producers (e.g. 1,000 caps), plan by
   size/colour, plan and issue materials, capture every production cost, receive and inspect deliveries, move accepted
   goods into stock at their true cost, and reconcile planned vs actual.
4. Complete the finance back-office: expenses, payroll, fixed assets, loans, partner capital, budgets, statements,
   tax configuration, alerts.
5. Never compromise the invariants already built: one quantity writer, one valuation writer, one posting engine,
   immutable posted journals, append-only valuation, brand separation.

---

## 2. Existing architecture — verified current state

**Monorepo:** pnpm + turbo. `apps/web` (Next.js 15, React 19, Tailwind 3), `apps/api` (Express, Prisma 5, Postgres,
Vitest), `packages/shared` (zod schemas, permissions, finance helpers), `packages/ui-tokens`.

**Installation model [VERIFIED]:** `config/installation.ts` gives each deployment an `installId`. A `FinanceBusiness`
(key `FINANCE_BUSINESS_KEY`) with one `FinanceBrand` per installation lives in that installation's database. Brands are
not merged; there is no `brandId` on commerce tables — the brand *is* the installation.

**Financial Core [VERIFIED by the 1238-test baseline]:**

| Layer | Owner (single writer) | Spec |
|---|---|---|
| Chart, mappings, periods, journals (post / reverse), audit, opening balances | `journal.service.ts`, `chart.service.ts`, `periods.service.ts`, `opening-balances.service.ts` | FINANCE_PHASE_1 |
| Financial event inbox → posting rules → journal, exactly-once via outbox | `events.service.ts`, `posting-rules.ts` | FINANCE_PHASE_1 §5 |
| Money accounts, treasury movements, statements, matching, bank reconciliation | `treasury.service.ts`, `bank*.service.ts` | FINANCE_PHASE_2 |
| Commerce accounting projector, settlements, finance exceptions, finance roles, checks | `commerce-accounting.service.ts`, `settlements.service.ts`, `reconciliation.service.ts` | FINANCE_PHASE_3 |
| Suppliers, tax codes, valuation ledger, costing engine | `suppliers.service.ts`, `tax-codes.service.ts`, `costing.service.ts` | FINANCE_PHASE_4 §1–§8 |
| Costing wired into every stock movement (dormant until activation) | `inventory.service.ts` → `costing.service.valueStockMovementsInTx` | FINANCE_PHASE_4 §9 |

**Physical inventory [VERIFIED]:** `ProductVariant.stock` + append-only `StockMovement`, written only by
`modules/inventory/inventory.service.ts` (guard test `inventory-writer.guard.test.ts`). Reasons: ORDER, RESTOCK,
ADJUSTMENT, RETURN, CANCELLATION, IMPORT, DAMAGED, LOST, PURCHASE_RECEIPT, PURCHASE_RETURN (the last two reserved, unused).
No location / warehouse concept.

**Costing [VERIFIED]:** perpetual moving weighted average per variant, BigInt minor units, half-even rounding, deficit
layers for negative stock, unvalued (MISSING) units never valued at zero, one adjustment rule
(`costAdjustment = valueChange − bookValue` → 5150). Persisted only through `finance_persist_valuations` (no arithmetic in
SQL). Activation flag `FinanceBusiness.inventoryCostingActivatedAt` is one-way (trigger) and **null** — costing is OFF.

**Admin UI [VERIFIED by file listing]:** Finance → Money accounts, Reconciliation, Sales accounting, Settlements, Finance
exceptions, Finance checks, Suppliers, Purchase tax codes. Navigation manifest `apps/web/lib/admin/navigation.ts`,
capabilities `apps/web/lib/admin/capabilities.ts`.

**Permissions [VERIFIED]:** `packages/shared/src/permissions.ts` — roles OWNER, STAFF, FINANCE_ADMIN, ACCOUNTANT,
FINANCE_VIEWER; server-side `requirePermission`.

---

## 3. Completed functionality and evidence

| Capability | Evidence |
|---|---|
| Phase 1 ledger, events, opening balances, reconciliation framework | commit `2a233db`; `finance.integration.test.ts`, `finance-engine.test.ts` |
| Phase 2 treasury, statement import, matching, bank reconciliation, UI | commit `ce4db08`; `finance-treasury.integration.test.ts`; e2e `admin-finance-treasury.spec.ts` |
| Phase 3 commerce accounting, settlements, exceptions, finance roles | commit `31c6ae7`; `finance-commerce.integration.test.ts`; e2e `admin-finance-commerce.spec.ts` |
| Phase 4A suppliers, tax codes, valuation ledger, engine | commit `cf4a1b2`; `costing.test.ts`, `finance-purchasing.integration.test.ts`; e2e `admin-finance-purchasing.spec.ts` |
| Phase 4B costing integration (dormant) | commit `4b68828`; `finance-costing.integration.test.ts` (21), e2e `admin-finance-costing.spec.ts` |
| Whole API regression | 1238/1238 on 2026-10-09 at `4b68828` |

---

## 4. Incomplete, duplicated, missing and defective functionality

| Item | State |
|---|---|
| Valuation cutover (4C): cutover batch, approval, activation, full deletion guard | **done** (E1, `FINANCE_PHASE_4C.md`) — not run on live data (B-1) |
| Purchase orders, goods receipts, supplier returns (4D) | **done** (E2, `FINANCE_PHASE_4D.md`) |
| Supplier invoices, matching, GRNI → AP (4E) | **missing** |
| Supplier payments & allocations (4F) | **missing** |
| Purchasing / AP / valuation reports (4G) | **missing** |
| Manufacturing (BOM, production orders, materials, costs, QC, FG receipt) | **M1–M5 done** (materials, BOMs, orders, custody & WIP, costs, deliveries / QC, close / final cost / late costs, overview — `MANUFACTURING.md`) |
| Raw-material inventory | **done** (M1: `Product.kind = MATERIAL`, stock units) |
| Ledger UI: chart, journals, trial balance, periods, opening balances | **missing** (API exists, Phase 1 §11 deferred the UI) |
| Financial statements (IS / BS / CF) | **missing** (trial balance API only) |
| Expenses & recurring commitments, payroll, fixed assets, loans, partner capital, budgets, tax engine | **missing** |
| Pre-existing same-customer deadlock (checkout vs store-credit return) | **[DEFECT]** documented in FINANCE_PHASE_4 §9.8, commerce follow-up, not in this programme's critical path |
| Branch divergence: `finance/phase-1-foundation` is based on `p1/foundations`; `main` / release branches carry other work (orders workspace, courier notes, admin-v2) | integration risk, see §21 R-1 |

No duplicated engines were found: one inventory writer, one costing engine, one posting engine.

---

## 5. Target architecture

```
                        ┌──────────────── one installation (brand) ────────────────┐
 Commerce (orders) ─┐   │                                                         │
 Purchasing (PO/GRN)┼──►│ inventory.service  ──►  costing.service  ──► FinancialEvent│──► posting rules ──► journal.service
 Manufacturing ─────┘   │ (quantity, sole)       (value, sole)        (inbox, exactly│     (mapping keys)     (sole writer,
                        │                                              once)        │                         immutable)
 Finance documents (invoices, payments, expenses, payroll, assets, loans) ───────────┼──► postJournalInTx directly
                        └─────────────────────────────────────────────────────────┘
 Reports / checks read authoritative tables only (ledger, valuation ledger, documents) — one service per shared metric.
```

Rules:

- **Stock-moving operational documents** (GRN, supplier return, material issue/return, production receipt, write-offs)
  move quantity through `inventory.service`, value through `costing.service`, and post through the event inbox in the
  same transaction (receiving is never blocked by a missing mapping — the event waits FAILED/retryable).
- **Finance documents** (invoices, credit notes, payments, allocations, expense bills, payroll runs, depreciation, loan
  schedules) post directly with `postJournalInTx` and fail loudly.
- **No module computes cost, quantity or a ledger balance of its own.**

---

## 6. System boundaries and module ownership

| Module | Location | Owns | Never does |
|---|---|---|---|
| Inventory | `modules/inventory/inventory.service.ts` | `ProductVariant.stock`, `StockMovement` | value, accounting |
| Costing | `domain/finance/costing.service.ts` | `InventoryValuationEntry`, `InventoryCostState`, cost determination | quantity, journals |
| Ledger | `domain/finance/journal.service.ts` (+events) | `JournalEntry/Line`, events | business documents |
| Purchasing | `domain/finance/purchasing/*` [PROPOSED] | PO, GRN, supplier return documents | stock/value writes except via the two above |
| AP | `domain/finance/ap/*` [PROPOSED] | supplier invoices, credit notes, allocations | its own balance column |
| Manufacturing | `domain/manufacturing/*` [PROPOSED] | BOMs, production orders, material custody, cost entries, deliveries/QC | stock, value or journal writes except via the services above |
| Treasury | `domain/finance/treasury.service.ts` | money movements | AP balances |
| Reports | `domain/finance/reports/*` [PROPOSED] | read models / queries | writes |

Architecture guards (existing, to be extended): finance tables written only from the finance domain; valuation tables
only via `costing.service`; stock only via `inventory.service`; **[PROPOSED]** manufacturing tables only from
`domain/manufacturing`.

---

## 7. Data ownership and database boundaries

| Level | Entities |
|---|---|
| Business (installation's `FinanceBusiness`, no brand) | Supplier, TaxCode, settings, account mappings, cost categories |
| Brand / installation (`brandId` = the installation's brand) | PO, GRN, supplier return, valuation ledger, BOM, production order, material custody, production receipt |
| Transaction (brand on document and every journal line) | invoices, credit notes, allocations, payments, production cost entries, expenses |

Commerce tables get **no** `brandId`. Manufacturing references variants by id (Restrict FK where history must outlive
the catalog, plain id + snapshot where the document is history).

---

## 8. Brand and business isolation rules

1. One installation = one brand's commerce DB = one `FinanceBrand` (`installId` match enforced in `recordFinancialEvent`).
2. Every financial event names `businessKey` + `brandKey`; the inbox refuses a brand reporting from another install.
3. Inventory, revenue, cost and cash are never mixed across installations; consolidated reporting is a union by
   `Supplier.code` / account code in a future central-finance step (**[DEFERRED]**, F8).
4. Never merge commerce databases.

---

## 9. Accounting principles and financial invariants

Existing (enforced by triggers/tests) **[VERIFIED]**: balanced journals; posted journals immutable, corrected by
reversal; period locks (closed periods roll late events forward); idempotency keys per business; audit entry required at
commit for finance tables (F-6); no TRUNCATE; money as `Decimal(18,2)` / BigInt minor units, never floats; valuation
append-only with continuity; ledger 1610 = valuation (adjustment rule); line cost = exit valuation (trigger).

Added by this programme **[DECIDED]**:

- **I-1** Every manufacturing / purchasing posting names mapping keys, never account ids.
- **I-2** WIP (1630) = Σ open production orders' WIP balance (new reconciliation check).
- **I-3** Production cost accrual (2116) = Σ approved, not-yet-invoiced production costs (check, live from 4E).
- **I-4** A production receipt's units enter stock exactly once (unique movement per receipt line; idempotency key).
- **I-5** Delivered = accepted + rejected + rework-pending per receipt line (CHECK); Σ accepted ≤ planned + approved
  over-receipt per order variant line.
- **I-6** Issued = consumed + returned + scrapped + at-producer for every material line (derived, CHECK ≥ 0).
- **I-7** No manufacturing code writes stock, valuation or journals except through the owning services (guard).

---

## 10. Manufacturing and production business processes [PROPOSED → building]

Full spec: `docs/MANUFACTURING.md` (written with phase M1). Summary:

1. **Materials** are stock-tracked items of a non-sellable product kind (`Product.kind = MATERIAL`, CHECK: never
   active/published) → they reuse variants, `inventory.service`, costing, valuation, cutover and checks unchanged.
2. **BOM** (`BillOfMaterials` + versioned lines) per finished product (optionally per variant): material variant,
   quantity per unit, expected wastage %, supplied-by (BUSINESS / PRODUCER). Approved BOM versions are frozen.
3. **Production order** (`ProductionOrder`): finished product, BOM version snapshot, producer (an existing `Supplier`, or
   INTERNAL), terms, expected dates; **order lines per finished variant** (size × colour × attributes) with planned qty —
   the order total is the derived sum (no stored total).
4. **Lifecycle (server-enforced):** `DRAFT → APPROVED → IN_PRODUCTION → (PARTIALLY_RECEIVED) → RECEIVED → CLOSED`;
   `CANCELLED` only before any material issue or receipt. "Materials planned / issued / partially delivered / in QC" are
   **derived facets** shown in the UI, not extra states (avoids a state for every fact).
5. **Material requirements** are computed from BOM × planned qty (+ expected wastage); business-supplied materials are
   issued to the order (custody = at producer); producer-supplied materials are never the business's stock (cost comes
   only via the producer's charges).
6. **Issue / return / consume / scrap** of materials: issue = stock out of the material variant (valued at average) into
   the order's WIP; return = stock back in at the order line's issued average cost; consumption and scrap are declared at
   reconciliation; `at producer = issued − returned − consumed − scrapped` must reach 0 before close.
7. **Production costs** (`ProductionCostEntry`): configurable categories (`ProductionCostCategory`: MATERIAL,
   LABOUR, EXTERNAL_SERVICE, OVERHEAD, OTHER groups; e.g. cutting, sewing, embroidery, freight, samples, setup), amount,
   qty × rate, payee supplier, reference, status `DRAFT → APPROVED (accrued) → INVOICED → (PAID via AP)`, `VOID` by
   reversal. Approved costs post Dr WIP / Cr 2116 accrued production costs.
8. **Deliveries & QC** (`ProductionReceipt` + lines per order variant line): delivered, accepted, rejected, rework;
   multiple partial deliveries; posting is idempotent; accepted units enter finished stock through
   `inventory.service` (reason `PRODUCTION_RECEIPT`) at the order's **provisional unit cost**; rejected units never enter
   saleable stock.
9. **Close / reconcile**: all material custody resolved, all costs approved or explicitly excluded; final cost = WIP
   total; final unit cost = final cost ÷ total accepted units; difference between final and provisionally transferred
   value → REVALUE of units still held + 5150 for the sold share (locked decision 11); WIP returns to 0.
10. **Late costs after close**: a cost entry on a CLOSED order posts Dr 5150-or-inventory split via the same REVALUE path
    (never rewriting COGS).

---

## 11. Inventory and costing model

Existing (FINANCE_PHASE_4 §5, §9) **[VERIFIED]**. Additions:

| Movement (new reason) | Costing op | Ledger owner | Posting |
|---|---|---|---|
| `PRODUCTION_ISSUE` (material out to an order) | OUTFLOW AVERAGE | document | Dr 1630 WIP / Cr 1610 at valuation value |
| `PRODUCTION_RETURN` (unused material back) | INFLOW at issued average (DOCUMENT) | document | Dr 1610 / Cr 1630 |
| `PRODUCTION_RECEIPT` (accepted finished goods) | INFLOW at provisional unit cost (DOCUMENT) | document | Dr 1610 / Cr 1630 |
| `PRODUCTION_SCRAP` / write-off of finished rejects held | OUTFLOW AVERAGE | document | Dr production loss / Cr 1610 |
| `PURCHASE_RECEIPT` (GRN, 4D) | INFLOW at document cost | document | Dr 1610 / Cr 2115 GRNI |
| `PURCHASE_RETURN` (4D) | OUTFLOW AVERAGE | document | Dr 2115 / Cr 1610 |

A new `LedgerOwner = "DOCUMENT"`: the costing engine values the movement and posts only the cost adjustment; the
document's own event posts the book value it received back from the engine (same transaction).

**[DECIDED] D-C1** Raw materials and finished goods share the inventory control account `asset.inventory` (1610) in this
programme; the valuation report splits them by product kind. A separate raw-materials account is a later mapping change
(alias key `asset.inventory_materials`), not a schema change.

---

## 12. Integration and event contracts

New financial events (envelope `finance.event` v1, posting rules registered per type@version):

| Event | Producer | Key | Posting |
|---|---|---|---|
| `purchasing.goods_received` | GRN post | `grn:<id>#r<rev>` | Dr 1610 / Cr 2115 |
| `purchasing.return_shipped` | return ship | `preturn:<id>#r<rev>` | Dr 2115 / Cr 1610 |
| `manufacturing.material_moved` | issue/return | `mfg-mat:<movementId>` | Dr/Cr 1630 vs 1610 |
| `manufacturing.cost_accrued` | cost approval | `mfg-cost:<entryId>#r<rev>` | Dr 1630 / Cr 2116 (void revision supersedes) |
| `manufacturing.goods_received` | receipt post | `mfg-rcpt:<receiptId>` | Dr 1610 / Cr 1630 |
| `manufacturing.order_closed` | close | `mfg-close:<orderId>` | WIP residual: Dr/Cr 1610 (held share, via REVALUE) & 5150 (sold share) vs 1630; abnormal loss → production losses |

Stock movements gain `sourceType` / `sourceId` (nullable, additive) so every document movement names its document.

---

## 13. API and UI requirements

API: `/api/v1/purchasing/*` (extended), `/api/v1/manufacturing/*` (new), `/api/v1/finance/*` (extended). zod schemas in
`packages/shared/src/schemas/`. Every route `requireAdmin` + `requirePermission`; services audit every state change.

UI (admin, Apple-style, light only, `docs/DESIGN_SYSTEM.md` tokens and `components/ui/*` primitives; loading / empty /
error states; 375 px): Finance → Valuation cutover; Purchasing → Purchase orders, Goods receipts, Supplier returns;
**Manufacturing** (new nav group) → Overview, Production orders (list, create, detail with tabs Plan · Materials · Costs
· Deliveries · Reconciliation · History), BOMs, Materials, Cost categories, Reports.

---

## 14. Roles, permissions and approval workflows

New permissions **[DECIDED]** (granted in `permissions.ts`):

| Permission | OWNER | STAFF | FINANCE_ADMIN | ACCOUNTANT | FINANCE_VIEWER |
|---|---|---|---|---|---|
| `manufacturing.read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `manufacturing.manage` (draft orders, BOMs, plan, record deliveries/QC drafts, draft costs) | ✓ | ✓ | ✓ | | |
| `manufacturing.approve` (approve orders, BOM versions, costs, write-offs, over-receipts, close) | ✓ | | ✓ | | |
| `manufacturing.move_stock` (issue/return materials, post receipts) | ✓ | ✓ | | | |
| existing `costing.adjust` — valuation cutover approval & post | ✓ | | | | |

Separation: production order approver ≠ creator above the business threshold; cost approver ≠ cost enterer (always);
cutover approver = OWNER.

---

## 15. Audit, idempotency, concurrency and recovery

- Every new finance/manufacturing table: `businessId` FK Restrict, audit entry required at commit (F-6 constraint
  trigger), no TRUNCATE, no hard delete once referenced.
- Document post operations take the document row `FOR UPDATE`, check status, and use an idempotency key (`Idempotency-Key`
  header or document-derived key); a repeated post returns the posted result.
- Lock order: document row → variant rows (sorted by id, via inventory.service) → cost state (via costing) → event.
- Recovery: a FAILED event is retried from Finance → Sales accounting / events; documents are never partially posted
  (single transaction).

---

## 16. Database migration strategy

Additive migrations only, one per phase, timestamp after `20261015100000`. Enum additions are separate statements.
CHECK constraints and triggers ship in the same migration as their tables. No data backfill touches production data;
new columns are nullable or defaulted. Rollback = the previous release ignores new tables (no destructive down
migration).

---

## 17. Testing and acceptance criteria

Per phase: pure unit tests for calculations; integration tests on `clothing_brand_test` (real services, real triggers)
covering happy path, validation, authorization matrix, idempotent retry, concurrency (parallel posts), rollback,
invalid transitions, DB constraints, ledger = valuation convergence; guard tests; browser e2e on a fresh QA DB for UI
phases; full API regression at phase boundaries.

---

## 18. Performance and scalability

Checkout path must not regress (4B benchmark is the budget). Document posting is O(lines) with batched inserts; reports
use set-based SQL with indexes on `(businessId, status)`, `(productionOrderId)`; no unbounded in-memory scans
(paginate lists, cap reports by date range).

---

## 19. Security and operational requirements

Server-side authorization on every route; zod validation; never trust client totals, costs, quantities, statuses or
dates — the server derives them; sensitive figures (costs) only behind `costing.read` / `manufacturing.read`; no new
public endpoints; no secrets in code; production operations (cutover, deploy) are owner actions.

---

## 20. Phase dependencies

```
E0 audit+blueprint ─► E1 (4C cutover mechanism) ─► E2 (4D purchasing docs) ─► M1 (mfg foundation: materials, BOM, orders)
                                                                         └──► M2 (materials issue/return, WIP)
                                                    M1 ─► M2 ─► M3 (production costs) ─► M4 (deliveries, QC, FG receipt) ─► M5 (close, variance, reports, UI polish)
E2 ─► E3 (4E invoices / AP, incl. production-cost invoices clearing 2116) ─► E4 (4F payments) ─► E5 (4G reports & checks)
E1..E5 ─► E6 ledger workspace UI + financial statements
E6 ─► E7 expenses & commitments ─► E8 payroll ─► E9 fixed assets ─► E10 loans ─► E11 partners/equity ─► E12 budgets/forecast ─► E13 tax/VAT ─► E14 alerts & hardening
```

Stock-moving documents (GRN, issue, receipt) require costing to be **active** (see D-P1).

---

## 21. Risks, unresolved decisions and approved assumptions

### Decisions taken under delegation (owner may revise; each is reversible before production use)

| # | Decision | Rationale | Consequence |
|---|---|---|---|
| D-P1 | Stock-moving purchasing/manufacturing documents refuse to post while costing is inactive (`COSTING_NOT_ACTIVE`, 409); drafting/approval works | Locked Phase 4 order ("costing before documents"); avoids unvalued receipts and a second truth | Production use of GRN/manufacturing receipts starts after the owner runs the 4C cutover |
| D-M1 | Materials = `Product.kind = MATERIAL` (non-sellable, DB CHECK `isActive=false`, status ≠ PUBLISHED) | Reuses inventory/costing/valuation/cutover; no second inventory engine | Admin catalog lists filter by kind; storefront unaffected (single purchasability rule) |
| D-M2 | Custody via production-order material lines (issued/returned/consumed/scrapped), no location engine | Smallest coherent extension (directive §5.4) | Material at a producer is off the shelf (stock decremented) but in WIP (asset) |
| D-M3 | WIP account 1630 (`asset.wip`), accrual account 2116 (`liability.production_accrual`), loss account 5220 (`cogs.production_losses`) | Separate controls → reconcilable checks I-2/I-3 | Provisioned by `manufacturing/setup` like purchasing set-up |
| D-M4 | Normal rejection and wastage are absorbed into accepted units' cost; abnormal loss is expensed only through an explicit, approved write-off with reason | IAS 2 practice; avoids hiding rejects (they are reported) and avoids spreading over planned qty | Cost per accepted unit rises with rejects; rejection cost shown separately |
| D-M5 | Finished goods enter stock at a provisional unit cost = (actual WIP to date + approved-but-not-yet-incurred planned remainder) ÷ expected accepted units; the final cost at close trues up via REVALUE (held share) and 5150 (sold share) | Partial deliveries need a cost at receipt; locked decision 11 forbids rewriting COGS | Provisional/final status is visible on the order and on valuation entries (ESTIMATED until close) |
| D-M6 | Producer = an existing `Supplier` (no duplicate factory master); INTERNAL production has no supplier | Directive §5.3 | Supplier performance metrics derive from production orders |
| D-C1 | One inventory control account (1610) for materials and finished goods | see §11 | Split later by mapping |

### Blockers (owner action required)

| # | Blocker | What is needed | Work that continues meanwhile |
|---|---|---|---|
| B-1 | **Running the 4C valuation cutover on live data** (irreversible, sets activation) | Owner approval + per-SKU unit costs (KNOWN / ESTIMATED / MISSING) on a production snapshot; owner runs it in the admin UI | Mechanism built and tested on test DBs; everything downstream is built and tested with costing activated in tests |
| B-2 | Partner capital, profit distribution, sweat equity | Signed agreements / percentages / vesting terms | Data model and ledger accounts can be designed; no equity journals |
| B-3 | Payroll statutory rules (tax, PF, festival bonus rules) | Owner/accountant confirmation | Configurable structure without hard-coded rules |
| B-4 | VAT / Mushak jurisdiction rules | Accountant confirmation | Configurable tax codes (exist) |
| B-5 | Merging into `main` / deploying | Owner merges; never pushed by Claude | — |

### Risks

- **R-1** Branch divergence with `main` (admin-v2, orders workspace, courier notes): finance branch must be rebased/merged
  by the owner; schema migrations are additive to reduce conflicts.
- **R-2** Cutover accuracy depends on owner-chosen costs (mitigated by labels and per-SKU schedule).
- **R-3** Locking all tracked variants at cutover blocks checkout for its duration (one-time; run off-peak).
- **R-4** Context/session limits: progress is recorded here per work unit.

---

## 22. Phase-by-phase roadmap

Each phase: scope → data → API → UI → accounting → security → migration → acceptance → tests → exit.

### E1 — Valuation cutover & activation (Finance 4C)
- **Scope:** `InventoryCutoverBatch` (+ lines): DRAFT built from all tracked variants (proposed unit cost + source:
  latest variant/product cost price → ESTIMATED; owner may set KNOWN with evidence; none → MISSING); edit lines; owner
  approval (`costing.adjust`); POST atomically: lock tracked variants, take physical quantity at post, write one CUTOVER
  valuation entry per variant, post one cutover journal (Dr/Cr 1610 vs 5150 for the difference between the 1610 ledger
  balance and Σ cutover value; an owner-declared, reasoned opening-balance-error portion to 3900), activate costing at
  the same instant. One batch per business (unique), POSTED is final. Full deletion guard: a product/variant with stock,
  valuation, purchase, production, cost or accounting history is archived, never hard-deleted.
- **Accounting:** journal kind ADJUSTMENT, key `inventory-cutover:<batchId>`; mapping keys only.
- **Acceptance:** after post, checks `inventory.quantity_vs_valuation`, `inventory.valuation_postings` MATCHED; 1610 =
  Σ cost-state value; activation set once; retry returns the same result; concurrent posts → one wins; a variant moving
  between draft and post is cut over at its post-time quantity.
- **Exit:** tests green; UI page Finance → Valuation cutover; production run = B-1.

### E2 — Purchasing documents (Finance 4D)
- PO (`DRAFT → SUBMITTED → APPROVED → (PARTIALLY_)RECEIVED / CLOSED / CANCELLED`, derived receive status), GRN
  (`DRAFT → POSTED → REVERSED`, idempotent post, approved direct receipts, over-receipt tolerance), supplier returns
  (`DRAFT → APPROVED → SHIPPED → CLOSED`), `inventory.recordPurchaseReceipt/Return`, events, GRNI check `purchasing.grni`.

### M1 — Manufacturing foundation
- `Product.kind` (FINISHED default / MATERIAL), materials admin list; `ProductionCostCategory` seed; BOM + versions;
  production orders + variant lines; lifecycle transitions; material requirement calculation; permissions; set-up of
  accounts 1630 / 2116 / 5220; API + UI (orders list/create/detail Plan tab, BOMs, materials).
- **Acceptance:** totals derived; illegal transitions refused server-side; BOM version freeze; requirement maths unit-tested.

### M2 — Materials custody & WIP
- Issue / return (stock via inventory.service, value via costing, event `manufacturing.material_moved`), consumption &
  scrap declarations, custody invariant I-6, WIP check I-2.

### M3 — Production costs
- Cost entries, approval (approver ≠ enterer), accrual postings (`manufacturing.cost_accrued`), void by supersession,
  planned vs actual by category, duplicate guard (unique `(supplierId, reference, category)` when reference given).

### M4 — Deliveries, QC, finished-goods receipt
- Receipts with per-variant lines, quantity reconciliation I-5, idempotent post, provisional cost D-M5, rework
  re-inspection, rejected handling (return to producer / write-off approved).

### M5 — Close, variance, reports, UI polish
- Close checklist, final cost, REVALUE/5150 true-up, late costs, reports (cost per accepted unit, variance by category,
  wastage, yield, rejection rate, supplier performance), manufacturing overview dashboard, browser QA.

### E3 — Supplier invoices & AP (4E)  ·  E4 — Supplier payments (4F)  ·  E5 — Reports & checks (4G)
As FINANCE_PHASE_4 §1 / proposal §10–§12, §24–§25; plus production-cost invoice lines clearing 2116 (I-3).

### E6 — Ledger workspace & financial statements
Chart of accounts, journals (draft/post/reverse), trial balance, periods, opening balances UI; income statement,
balance sheet, cash-flow (indirect) from the ledger, brand filter.

### E7–E14
Expenses & recurring commitments (bills to AP or Treasury, fixed/variable classification, break-even); payroll
(configurable structures, runs, approval, posting; B-3); fixed assets (register, capitalisation, straight-line /
declining depreciation runs, disposals); loans (schedule, interest accrual, repayments); partners & equity (B-2);
budgets, forecasts, cash runway; tax/VAT configuration (B-4); alerts, permission review, final hardening.

### 4H — Foreign currency **[DEFERRED]** (optional, after E5).

---

## 23. Current phase and exact status

| Phase | Status | Notes |
|---|---|---|
| E0 Audit + blueprint | **done** 2026-10-09 | this file |
| E1 4C cutover | **done** 2026-10-09 (`29e6ad1`) | `FINANCE_PHASE_4C.md`; live run = B-1 |
| E2 4D purchasing | **done** 2026-10-09 (`1802514`) | `FINANCE_PHASE_4D.md` |
| M1 manufacturing foundation | **done** 2026-10-09 (`01c4ffc`) | `MANUFACTURING.md` §2–§5 |
| M2 materials custody & WIP | **done** 2026-10-09 (`7c5223e`) | `MANUFACTURING.md` §6 |
| M3 production costs | **done** 2026-10-09 (`80f96ae`) | `MANUFACTURING.md` §7 |
| M4 deliveries, QC, finished goods | **done** 2026-10-09 (`8db9c29`) | `MANUFACTURING.md` §8 |
| M5 close, final cost, late costs, reports | **done** 2026-10-09 (`c2f16e5`) | `MANUFACTURING.md` §9 |
| E3 4E supplier invoices / AP | **done** 2026-10-09 (`34de17c`) | `FINANCE_PHASE_4E.md` |
| E4 4F supplier payments | **done** 2026-10-09 (`46ff888`) | `FINANCE_PHASE_4F.md` |
| E5 4G reports & checks | **done** 2026-10-09 (`5876081`) | `FINANCE_PHASE_4G.md` |
| E6 ledger workspace & statements | **done** 2026-10-09 (`a333035`) | `FINANCE_STATEMENTS.md` |
| E7 expenses & commitments | **done** 2026-10-09 (`6099411`) | `FINANCE_EXPENSES.md` |
| E8 payroll | **blocked** (B-3: the owner's payroll rules) | §21 |
| E9 fixed assets | **done** 2026-10-09 | `FINANCE_FIXED_ASSETS.md` |
| E10 loans | **next** | §27 |
| E11–E14 | not started (E11 blocked B-2, E13 blocked B-4) | |

---

## 24. Files and modules changed per completed phase

| Phase | Commit | Files |
|---|---|---|
| E0 | `c97602f` | `docs/MASTER_ERP_FINANCE_MANUFACTURING_BLUEPRINT.md` |
| E1 | `29e6ad1` | migration `20261016100000_finance_phase4c_cutover`; `schema.prisma`; `domain/finance/inventory-cutover.service.ts` (+ test); `reconciliation.service.ts` (`inventory.valuation_vs_ledger`); `inventory.service.ts` (recordSale race fix); `products/product.service.ts` (history deletion guard); `finance.routes.ts`; shared `schemas/finance-purchasing.ts`; web `finance/inventory-cutover/page.tsx`, `lib/api/finance.ts`, `lib/admin/navigation.ts`; tests updated: authorization matrix, finance.integration, historical-snapshots, product-duplicate; `test-fixtures.ts`; docs `FINANCE_PHASE_4C.md`, `FINANCE_PHASE_4.md` |
| E2 | `1802514` | migration `20261017100000_finance_phase4d_purchasing`; `schema.prisma`; `domain/finance/{purchase-orders,goods-receipts,purchase-returns}.service.ts`, `purchasing-posting-rules.ts`, `purchasing-setup.service.ts` (settings), `costing.service.ts` (DOCUMENT basis/owner), `reconciliation.service.ts` (`purchasing.grni`), `events.service.ts`; `inventory.service.ts` (`recordDocumentMovements`); `purchasing.routes.ts`; shared schemas; web `finance/{purchase-orders,purchase-orders/[id],goods-receipts,supplier-returns}`, `components/admin/purchasing/*`, `lib/api/purchasing.ts`, navigation; tests: `finance-purchasing-documents.integration.test.ts` + auth matrix, writer guard, finance.integration, store-identity guard; docs `FINANCE_PHASE_4D.md` |
| M1 | `01c4ffc` | migrations `20261018100000_manufacturing_foundation`, `20261018100100_manufacturing_material_source`; `schema.prisma`; `domain/manufacturing/{requirements,manufacturing-setup.service,materials.service,boms.service,production-orders.service}.ts` + tests + guard; `modules/manufacturing/manufacturing.routes.ts`, `app.ts`; `products/product.service.ts` (catalog excludes materials); shared `permissions.ts`, `finance/accounts.ts` (1630/2116/5220), `schemas/manufacturing.ts`; web `manufacturing/{production-orders,production-orders/[id],boms,materials}`, `components/admin/manufacturing/*`, `lib/api/manufacturing.ts`, navigation (Inventory grouping) + test, capabilities; auth matrix; docs `MANUFACTURING.md` |
| M2 | `7c5223e` | migration `20261019100000_manufacturing_material_custody`; `schema.prisma` (reasons, `ProductionMaterialMove`); `domain/manufacturing/material-custody.service.ts` + test; `production-orders.service.ts` (WIP in DTO); `domain/finance/manufacturing-posting-rules.ts`, `events.service.ts`, `reconciliation.service.ts` (`manufacturing.wip`; ignored events no longer counted as unposted); `inventory.service.ts` (reasons); routes; shared schemas; web order page custody + `custody-modals.tsx`, `lib/api/manufacturing.ts`; auth matrix 481; finance.integration count 18; docs |
| M3 | `80f96ae` | migration `20261020100000_manufacturing_production_costs`; `schema.prisma` (`ProductionCostEntry`); `domain/manufacturing/production-costs.service.ts`; `production-orders.service.ts` (costs, planned vs actual, WIP total); `domain/finance/manufacturing-posting-rules.ts` (`cost_accrued`), `reconciliation.service.ts` (`manufacturing.wip` + costs, `manufacturing.production_accrual`); routes; shared schemas; web `components/admin/manufacturing/production-costs.tsx`, order page; tests: custody suite +3, auth matrix 486, finance.integration check count now derived from the registry; docs |
| M4 | `8db9c29` | migration `20261021100000_manufacturing_receipts`; `schema.prisma` (receipts, derived order-line quantities, `PRODUCTION_RECEIPT`); `domain/manufacturing/production-receipts.service.ts`; `production-orders.service.ts` (progress, receipts, WIP transfer, `plannedCostMinor`); `domain/finance/manufacturing-posting-rules.ts` (`goods_received`), `reconciliation.service.ts` (WIP − transfers), `inventory-cutover.service.ts` (bridge estimates = commerce only); `inventory.service.ts` (reason); routes; shared schemas; web `production-deliveries.tsx`, order page; tests: custody suite +4 (real second admin), auth matrix 490; docs |
| M5 | `c2f16e5` | migration `20261022100000_manufacturing_close`; `schema.prisma` (`ProductionSettlement` + lines, `closedByAdminId`); `domain/finance/costing.service.ts` (`revalueForDocumentInTx`), `manufacturing-posting-rules.ts` (`order_settled`), `reconciliation.service.ts` (WIP − settlements; completeness: finalised at close); `domain/manufacturing/production-close.service.ts`, `production-reports.service.ts`, `production-costs.service.ts` (late costs, order lock), `production-orders.service.ts` (final cost, performance, checklist); routes (close, overview); shared schema; web `production-close.tsx`, `manufacturing/page.tsx` (overview), order page, costs, navigation (+test); tests: custody suite +4, auth matrix 492; `test-fixtures` purge; docs |
| E3 | `34de17c` | migration `20261023100000_finance_phase4e_payables`; `schema.prisma` (`SupplierInvoice` + lines, `invoicePriceTolerancePct`); `domain/finance/supplier-invoices.service.ts` (+ integration test), `payables-posting-rules.ts`, `events.service.ts` (rule registration), `reconciliation.service.ts` (`payables.subledger`; GRNI and accrual net of invoices), `goods-receipts.service.ts` (no reversal once billed), `purchasing-setup.service.ts` (tolerance); `domain/manufacturing/production-costs.service.ts` (no void once billed) + custody test; routes; shared schemas; web `finance/supplier-invoices`, `finance/payables`, `components/admin/payables/invoice-modal.tsx`, purchasing API / status, navigation; tests: auth matrix 501, store-identity allowlist; `test-fixtures` purge; docs `FINANCE_PHASE_4E.md` |
| E4 | `46ff888` | migrations `20261024100000_finance_phase4f_payment_kind`, `20261024100100_finance_phase4f_payments`; `schema.prisma` (`SUPPLIER_PAYMENT`, `TreasuryMovement.supplierId`, `SupplierAllocation`); `domain/finance/treasury.service.ts` (supplier payment journal with party, release on reject / reverse), `supplier-payments.service.ts`, `supplier-invoices.service.ts` (settled / outstanding, void refused when allocated, ageing net of advances), `reconciliation.service.ts` (`payables.subledger` − payments); routes; shared schemas; web `finance/payables/[supplierId]`, `components/admin/payables/payment-modal.tsx`, payables / bills pages, finance & purchasing API, navigation; tests: payables suite +4, auth matrix 505; `test-fixtures` purge; docs `FINANCE_PHASE_4F.md` |
| E5 | `5876081` | `domain/finance/purchasing-reports.service.ts` (purchase register, GRNI ageing, price variance, inventory valuation, cost adjustments by origin, payments register); routes; shared `purchasingReportQuerySchema`; web `finance/reports`, `lib/csv.ts`, purchasing API, navigation; tests: payables suite +1 (tie-outs), auth matrix 511; docs `FINANCE_PHASE_4G.md` |
| E6 | `a333035` | `domain/finance/statements.service.ts` (income statement with prior period, balance sheet with current earnings, indirect cash flow reconciled to money accounts); finance routes; shared `statementPeriodQuerySchema`, `balanceSheetQuerySchema`; web `finance/statements`, `finance/ledger`, `finance/journals`, finance API (chart, ledger, journals, trial balance, statements), navigation; tests: payables suite +1 (statements tie to the trial balance), auth matrix 514; docs `FINANCE_STATEMENTS.md` |
| E7 | `6099411` | migration `20261025100000_finance_expenses`; `schema.prisma` (`Expense`, `RecurringCommitment`, `CostBehaviour`, `CommitmentFrequency`); `domain/finance/expenses.service.ts` (expenses as Treasury withdrawals, commitment schedule, summary + break-even); finance routes; shared schemas; web `finance/expenses`, finance API, navigation; tests: payables suite +2, auth matrix 520; `test-fixtures` purge; docs `FINANCE_EXPENSES.md` |
| E9 | (E9 commit, see git log) | migration `20261026100000_finance_fixed_assets`; `schema.prisma` (`FixedAsset`, `DepreciationRun`, `DepreciationLine`); shared `accounts.ts` (keys + 7300 / 8300, `FIXED_ASSET_MAPPING_KEYS`), schemas; `domain/finance/fixed-assets.service.ts`, `reconciliation.service.ts` (`fixed_assets.register`); finance routes; web `finance/fixed-assets`, finance API, navigation; tests: payables suite +2, auth matrix 526; `test-fixtures` purge; docs `FINANCE_FIXED_ASSETS.md` |

---

## 25. Commands executed and verification results

| Date | Command | Result |
|---|---|---|
| 2026-10-09 | `npx vitest run` (apps/api) at `4b68828` | 103 files, 1238 passed |
| 2026-10-09 | E1: `npx vitest run` (apps/api) | 104 files, 1249 passed |
| 2026-10-09 | E1: web `tsc --noEmit`, `eslint` (changed files), `vitest run` | clean; 35 passed |
| 2026-10-09 | E2: `npx vitest run` (apps/api) | 105 files, 1258 passed |
| 2026-10-09 | E2: web `tsc --noEmit`, `eslint` (changed files), `vitest run` | clean; 35 passed |
| 2026-10-09 | M1: `npx vitest run` (apps/api) | 108 files, 1273 tests: 1272 passed + the config-SSOT guard after removing a currency symbol from UI copy (re-run: pass) |
| 2026-10-09 | M1: web `tsc --noEmit`, `eslint` (changed files), `vitest run` | clean; 35 passed |
| 2026-10-09 | E9: `npx vitest run` (apps/api) | 110 files, 1305 passed |
| 2026-10-09 | E9: web `tsc`, `eslint`, `vitest` | clean; 35 passed |
| 2026-10-09 | E9 browser QA (`finance_qa`) | machine ৳120,000 billed to 1810, registered; Oct run ৳1,800 → NBV ৳118,200; register = ledger check matches; 1440 / 375 px |
| 2026-10-09 | E7: `npx vitest run` (apps/api) | 110 files, 1303 passed |
| 2026-10-09 | E7: web `tsc`, `eslint`, `vitest` | clean; 35 passed |
| 2026-10-09 | E7 browser QA (`finance_qa`) | Shop rent ৳30,000 monthly; Aug/Sep overdue, Oct paid EXP-000001 from City Bank; fixed ৳30,000 / month; 1440 / 375 px |
| 2026-10-09 | E6: `npx vitest run` (apps/api) | 110 files, 1301 passed |
| 2026-10-09 | E6: web `tsc`, `eslint`, `vitest` | clean; 35 passed |
| 2026-10-09 | E6 browser QA (`finance_qa`) | net profit ৳492; balance sheet ৳387,742.94 balanced; cash flow ৳0 → ৳85,000 reconciles; manual rent journal posted; ledger drill-down; 1440 / 375 px |
| 2026-10-09 | E5: `npx vitest run` (apps/api) | 110 files, 1300 passed |
| 2026-10-09 | E5: web `tsc`, `eslint`, `vitest` | clean; 35 passed |
| 2026-10-09 | E5 browser QA (`finance_qa`) | 6 reports; GRNI ৳12,650.94 and inventory ৳302,742.94 equal their checks; payments ৳15,000; 1440 / 375 px |
| 2026-10-09 | E4: `npx vitest run` (apps/api) | 110 files, 1299 passed; after the paying-account rule: treasury + finance + payables 62/62 |
| 2026-10-09 | E4: web `tsc`, `eslint`, `vitest` | clean; 35 passed |
| 2026-10-09 | E4 browser QA (`finance_qa`) | City Bank ৳100,000; paid Dhaka Caps ৳15,000 of ৳20,600 → ৳5,600 owed; statement, payables / money / ledger checks match; 1440 / 375 px |
| 2026-10-09 | E3: `npx vitest run` (apps/api) | 110 files, 1294 passed + the store-identity guard after allowlisting `SupplierInvoice.currency` (re-run 5/5) |
| 2026-10-09 | E3: web `tsc`, `eslint`, `vitest` | clean; 35 passed |
| 2026-10-09 | E3 browser QA (`finance_qa`) | bill DC-778: twill 20,000 × ৳0.13 (variance approved) + ৳18,000 CMT; GRNI −৳2,400, accrual → 0, payables ৳20,600, inventory +৳48 (held share); all checks match; 1440 / 375 px |
| 2026-10-09 | M5: `npx vitest run` (apps/api) | 109 files, 1288 passed (after: finance + manufacturing suites re-run 228/228 for the completeness-check refinement) |
| 2026-10-09 | M5: web `tsc`, `eslint`, `vitest` | clean; 35 passed (navigation test: Production tab) |
| 2026-10-09 | M5 browser QA (`finance_qa`) | close MO-000001, loss ৳56 → ৳4,900 to goods; final ৳19,824, ৳65.89 / accepted unit; 18 checks match (cost completeness lists only 9 QA opening estimates); overview + order 1440 / 375 px, no overflow |
| 2026-10-09 | M4: `npx vitest run` (apps/api) | 109 files, 1284 passed |
| 2026-10-09 | M4: web `tsc`, `eslint`, `vitest` | clean; 35 passed |
| 2026-10-09 | M4 browser QA (`finance_qa`) | delivery 300/5/3 posted at ৳49.56 = ৳14,868; partly received; 7 checks match; 375 px OK |
| 2026-10-09 | M3: `npx vitest run` (apps/api) | 1280 tests: 1279 passed + finance.integration (count now derived from the check registry; re-run 24/24) |
| 2026-10-09 | M3 browser QA (`finance_qa`) | owner enters 400 × 45 (no Approve shown); approver@ approves; actual ৳19,824; wip / accrual / valuation / ledger checks match |
| 2026-10-09 | M2: `npx vitest run` (apps/api) | 1277 tests: 1276 passed + finance.integration after its check count 17→18 (re-run 24/24) |
| 2026-10-09 | M2 browser QA (`finance_qa`) | PO/GRN 20,000 cm @ 0.12; issue 15,600; usage 14,800/400; return 400; WIP ৳1,824; 7 checks match; 375 px OK |
| 2026-10-09 | M1 browser QA (`finance_qa`) 1440 + 375 px | set-up → material → BOM v1 approved → MO 400 units approved; requirement 15,600 cm; incomplete planned cost shown as "Not known yet" |
| 2026-10-09 | E2 browser QA (`finance_qa`) 1440 + 375 px | PO → submit → approve → receive 18/2 → partly received; return 3 → ship ৳2,649.06; 6 checks match |
| 2026-10-09 | E1 browser QA (`finance_qa`, API :4390 `INSTALL_ID=qa WEB_ORIGIN=http://localhost:3390`, web :3390), 1440 + 375 px | draft → KNOWN cost → approve → post; true-up ৳700 as computed; 5 inventory/ledger checks match |

---

## 26. Known limitations and technical debt

- No location/warehouse model (custody is per production order only).
- No lots/serials/FIFO; AVCO only.
- Pre-existing same-customer deadlock (FINANCE_PHASE_4 §9.8).
- `next build` on the Windows dev machine fails only at the standalone symlink copy (EPERM); Docker build is the check.
- Finance branch not yet integrated with `main` (R-1).

---

## 27. Next eligible task and acceptance criteria

E8 payroll stays **blocked on B-3**. Next eligible:

**E10 — Loans** (`docs/FINANCE_LOANS.md`). Loans received (bank or other lender; partner loans stay under B-2): principal
drawn into a money account (Treasury DEPOSIT against the loan liability, 2510 / `liability.loans`), terms (annual rate,
term in months, repayment type: equal instalments (annuity) or equal principal, first due date), a repayment schedule
(exact, half-even, last instalment absorbs rounding), monthly interest accrual run (Dr 8100 interest expense / Cr accrued
interest), repayments from a money account splitting interest and principal (Treasury WITHDRAWAL lines), prepayment,
statement per loan (drawn, repaid, outstanding principal, interest paid / accrued). Check `loans.subledger`: the loan
liability = Σ outstanding principal; accrued interest = accrued − paid. Acceptance: schedule sums to principal, liability
ties, closed periods respected, browser QA.

Then E12 (budgets / forecast / cash runway), E14 (alerts & hardening); E11 and E13 need the owner (B-2, B-4).

## 28. Changelog

| Date | Change |
|---|---|
| 2026-10-09 | v1 — audit of `4b68828`, target architecture, manufacturing design, decisions D-P1/D-M1–M6/D-C1, roadmap E1–E14 + M1–M5 |
| 2026-10-09 | v2 — E1 (4C valuation cutover) done; bridge formula and decision-4 deletion guard recorded; next E2 |
| 2026-10-09 | v3 — E2 (4D purchasing documents) done; next M1 manufacturing foundation |
| 2026-10-09 | v4 — M1 manufacturing foundation done; manufacturing nested under Inventory (12-module cap); next M2 |
| 2026-10-09 | v5 — M2 materials custody & WIP done; next M3 production costs |
| 2026-10-09 | v6 — M3 production costs done; next M4 receipts / QC / finished goods |
| 2026-10-09 | v7 — M4 deliveries / QC / finished goods done; bridge estimate term limited to commerce; next M5 close |
| 2026-10-09 | v8 — M5 close / final cost / abnormal loss / late costs / production overview done; manufacturing M1–M5 complete; next E3 (4E supplier invoices / AP) |
| 2026-10-09 | v9 — E3 (4E) supplier invoices / credit notes / AP ageing done; GRNI and 2116 clear exactly; price differences via the revaluation path; next E4 (4F supplier payments) |
| 2026-10-09 | v10 — E4 (4F) supplier payments (Treasury kind), allocations, advances, supplier account / statement done; next E5 (4G reports) |
| 2026-10-09 | v11 — E5 (4G) purchasing / payables / inventory reports with tie-outs and CSV done; next E6 (ledger workspace & statements) |
| 2026-10-09 | v12 — E6 ledger workspace (chart, account ledger, journals with manual entry) and financial statements (income, balance sheet, cash flow, trial balance) done; next E7 (expenses & commitments) |
| 2026-10-09 | v13 — E7 expenses (Treasury withdrawals) and recurring commitments with schedule and break-even done; E8 payroll blocked (B-3); next E9 (fixed assets) |
| 2026-10-09 | v14 — E9 fixed assets (register, monthly depreciation runs, disposal, register = ledger check) done; next E10 (loans) |
