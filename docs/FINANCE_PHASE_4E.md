# Financial Core — Phase 4E: Supplier invoices, credit notes and accounts payable

Status: **implemented and verified (2026-10-09)**. It builds on 4D purchasing (`FINANCE_PHASE_4D.md`) and on the M5
revaluation path (`MANUFACTURING.md` §9). Payments (4F) come next; until then every posted bill is fully outstanding.
The locked owner decisions are in `FINANCE_PHASE_4.md` §2 — this phase implements 11, 12, 13 and 14.

## 1. The documents

A **supplier invoice** (`BILL-000001`) or **credit note** (`CN-000001`) records the supplier's own document number
(`supplierRef`), its date and due date. The due date defaults to the invoice date plus the supplier's payment terms.

| | |
|---|---|
| Lifecycle | DRAFT → POSTED → VOID. Drafts are edited or deleted; a posted document is immutable and is corrected by voiding it (with a reason) and entering it again. |
| Duplicate bills | The supplier's reference is unique per supplier and kind while the document is live (`lower(trim(ref))`), so the same bill can't be entered twice. |
| Permissions | `ap.read` to see, `ap.manage` to enter, post and void (OWNER, FINANCE_ADMIN, ACCOUNTANT — no STAFF). A unit price beyond the business's **invoice price tolerance** against the order needs `purchasing.approve` and a reason (`varianceReason`). |

### Line types

| Line | On | Matches | Rule |
|---|---|---|---|
| `STOCK` | invoice | a posted goods-receipt line of the same supplier (3-way: order → receipt → bill) | quantity ≤ received − already invoiced |
| `RETURN` | credit note | a shipped supplier-return line of the same supplier | quantity ≤ returned − already credited |
| `EXPENSE` | both | an expense (or asset) account; optionally an order's service / expense line (2-way) | quantity ≤ ordered − already invoiced |
| `PRODUCTION_COST` | invoice | an approved production cost of the same payee | its net amount = the approved amount exactly; one live bill per cost |

Tax per line comes from a purchase tax code: tax = net × rate, and the recoverable share is tax × recoverable %. Both are
exact and rounded half-even.

## 2. Posting (one transaction, exactly once)

Matching is re-checked under locks (the receipts and production costs a bill touches are locked in id order, so two
bills — or a bill and a receipt reversal — can't race). Then:

| Line | Journal (an invoice; a credit note is the mirror) |
|---|---|
| `STOCK` | Dr **GRNI** at the receipt's value (qty × the receipt's unit cost). The billed cost is net + the non-recoverable tax; the difference is a **price difference**: Dr/Cr **inventory**, booked through `costing.service.revalueForDocumentInTx`. The share of units still held revalues the stock (and its average); the share already gone becomes an `inventory.valued` cost adjustment to **5150**. No cost of sales is rewritten. |
| `RETURN` | Cr **supplier returns** (2115 alias) at the value the goods left at. The difference to the credited cost goes to `cogs.purchase_price_differences` (5150), because the goods are gone. |
| `EXPENSE` | Dr the line's account (net). |
| `PRODUCTION_COST` | Dr **production costs accrued** (2116) — the accrual made at approval is cleared, never doubled. |
| tax | recoverable → `asset.vat_input` (the code's mapping); non-recoverable on expense and production-cost lines → `expense.non_recoverable_tax` (on stock lines it is part of the cost). |
| total | Cr **trade payables** (2110). The supplier is the party on every line. |

The event `payables.invoice_posted` carries the computed lines. The rule checks that every key is one a payables
document may touch and that the lines balance. **Void** posts revision `#r1`, which supersedes the original — the
journal is reversed — and undoes the price-difference revaluation (held share off the stock, the rest off 5150).

Guards that keep billed documents consistent:

- A goods receipt on a live bill can't be reversed (`RECEIPT_INVOICED`).
- An invoiced production cost can't be voided (`COST_INVOICED`).

## 3. Reports and checks

- **Open items** (`GET /supplier-invoices/open-items?supplierId=`) list everything a supplier can bill now, and are the
  bill-entry picker:
  - goods received and not invoiced (with ordered price and receipt cost);
  - returns shipped and not credited;
  - approved production costs not invoiced;
  - ordered services not invoiced.
- **Payables ageing** (`GET /payables/ageing`) shows posted bills by days past due (not yet due, 1–30, 31–60, 61–90,
  90+) per supplier, less unapplied credit notes.
- **Checks:**
  - `payables.subledger` (new): the trade-payables account = posted bills − posted credit notes, in total and per
    supplier party; unposted payables events are listed.
  - `purchasing.grni`: receipts − invoiced (cleared) − returns not yet credited.
  - `manufacturing.production_accrual`: approved costs − invoiced.

## 4. API (`/api/v1/purchasing`)

| Route | Permission |
|---|---|
| `GET /supplier-invoices`, `/supplier-invoices/open-items`, `/supplier-invoices/:id`, `/payables/ageing` | `ap.read` |
| `POST /supplier-invoices`, `PATCH /supplier-invoices/:id`, `DELETE /supplier-invoices/:id`, `POST /supplier-invoices/:id/post`, `POST /supplier-invoices/:id/void` | `ap.manage` |

That is 9 routes, 501 admin routes in total. `PATCH /settings` also takes `invoicePriceTolerancePct`.

**UI:** Finance → **Supplier bills**: a list with filters, then "New bill" / "Credit note". Entry picks from the
supplier's open items, with per-line quantity, price and tax, plus free expense lines; then save as a draft or post. A
price beyond tolerance asks an approver for the reason. Finance → **Payables**: the ageing table and totals.

## 5. Database

Migration `20261023100000_finance_phase4e_payables`:

| Invariant | Rule |
|---|---|
| P-1 | Values. A posted document carries net, tax and total = net + tax. A void carries its time and reason. Due ≥ invoice date. Each line: net = quantity × unit price; 0 ≤ recoverable ≤ tax; the line type names exactly what it bills (CHECK). |
| P-2 | The supplier's reference is unique per supplier and kind while live (partial unique index). |
| P-3 | Lifecycle DRAFT → POSTED → VOID. A posted document is immutable; only drafts are deleted. Lines change only on a draft, except that posting records what each line cleared, once. Goods and production costs go only on an invoice, returns only on a credit note. |
| P-4 | An audit entry at commit; no TRUNCATE. |

## 6. Verified

- `finance-payables.integration.test.ts` (6 tests, real chain: opening → cutover → PO → GRN):
  - tax maths (half-even);
  - open items; over-billing refused; credit-note kind refused; drafts edited and deleted; duplicate reference refused;
  - posting:
    - the variance needs an approver and a reason, and concurrent posts post once;
    - 20 × 125 + 15% tax (40% recoverable): GRNI cleared ৳2,616, price difference ৳109; with 5 of 20 units held, ৳27.25 revalues the stock and ৳81.75 goes to 5150;
    - payables ৳3,450, VAT input ৳180, non-recoverable tax ৳45;
    - reversal of the billed receipt refused; the document is immutable;
  - credit note against a shipped return of 3: the returns liability is cleared at the value they left at, and the difference goes to 5150;
  - ageing: ৳3,450 − ৳431.25 credit = ৳3,018.75;
  - void: −৳10.90 off the stock with 2 held, GRNI back to ৳2,616, and the goods billable again.
  - Every check MATCHED after each step.
- `manufacturing-custody.integration.test.ts` +1: a production-cost bill at exactly the approved ৳44,000 clears the
  accrual; voiding the invoiced cost is refused; voiding the bill brings the accrual back. All checks match.
- Full API regression: 110 files, 1295 / 1295. Web tsc, eslint, vitest 35.
- Browser QA (`finance_qa`):
  - a bill for 20,000 m twill at ৳0.13 (ordered ৳0.12) plus the ৳18,000 stitching cost;
  - the variance was asked for and approved;
  - GRNI ৳15,050.94 → ৳12,650.94; production accrual ৳18,000 → ৳0; payables ৳20,600;
  - inventory +৳48 = 4,800 m held ÷ 20,000 × ৳200; the rest to 5150;
  - every check matches; payables and bills pages fine at 1440 and 375 px.

## 7. Limitations / next

- **Material already issued to production.** A price difference on such material goes to 5150 (the held / sold rule),
  not to that production order's cost. Tracing material cost into a closed order is a possible later refinement.
- **Currency.** One currency (the books'); foreign-currency bills are 4H.
- **Payments.** Payments, allocation of credit notes to bills, and supplier statements come with **4F**.
