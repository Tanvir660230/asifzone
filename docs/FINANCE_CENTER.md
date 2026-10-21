# Finance Center — audit, what was added, and the owner's figures

Status: implemented 2026-10-21 on `feat/owner-books` (local, not deployed). Builds on the Financial Core
(`docs/FINANCE_*.md`), manufacturing (`docs/MANUFACTURING.md`) and the owner's books (`docs/FINANCE_OWNER_BOOKS.md`).

## 1. Audit — what already existed

The owner's specification (2026-10-21) asked for a complete finance & inventory centre. Most of it was already in the
codebase, as one ledger fed by the shop's own records — no second source of truth:

| Spec section | Where it lives |
|---|---|
| Overview, KPIs, alerts | Finance › Overview (money map), Needs attention (alerts), Owner's summary (new) |
| Transactions & expense ledger | Ledger, Journals, Expenses, Money accounts (Treasury: idempotent, approvals, reversal, no overdraft) |
| Product costing, inventory valuation | AVCO costing (`costing.service`), valuation cutover, Profit by order & product |
| Raw materials, bulk attar, bottles, packaging | Manufacturing materials (stock unit ml / pcs), packing rules, packaging use |
| Production & filling | Quick refill on the manufacturing engine (recipe → issue → receive → close at cost), idempotent |
| Orders, delivery, returns | Commerce projection (revenue at delivery, COGS once), courier rate cards (55 / 115 estimates), Steadfast payout import (actual charges replace estimates), claims |
| Suppliers & purchases | Purchase orders, goods receipts, supplier bills, payments, returns, landed costs |
| Cash flow, P&L, balance sheet | Financial statements, budgets & forecast |
| Reconciliation | Checks (ledger integrity, clearing, charges accrued, …), exceptions, bank reconciliation |
| Access control & audit | Server-side permissions per route (authorization matrix test), finance audit log, DB triggers (immutability, no truncate) |
| Fixed assets (printer, logo, website) | Fixed assets with depreciation |
| Subscriptions (VPS, domain) | Prepaid costs (month-by-month share) |
| Advertising | Ad accounts, campaigns, daily spend (Meta API / manual), orders and profit after ads |

## 2. What was missing, and was added

| Gap | Added |
|---|---|
| A reported or reconstructed figure looked the same as a checked one | **Verification status** beside any record (`FinanceVerification`: CONFIRMED / ESTIMATED / NEEDS_CHECK / DISPUTED, with source and note, audited). The record itself never changes. Owner's summary › To check. |
| A cost serving several purposes (vehicle ৳10,000) had nowhere to wait | **6990 Expenses awaiting allocation** + split (`ExpenseAllocation`): parts to expense/asset accounts, optionally a product; posted as a reclass from 6990, restated (never added) on change; parts can't exceed the expense (service check + deferred DB trigger). |
| Changing a campaign budget rewrote every past planned day | **Budget history** (`AdBudgetChange`): each day uses the budget in force that day. |
| Ad spend only in taka | **USD spend**: original amount, rate, taka; the default rate (Settings, e.g. 122) marks the day an ESTIMATE until the card's rate or taka figure is entered. |
| No CSV import of ad spend | **CSV import** (Meta export or any day/campaign/amount sheet): preview, line errors, duplicate campaign-days refused, idempotent (same file twice adds nothing), all-or-nothing. |
| No renewal reminders | Prepaid costs get **remind N days before** and **expected renewal cost**; Renewals view and alert; a later prepaid cost of the same name marks it renewed. |
| No SMS balance tracking | **SMS**: recharges are expenses to **6410 SMS** (the cash cost); balance readings (BulkSMSBD balance endpoint when connected — not yet checked against the live account — else typed in); usage = drop + recharges between readings (information only, never posted again); days left; low-balance alert. |
| No "how much have I put in" / missing-data view | **Owner's summary**: net invested (capital + opening equity + paid from pocket − drawings, from the ledger), figures not confirmed, and a missing-data list (products without cost, costs to split, estimates, unvalued opening stock, campaigns without actual spend, renewals due, attars without a refill recipe). |

API: `/api/v1/finance/center/*`, `POST /ads/import-csv` (11 routes; authorization matrix 651). Migration
`20261121100000_finance_center` (additive; also allows `CSV` as an ad-spend source).

## 3. The owner's figures (2026-10-21), checked

Arithmetic, recomputed from the entries:

| Group | Entries | Total |
|---|---|---|
| Tupi | 256 × ৳575 = 147,200; packaging 256 × ৳12 = 3,072 | **150,272** (৳587 a piece) |
| Attar packaging | boxes 1,500 = 75,000 (৳50 each); bubble poly 2 rolls = 4,000; black poly 1,000 = 1,600 (৳1.60); stickers 9 × 500 = 4,500 = 2,270 (৳0.5044 each) | **82,870** |
| Technical | website 23,000; VPS USD 130 × 122 = 15,860; domain USD 12 × 122 = 1,464; EPS 6,000; printer 8,000; logo 5,000 | **59,324** (61,594 in the owner's list includes the stickers again) |
| Known-cost aggregate | 150,272 + 82,870 + 59,324 | **292,466** (provisional; vehicle ৳10,000 separate → 302,466 if confirmed) |

**Correction:** the indicative bulk-attar value is 200×38 + 200×16 + 200×21 + 460×24 = 7,600 + 3,200 + 4,200 + 11,040 =
**৳26,040**, not ৳23,360 as written. Empty bottles: 120 × 50 + 250 × 52 = ৳19,000. Neither is a cash expense.

Where each figure goes (one transaction each — the stickers once):

| Figure | Recorded as | Status until proven |
|---|---|---|
| Tupi purchase + packaging | Opening stock at ৳587 per piece (if bought before the books start) or a goods receipt | NEEDS_CHECK (no invoice) |
| Boxes, polys, stickers | Packaging materials stock at their unit cost; used by packing rules / refill recipes | NEEDS_CHECK |
| Bulk attar (ml), empty bottles | Opening material stock — reported counts | ESTIMATED until a physical count |
| Website, printer, logo | Fixed assets (5 / 3 / 10 years) | CONFIRMED amounts, dates NEEDS_CHECK |
| VPS, domain | Prepaid costs ending 2027-10-03 / 2027-09-15, reminders on | CONFIRMED (USD at 122 = ESTIMATED until the card statement) |
| EPS ৳6,000 | Asset (lifetime setup) or expense — owner's choice | NEEDS_CHECK |
| Vehicle ৳10,000 | Expense to 6990, split when known | NEEDS_CHECK |
| SMS ৳2,000 recharge | Expense to 6410 SMS on its date; ৳1,000/month is an estimate, not a second expense | NEEDS_CHECK |

## 4. Reconciliation findings from the shop's own records (copy of production as of 2026-10-06)

- **Tupi:** the catalog shows 199 pieces entered when the cap products were created + 48 entered as restock = **247**,
  against **256** bought → **9 never entered**. The first Steadfast payout has 11 parcels booked straight on Steadfast
  (৳9,169 ≈ 10 caps at ৳899) — likely the same pieces sold before the website took orders. 114 manual stock edits
  carry no reason ("Manual edit via product form"), so the current stock needs a **physical count**.
- **Attar (6 ml, as of 2026-10-06):** bottles sold-not-cancelled + in stock — Zayan 97 (582 ml), Royal Amber 90
  (540 ml), Sweet Luxe 98 (588 ml). With the reported remaining bulk this implies at least 1,042 / 740 / 788 ml bought
  (before wastage and later fills) — an estimate, never posted. Azhar Elite and the 12 ml sizes were added after this
  copy; a fresh production snapshot is needed (read-only fetch — see §5).
- **Orders:** first order 2026-08-11 (earliest reliable sales date); first stock movement 2026-08-07.

## 5. Still needed from the owner

1. The books' start date (proposed **2026-08-01**, before the first stock movement).
2. Who paid each historical cost — owner's own money (→ owner capital) or a business account.
3. Purchase dates (a month is enough) for tupi, packaging, attar oil, bottles, printer, logo, website, EPS.
4. Physical count now: caps by colour/size, filled attar bottles by size, bulk ml, empty bottles, boxes, polys, stickers.
5. Whether a 12 ml bottle uses the same box and sticker as a 6 ml.
6. Ad spend so far (Ads Manager CSV export) and the card's taka charges.
7. Vehicle ৳10,000: when, and roughly what for.
8. SMS: recharge date(s) and today's balance.
9. Cash, bKash and bank balances on the start date.

A fresh read-only production snapshot (`apps/api/scripts/demo-data/fetch-snapshot.ts` — taken 2026-10-21) could not be
imported locally: the import step was blocked by the session's permission rules as a production read. The owner can
allow it or run `INSTALL_ID=books npx tsx scripts/demo-data/import.ts --skip-media` in `apps/api`.

## 6. Tests

`finance-center.integration.test.ts` (9): budget change keeps past days; USD exact vs estimate vs refused; CSV preview,
all-or-nothing, re-import adds nothing; split ≤ expense (service and DB), restated not added; only 6990 expenses split;
renewal reminder, alert and renewed; SMS usage with a recharge and the low alert; verification listed, summarised,
disputed needs a note, audited. `finance-center.test.ts` (9): the pure rules.

## 7. Stock check (added 2026-10-21, second pass)

Finance › Reports & books › **Stock check** (`GET /center/stock-check`) rebuilds where every unit went from the shop's
own records. It never changes stock or the books, and nothing is forced to balance.

- **Products:** units through the site = units still out on orders (not cancelled, less what was put back) + stock
  now. They are split into units that came in on a document (goods or production receipt) and units typed into the
  product form. It also shows stock edits made without a reason, a total per category (all colours and sizes), and
  the latest count.
- **Materials:** used = each product's latest approved recipe × its units through the site. Bought at least = used +
  what is left (the latest count, else the site stock), before wastage and samples.
- **Counts** (`StockCount`, `POST /center/stock-counts`): recorded beside the site's stock, never written into it.
  They can't be edited (trigger); count again to replace one. A correction stays an ordinary stock adjustment with a
  reason.
- **Rolls** (`MaterialRoll`, `POST /center/rolls`, `/rolls/:id/finish`): bubble poly and similar. A roll's parcels are
  the courier bookings between opening and finishing it, unless the parcels were counted by hand. A cost per parcel
  exists only for a finished roll.
- **Parcels sent straight through Steadfast:** payout lines with no order, and whether each was counted as a sale
  outside the website. Also counted: shipped orders with no courier booking, partial deliveries not settled, and
  returns not put back in stock.
- CSV export. Migration `20261122100000_stock_check`; 5 routes (authorization matrix 656); tests
  `finance-stock-check.integration.test.ts` (6).

### Findings on a copy of production (2026-10-20 snapshot, staging DB `books_demo`)

**Caps**
- 273 through the site: 195 delivered, 24 partly delivered, 3 returned and not put back, 6 on the way or waiting,
  45 in stock.
- The owner confirmed the site's 45 in stock.
- About 10 more went out straight through Steadfast before the site (11 parcels, ৳9,169).
- So about 283 were bought, not 256. The 273 is the same on the 2026-10-06 copy, so no caps were added since.

**Attar**
- 947 bottles filled: 675 × 6 ml and 272 × 12 ml. Of these, 546 delivered.

| Oil | Used | Counted | Bought at least |
|---|---|---|---|
| Azhar Elite | 2,424 ml | 200 | 2,624 ml |
| Royal Amber | 2,166 ml | 200 | 2,366 ml |
| Sweet Lux | 1,206 ml | 200 | 1,406 ml |
| Zayan Elixir | 1,518 ml | 460 | 1,978 ml |

**Bottles and boxes**
- Bottles: 795 × 6 ml and 522 × 12 ml bought at least, against 120 and 250 counted.
- Boxes: 947 used + 553 counted = **1,500**, exactly the purchase. This confirms one box per bottle.
- The "202 bottles" quoted earlier counted every order that wasn't cancelled. It was never a count of sales.

**Bubble poly**
- Roll 1 ran from the first courier booking (2026-08-13, assumed) to 2026-10-20 (owner): 872 parcels, about ৳2.29 a
  parcel. Roll 2 is in use.

**Still open**
- 42 partly delivered orders not settled. The admin settles them.
- 3 returns not put back in stock.
- 10 shipped or delivered orders with no courier booking.
