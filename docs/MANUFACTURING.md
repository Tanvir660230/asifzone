# Manufacturing — production orders, materials, costs and finished goods

Status: **M1–M4 implemented and verified (2026-10-09)** — foundation, materials custody & WIP, production costs, and deliveries / inspection / finished goods. M5 (close, variance, late costs, reports) is designed here and built next. The roadmap
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

## 6. M2 — Materials custody and work in progress (implemented)

- **Issue** (`POST /production-orders/:id/issue`, `manufacturing.move_stock`, Idempotency-Key):
  - business-supplied material leaves stock via `recordDocumentMovements` (reason `PRODUCTION_ISSUE`, AVERAGE basis,
    DOCUMENT ledger owner), at the moving average;
  - one append-only `ProductionMaterialMove` per line (value, valuation status, stock movement);
  - event `manufacturing.material_moved` posts **Dr 1630 WIP / Cr 1610** with the order as party;
  - the first issue moves the order to IN_PRODUCTION;
  - issuing beyond the plan needs `manufacturing.approve` and a reason (kept on the move);
  - more than the stock on hand is refused;
  - producer-supplied lines are never issued (service and trigger).
- **Return** (`POST …/return`):
  - only what is still with the producer (issued − returned − consumed − scrapped) can come back;
  - it comes back at the line's average issued cost (net issued value × qty ÷ net issued qty, half-even) as a DOCUMENT
    inflow, or unvalued if the issue had no known cost;
  - posts **Dr 1610 / Cr 1630**.
- **Usage** (`PUT …/material-usage`, `manufacturing.manage`): consumed and scrapped are declared as totals while the order
  is in production. Nothing posts — the value stays in WIP and becomes the finished goods' cost (M4/M5).
- **Database:**
  - `issuedQty` / `returnedQty` are derived from the moves by trigger (W-3); a direct write is refused;
  - the custody CHECK I-6 holds: issued ≥ returned + consumed + scrapped;
  - moves are append-only, belong to their order, need a business-supplied line and an open order (W-2);
  - audit at commit; no TRUNCATE.
- **Check `manufacturing.wip`:** the 1630 balance = Σ issued − returned move values, both in total and per order (party).
  It also flags unposted manufacturing events (events a rule ignores are not flagged).
- **UI:** on the production order:
  - Issue materials / Return unused / Record usage;
  - custody columns: issued (value), used · scrap · back, with producer;
  - an "In work in progress" figure;
  - the material movement history.
- **Verified:**
  - `manufacturing-custody.integration.test.ts` (4): real cutover, then a purchase (PO → GRN) of 50,000 cm @ ৳0.10;
  - issue 20,000 → WIP ৳2,000, IN_PRODUCTION, idempotent replay;
  - over-plan needs an approver and a reason; the producer's line refused; more than stock refused; derived quantity
    write refused; cancel after issue refused;
  - usage within custody; return capped at custody, valued at ৳100 for 1,000 cm; WIP ৳3,850; moves append-only;
  - after every step: `manufacturing.wip`, `inventory.valuation_vs_ledger`, `quantity_vs_valuation`,
    `valuation_postings`, `purchasing.grni`, `ledger.integrity` and `events.unposted` all MATCHED.
  - Browser QA (`finance_qa`): 20,000 cm received @ ৳0.12; issue 15,600; usage 14,800 / 400; return 400 → WIP ৳1,824
    = 15,200 × ৳0.12; all seven checks "matches"; 375 px without overflow.

## 7. M3 — Production costs (implemented)

- **`ProductionCostEntry`** has:
  - a configurable category;
  - a payee supplier (or none for an internal cost);
  - a reference (bill or challan), a description, a date and evidence;
  - **quantity × rate** (≤ 4 / ≤ 6 decimals; amount = their product, half-even, in BigInt) **or an amount**.

  It is entered on an approved, open order (`manufacturing.manage`).
- **Lifecycle** (trigger C-3): DRAFT → APPROVED → VOID (or DRAFT → VOID).
  - An approved cost is immutable except voiding. Only drafts are deleted. A void is final.
  - **The approver is never the person who entered it** — enforced by the service and by the trigger.
- **Approval** (`manufacturing.approve`, idempotent) records `manufacturing.cost_accrued`: **Dr 1630 WIP** (the order as
  party) / **Cr 2116 production costs accrued** (the supplier as party).
- **Void** of an approved cost records the void revision `#r1`, which supersedes `#r0`; the accrual journal is reversed.
- **No double capture:** a partial unique index allows one live entry per (supplier, category, reference — trimmed, case-
  insensitive). The supplier's invoice clears 2116 in Phase 4E instead of adding a second cost.
- **Order view:**
  - the cost list;
  - **planned vs actual** — materials (plan snapshot vs net issued value) and each category (planned vs approved);
  - variances and the total;
  - costs awaiting approval;
  - WIP = materials + approved costs;
  - aggregated cost figures need `costing.read`.
- **Checks:**
  - `manufacturing.wip` now includes approved costs (in total and per order);
  - new `manufacturing.production_accrual`: the 2116 balance = Σ approved costs not yet invoiced.
- **API:**
  - `POST /production-orders/:id/costs`, `PATCH /production-costs/:id` and `DELETE /production-costs/:id`
    (`manufacturing.manage`);
  - `POST /production-costs/:id/approve` and `POST /production-costs/:id/void` (`manufacturing.approve`);
  - 486 admin routes in total.
- **UI:** the Production costs section on the order:
  - add / edit drafts (quantity × rate or amount);
  - Approve, hidden from whoever entered the cost;
  - Void with a reason; Delete a draft;
  - the planned-vs-actual table.
- **Verified:**
  - `manufacturing-custody.integration.test.ts` now has 7 tests:
    - 1,000 × 45.5 = ৳45,500, edited to ৳45,000;
    - duplicate reference refused (case and space insensitive);
    - amount *and* rate refused;
    - STAFF can't approve; the enterer can't approve; approval is idempotent;
    - WIP +৳46,200; immutable once approved;
    - comparison and WIP agree;
    - void reverses −৳45,000, and the reference can be reused;
    - checks after each step, including `manufacturing.production_accrual`, all MATCHED.
  - Browser QA: the owner entered 400 × ৳45 and saw no Approve button; a second owner approved it; actual ৳19,824 =
    ৳1,824 materials + ৳18,000; all checks "matches".

## 8. M4 — Deliveries, inspection and finished goods (implemented)

- **`ProductionReceipt`** (PR-000001) records, per finished variant, delivered / accepted / rejected / rework (CHECK R-1:
  delivered = accepted + rejected + rework), plus reject reasons, delivery note, inspection notes and evidence.
  - Many partial deliveries are allowed.
  - Created as a draft (`manufacturing.manage`); posted with `manufacturing.move_stock`.
- **Posting** (idempotent; concurrent posts → one posts, one replays):
  - accepted units → `recordDocumentMovements` (`PRODUCTION_RECEIPT`, DOCUMENT value, **ESTIMATED**);
  - event `manufacturing.goods_received`: **Dr 1610 / Cr 1630** (the order as party);
  - status POSTED; the database derives the order lines' delivered / accepted / rejected / rework (R-3; a direct write is
    refused);
  - the order becomes PARTIALLY_RECEIVED or RECEIVED (audited).
  - Accepting beyond the plan needs `manufacturing.approve` and a reason.
- **Provisional unit cost** (D-M5) = max(actual cost to date, the planned total — only if the plan is complete) ÷ planned
  units, half-even.
  - Actual = material issued − returned + approved costs.
  - **Zero is refused** (`PROVISIONAL_COST_UNKNOWN`): goods never enter stock at zero cost.
  - It is stored on the receipt and its lines (value = accepted × unit cost).
- **Rejected units** never become stock. Their cost stays in the order (D-M4) and is reported as rejects.
- **Reversal** (`manufacturing.approve`, with a reason):
  - accepted units leave at the receipt's own unit cost (SNAPSHOT);
  - void revision `#r1` supersedes `#r0`;
  - the order status follows;
  - refused if the units are no longer in stock (sold).
- **Ledger bridge refinement:** the `inventory.valuation_vs_ledger` "estimates since activation" term now counts only
  commerce estimate postings. A production or purchasing line tagged ESTIMATED moves value the valuation holds.
- **`manufacturing.wip`** = materials + approved costs − value transferred to finished goods by posted receipts (in total
  and per order).
- **Order view:**
  - progress: planned / delivered / accepted / rejected / still due;
  - per-variant table;
  - receipts with value and provisional unit cost;
  - WIP shows the transfer to stock.
- **API:**
  - `POST /production-orders/:id/receipts` and `DELETE /production-receipts/:id` (manage);
  - `POST /production-receipts/:id/post` (move_stock);
  - `POST /production-receipts/:id/reverse` (approve);
  - 490 admin routes in total.
- **UI:** the Deliveries section. "Record delivery" is a per-variant inspection grid (accepted / rejected / rework / reason;
  delivered = their sum) with Save draft or Post to stock. Drafts can be posted or deleted; posted receipts reversed.
- **Verified:**
  - `manufacturing-custody.integration.test.ts` now has 11 tests:
    - reconciliation and reject reasons enforced;
    - provisional cost 49,050 ÷ 1,000 = ৳49.05, so 400 accepted → ৳19,620 into stock, and WIP −৳19,620;
    - a concurrent post posts once;
    - order lines derived (415 / 400 / 10 / 5, outstanding 600) and the derived write refused; the posted receipt
      immutable;
    - over-plan needs an approver → RECEIVED;
    - reversal back to PARTIALLY_RECEIVED;
    - zero-cost receipt refused;
    - every check MATCHED after each step.
  - Full API regression: 1284 / 1284.
  - Browser QA: 300 accepted / 5 rejected / 3 rework at ৳49.56 = ৳14,868; partly received; all seven checks "matches";
    375 px.

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

There are 25 routes, giving 477 admin routes in total. M2 adds four: `GET /production-orders/:id/moves`, `POST …/issue` and `POST …/return` (`manufacturing.move_stock`), and `PUT …/material-usage` (`manufacturing.manage`), for 481 in total.

**UI:** Inventory → Stock · Production orders (list, create with a size × colour grid, detail with plan, materials vs
stock, planned costs) · Bills of materials (versions per product, approve, copy) · Materials. Manufacturing sits inside
Inventory to keep the 12 primary modules.

## 12. Database

Migrations:
- `20261018100000_manufacturing_foundation` (M-1…M-7);
- `20261018100100_manufacturing_material_source` (`fromBom`, plan guard);
- `20261019100000_manufacturing_material_custody` (M2: W-1…W-4, plan guard extended);
- `20261020100000_manufacturing_production_costs` (M3: C-1…C-4);
- `20261021100000_manufacturing_receipts` (M4: R-1…R-4, plan guard extended).

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
