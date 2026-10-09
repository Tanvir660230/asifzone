# Manufacturing — production orders, materials, costs and finished goods

Status: **M1 (foundation) implemented and verified (2026-10-09).** M2–M5 are designed here and built next. The roadmap
and decisions are in `docs/MASTER_ERP_FINANCE_MANUFACTURING_BLUEPRINT.md` §10–§12, §21 (D-M1…D-M6) and §22.

Example: Asif Zone orders 1,000 caps from a factory. The system tracks:
- the product and its sizes and colours;
- the factory;
- the materials the business supplies and the ones the factory supplies;
- the agreed rate;
- every cost;
- what was delivered, accepted and rejected;
- the true cost of each accepted cap;
- the stock it becomes.

The same model serves Panjabi, clothing, caps, accessories and any other stock-tracked product.

## 1. Architecture

Manufacturing is a document layer on top of the existing engines. **It never moves stock, values it or posts journals
itself** (guard test `manufacturing-writers.guard.test.ts`, blueprint I-7):

| Concern | Owner |
|---|---|
| Quantity | `inventory.service.recordDocumentMovements` (reasons added in M2/M4) |
| Value | `costing.service` — the moving average, the DOCUMENT ledger owner, REVALUE for late costs |
| Books | financial events → posting rules → `journal.service` |
| Manufacturing tables | written only in `apps/api/src/domain/manufacturing` |

## 2. Set-up (`POST /manufacturing/setup`, `finance.configure`)

- **Accounts** (template + mapping keys, provisioned like purchasing; never overrides the owner's changes):

  | Code | Account | Mapping key |
  |---|---|---|
  | 1630 | Work in progress | `asset.wip` |
  | 2116 | Production costs accrued, not invoiced | `liability.production_accrual` |
  | 5220 | Production losses & abnormal waste | `cogs.production_losses` |

  Production also posts to 1610 inventory and 5150 cost adjustments (`MANUFACTURING_MAPPING_KEYS`).
- **21 default cost categories.** These are configurable data, not code:
  - materials, trims, packaging;
  - CMT per piece;
  - cutting, sewing, embroidery, printing, washing, finishing, assembly, overtime;
  - artwork, samples, setup (moulds / dies / screens);
  - freight, handling, inspection, duties;
  - allocated overhead;
  - other.

  The owner adds, renames, regroups and deactivates categories. A category is never deleted (trigger).
- **Hidden materials category:** `_materials`, inactive, so it never appears in the shop.

## 3. Materials (decision D-M1)

A material is a `Product` with `kind = MATERIAL`. Its variants carry the specification (`size`) and colour. Its
`stockUnit` (cm, g, pcs…) is the unit every quantity is counted in — stock stays a whole number of it.

- **Never sold:** the CHECK `Product_material_never_sold` keeps it inactive and unpublished. The single purchasability
  rule (`isActive`) keeps it out of every storefront and checkout path. It is excluded from the admin product list.
- **Bought and costed like any stock item:**
  - purchase orders and goods receipts (it appears in the purchasing variant lookup);
  - moving-average costing, valuation, the cutover and reconciliation checks — all unchanged.
- **Stock unit is locked once in use:** it can't change while the material holds stock.
- **Costs are visible** (average cost, value, reference cost) only to `costing.read`.

## 4. Bills of materials

`BillOfMaterials` (versioned per product) has these states:
- **DRAFT** — editable;
- **APPROVED** — frozen by trigger;
- **ARCHIVED.**

A change to an approved version is a new version (`copy`).

**A line:**
- names a stock-tracked material variant (never a variant of the product itself);
- gives its `qtyPerUnit` (6 dp, in the material's stock unit);
- gives its `wastagePct` (0–99.99, 2 dp);
- says who supplies it: **BUSINESS** (issued from stock and valued) or **PRODUCER** (inside the producer's price, never
  the business's inventory);
- applies to every variant of the product, or to one variant (e.g. extra fabric for XL).

**Requirements** (`requirements.ts`, pure, exact BigInt, unit-tested):

```
requirement(material, supplier) = ⌈ Σ applicable lines ( planned units × qty per unit × (1 + wastage%) ) ⌉ stock units
```

Lines for the same material and supplier are summed before rounding up. You can't issue part of a stock unit, and
rounding up never under-plans.

## 5. Production orders

`ProductionOrder` (MO-000001):
- one finished product;
- a producer (an existing `Supplier`, D-M6) or in-house;
- an approved BOM version (optional);
- agreed rate and terms;
- `ProductionOrderLine` per finished variant — **the order total is derived**;
- `ProductionMaterialLine` per requirement (`fromBom` marks BOM-derived lines; hand-added lines stay on re-plan);
- `ProductionPlannedCost` per cost category.

**Lifecycle** (trigger M-4): DRAFT → APPROVED → IN_PRODUCTION → PARTIALLY_RECEIVED ⇄ RECEIVED → CLOSED. CANCELLED is
possible from DRAFT or APPROVED, while nothing is issued. APPROVED → DRAFT is allowed while nothing is issued. Closed and
cancelled orders are final.

**Plan freeze** (trigger M-5): lines, materials and planned costs change only in DRAFT. Approval snapshots each
business-supplied material's moving-average cost (`plannedUnitCost`), which becomes the **planned material cost**.

**Derived planned figures:**
- planned units;
- planned material cost — Σ planned qty × snapshot cost. Materials with no known cost are counted and the total is shown
  as incomplete ("Not known yet" / "৳X+"), never as a misleading zero;
- planned other costs;
- total and per unit;
- stock shortfall per material.

## 6. M2 — Materials custody and work in progress [PROPOSED]

- **Issue** (`manufacturing.move_stock`):
  - stock moves out of the material variant via `recordDocumentMovements` (reason `PRODUCTION_ISSUE`, AVERAGE basis,
    DOCUMENT ledger owner);
  - `issuedQty` increases;
  - event `manufacturing.material_moved` posts **Dr 1630 WIP / Cr 1610** at the value the engine returns;
  - the first issue moves the order to IN_PRODUCTION.
- **Return** of unused material: inflow at the order line's average issued cost (DOCUMENT value); Dr 1610 / Cr 1630.
- **Consumption and scrap** are declared at reconciliation, not at issue. Custody (CHECK I-6):
  `issued = consumed + returned + scrapped + at producer`. At close, "at producer" must be 0.
- **Producer-supplied** materials are never issued (CHECK).
- **New check `manufacturing.wip`:** the 1630 balance = Σ open orders' WIP (issued value − returned value + accrued costs
  − value transferred to finished goods).

## 7. M3 — Production costs [PROPOSED]

`ProductionCostEntry`:
- category, amount, quantity × rate, payee supplier, reference, evidence;
- status DRAFT → APPROVED → INVOICED (4E) → PAID (via AP); VOID.
- **Approval** (`manufacturing.approve`, approver ≠ enterer) posts `manufacturing.cost_accrued`: **Dr 1630 / Cr 2116**.
- **Void:** a superseding revision reverses the accrual.
- **Duplicate guard:** unique (supplier, reference, category) when a reference is given.
- **AP link:** the supplier's invoice (4E) clears 2116 through a PRODUCTION_COST invoice line linked to the entry, so a
  cost is never counted twice.
- **Reporting:** planned vs actual per category, split into incurred / approved / invoiced / paid.

## 8. M4 — Deliveries, inspection and finished goods [PROPOSED]

`ProductionReceipt` (+ lines per order variant):
- delivered, accepted, rejected and rework quantities. **CHECK I-5:** delivered = accepted + rejected + rework.
- Multiple partial deliveries are allowed. Over-receipt needs approval.
- **Posting** (idempotent, unique movement per line):
  - accepted units → `recordDocumentMovements` (`PRODUCTION_RECEIPT`, DOCUMENT value = accepted × provisional unit
    cost, ESTIMATED until close);
  - event `manufacturing.goods_received`: **Dr 1610 / Cr 1630**.
- **Provisional unit cost** (D-M5) = (actual WIP to date + approved planned remainder) ÷ expected accepted units.
- **Rejected units never enter saleable stock.** They are returned to the producer (a claim) or written off with approval
  (5220).
- **Rework:** re-inspected later, then accepted or rejected.

## 9. M5 — Close, variance, late costs, reports [PROPOSED]

- **Close checklist:**
  - custody resolved (at producer = 0);
  - every cost approved, voided or explicitly excluded;
  - no draft receipts.
- **Final cost and true-up:**
  - final cost = WIP total; final unit cost = final cost ÷ accepted units (D-M4: normal rejects and wastage are absorbed;
    abnormal loss is an approved write-off to 5220);
  - the difference between final and provisionally transferred value is booked as a REVALUE of the units still held plus
    5150 for the share already sold (locked decision 11 — no COGS is rewritten);
  - WIP returns to 0.
- **Late costs after close:** the same REVALUE / 5150 path.
- **Reports:** planned vs actual by category, cost per accepted unit, cost per produced unit, wastage rate, yield,
  rejection rate, supplier performance (on time, rejects), open WIP.

## 10. Permissions

| Permission | OWNER | STAFF | FINANCE_ADMIN | ACCOUNTANT | FINANCE_VIEWER |
|---|---|---|---|---|---|
| `manufacturing.read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `manufacturing.manage` | ✓ | ✓ | ✓ | | |
| `manufacturing.approve` | ✓ | | ✓ | | |
| `manufacturing.move_stock` | ✓ | ✓ | | | |

Set-up needs `finance.configure`. Costs are shown only with `costing.read`.

## 11. API (`/api/v1/manufacturing`) — M1

| Route | Permission |
|---|---|
| `GET /status`, `/products` (lookup), `/cost-categories`, `/materials`, `/boms[/:id]`, `/production-orders[/:id]` | `manufacturing.read` |
| `POST /materials`, `PATCH /materials/:id`, `POST /boms`, `PATCH /boms/:id`, `DELETE /boms/:id`, `POST /boms/:id/copy`, `POST /production-orders`, `PATCH /production-orders/:id`, `DELETE /production-orders/:id`, `POST /production-orders/:id/cancel` | `manufacturing.manage` |
| `POST /cost-categories`, `PATCH /cost-categories/:id`, `POST /boms/:id/approve`, `/boms/:id/archive`, `/production-orders/:id/approve`, `/production-orders/:id/reopen` | `manufacturing.approve` |
| `POST /setup` | `finance.configure` |

There are 25 routes, giving 477 admin routes in total.

**UI:** Inventory → Stock · Production orders (list, create with a size × colour grid, detail with plan, materials vs
stock, planned costs) · Bills of materials (versions per product, approve, copy) · Materials. Manufacturing sits inside
Inventory to keep the 12 primary modules.

## 12. Database

Migrations:
- `20261018100000_manufacturing_foundation` (M-1…M-7);
- `20261018100100_manufacturing_material_source` (`fromBom`, plan guard).

| Invariant | Rule |
|---|---|
| M-1 | A material is never active or published and has a stock unit. |
| M-2 | Positive quantities; wastage < 100%; custody I-6; producer-supplied lines are never issued. |
| M-3 | BOM lifecycle; approved versions frozen. |
| M-4 | Production-order lifecycle; no reopen or cancel after an issue; the product / BOM / producer is fixed once approved. |
| M-5 | The plan is frozen outside DRAFT (only the custody columns move while in production). |
| M-6 | Cost categories are never deleted; their code never changes. |
| M-7 | An audit entry at commit for every BOM / order / category change; no TRUNCATE. |

## 13. Verification (M1)

- `requirements.test.ts` (5): exact 39,000 cm for 1,000 caps; rounding up; variant-specific and combined lines; bad
  input.
- `manufacturing-foundation.integration.test.ts` (10, real database):
  - **set-up:** idempotent; 1630 mapped; 21 categories; hidden category; categories can't be deleted;
  - **materials:** never sold (CHECK, `isPurchasable`, admin list); purchasable via the lookup; unit locked once
    stocked; cost redaction;
  - **BOM:** self and material-product refused; approver-only; frozen (service and DB); copy → v2;
  - **orders:** grid lines; requirement ⌈1,100 × 37.5 × 1.04 + 100 × 5.5 × 1.04⌉ = 43,472; producer-supplied labels;
    hand-added material; a draft BOM refused; re-plan on edit (39,000) keeps hand-added lines; approval snapshot
    (39,000 cm × ৳0.10 = ৳3,900); cost hidden without `costing.read`; frozen plan; illegal transition refused;
    reopen clears snapshots; cancel; final;
  - **HTTP:** decimal strings accepted, 7 decimals refused, materials excluded from the product lookup.
- `manufacturing-writers.guard.test.ts` (2).
- Authorization matrix: 477 routes, +7 owner-only for STAFF.
- Web navigation test: the Inventory grouping.
- Browser QA (`finance_qa`, 1440 and 375 px), all through the UI:
  - set-up → material (cm) → BOM v1 (37.5 cm + 4%) approved → production order 400 units by Dhaka Caps → approved;
  - requirement 15,600 cm, short 15,600 cm;
  - planned cost shown as "Not known yet" (no cost known for the material).
