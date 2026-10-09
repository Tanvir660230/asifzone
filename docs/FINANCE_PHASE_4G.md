# Financial Core — Phase 4G: Purchasing, payables and inventory reports

Status: **implemented and verified (2026-10-09)**. The reports are read-only, derived from documents and the ledger (no
report table). Each total names the account or check it agrees with. Built on 4C–4F and M1–M5.

## 1. Reports (`/api/v1/purchasing/reports/*`)

| Report | What it shows | Ties to | Permission |
|---|---|---|---|
| `purchase-register` (period, supplier) | Per supplier: received (posted receipts), billed, credited, net billed. Every receipt and bill is listed. | posted documents of the period | `purchasing.read` |
| `grni-ageing` | Goods received but not billed, per receipt line, by age (0–30 / 31–60 / 61–90 / 90+ days from receipt). Also goods returned but not yet credited. | receivedNotBilled − returnedNotCredited = **the GRNI account** (`purchasing.grni`) | `purchasing.read` |
| `price-variance` (period, supplier) | Each billed stock line: ordered vs billed unit price, variance % and amount, and the price difference booked to cost. | booked = the bills' revaluations (stock held) + their 5150 share | `purchasing.read` |
| `inventory-valuation` (search) | Per variant: stock, valued and unvalued quantity, average, value, and whether the cost is complete. Split into finished goods and materials. | total = the valuation side of `inventory.valuation_vs_ledger` | `costing.read` |
| `cost-adjustments` (period) | The cost-adjustment account (5150) by origin. Reversals count under the origin they reverse. | net = the account's movement | `costing.read` |
| `supplier-payments` (period, supplier) | Each payment: account, reference, status, amount, what it settled, advance. | posted total = the payments in `payables.subledger` | `ap.read` |

The cost-adjustment origins are:

- **stock movements** — deficit cover, rounding, stale snapshots;
- **supplier price differences** — the share already sold;
- **production final cost and late costs** — the share already sold;
- **credit notes** — the difference to the value the returned goods left at;
- **the valuation cutover true-up**.

That adds 6 routes, 511 admin routes in total. STAFF keeps the three purchasing reports; the cost and payables ones are
refused.

## 2. UI

Finance → **Purchasing reports**:

- Pick a report (only the ones the role may see), with a period and a search where they apply.
- Each total shows as a card, with a one-line note on what it agrees with.
- The table scrolls inside its card at 375 px.
- **CSV** export: RFC 4180 quoting with a UTF-8 BOM. A text cell starting with `= + - @` is prefixed with a quote so a
  spreadsheet never runs it as a formula (`lib/csv.ts`).

## 3. Verified

- `finance-payables.integration.test.ts` +1 (11 tests). On the real chain after bills, credits, payments, voids and
  reversals:
  - GRNI ageing = the GRNI account (৳2,616 not billed);
  - valuation total = Σ cost positions;
  - cost adjustments net = the 5150 balance, by origin (credit and price only — reversals counted with their originals);
  - payments register posted total = Σ posted payments, statuses posted / rejected / reversed;
  - purchase register received ৳2,616, billed ৳1,500, credited ৳100.
- Authorization matrix: 511 routes.
- Browser QA (`finance_qa`):
  - received ৳17,700, billed ৳20,600;
  - GRNI ৳12,650.94 — the same figure as the GRNI check;
  - price variance ৳200 booked ৳200;
  - inventory ৳302,742.94 — the same figure as the inventory check (materials ৳624);
  - 5150 net −৳548;
  - payments ৳15,000;
  - 1440 and 375 px.

## 4. Next

The general ledger workspace and financial statements — trial balance, income statement, balance sheet, cash flow — are
**E6**.
