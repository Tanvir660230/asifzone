# Financial Core — Budgets, cash forecast and runway (ERP programme E12)

Status: **implemented and verified (2026-10-09)**.

## 1. Budgets

A **budget** is a monthly plan for income-statement accounts: revenue, cost of goods sold, expenses, other income and
other expenses. It runs from a first month (`YYYY-MM`) for 1–60 months, 12 by default.

- **Amounts:** each is in the account's natural direction (income earned, cost spent) and never negative.
- **Creating one:** start empty, or **from the same months last year** ± a percentage (the actuals × (1 + %), rounded per
  month).
- **Editing:** a budget is a plan, not a financial record — edited freely and audited (`budget.*`), never posted. Lines
  are set per account and month; 0 removes one. The page can spread a yearly amount evenly, and puts any odd minor units
  in the first months.

**Budget vs actual** (`GET /finance/budgets/:id?through=`):

- Actuals are the **income statement's own figures**: posted journal lines on that account, in its natural direction,
  per month.
- Per account: each month (budget / actual), plan to date, actual to date, variance (actual − plan), variance %, the
  yearly plan, and whether it is **favourable** (more income, or less cost).
- Net profit is shown planned to date, actual, against plan, and for the year.

## 2. Cash forecast (`GET /finance/cash-forecast?weeks=13`)

The forecast is built from what is already known, week by week from today.

**Opening balance:** today's balance in cash, bank and wallet accounts.

**Lines** — each names its source and reference:

| Source | Effect | Timing |
|---|---|---|
| Clearing | + money in transit (gateway, courier COD, manual-receipt clearing balances) | week 1 |
| Supplier bills | − what is still open on posted bills (payments awaiting approval reserved) | due date; overdue in week 1 |
| Recurring costs | − commitment periods not yet paid (including the last three months' overdue ones) | due date |
| Loans | − planned instalments of drawn loans | due date |
| Purchase orders | − open approved orders, stock not yet received, at order prices | expected date (or in two weeks) plus the supplier's payment terms |

**Results:**

- **Week by week:** money in, money out, and closing cash each week.
- **The lowest point,** with a warning when cash goes below zero.
- **Expected sales are not forecast.** The page says so.

**Runway:** the average monthly change of cash, bank and wallet balances over the last three full months. When it is
falling, runway = cash now ÷ the monthly fall; otherwise "not falling".

## 3. API (`/api/v1/finance`)

| Route | Permission |
|---|---|
| `GET /budgets`, `GET /budgets/:id`, `GET /cash-forecast` | `finance.read` |
| `POST /budgets`, `PUT /budgets/:id/lines`, `DELETE /budgets/:id` | `finance.transact` |

That adds 6 routes, 537 admin routes in total.

**UI:** Finance → **Budgets & cash** has two views:

- **Cash forecast:** cash now, lowest point, cash in 13 weeks, runway; the week-by-week table (13 or 26 weeks); every
  line with its source.
- **Budget vs actual:** a budget picker, new budget (empty or from last year ± %), plan / edit an account (12 months,
  spread a yearly amount), and the comparison table.

## 4. Database

Migration `20261028100000_finance_budgets`:

- `Budget` and `BudgetLine` (unique per budget, account and month; lines cascade with their budget).
- B-1 values: months as `YYYY-MM`, 1–60 months, amounts ≥ 0.
- B-2: every budget change is audited at commit.

## 5. Verified

- `finance-payables.integration.test.ts` +2 tests:
  - **Budget vs actual:**
    - lines on a balance-sheet account or outside the budget's months are refused; duplicate names are refused;
    - rent actual to date = the ledger's rent movement for the months;
    - net profit actual = the income statement for the same period;
    - a copy-from-last-year budget plans each account at last year's month × 1.10.
  - **Cash forecast:**
    - the opening = Σ cash / bank / wallet balances;
    - it covers 13 weeks;
    - the rent commitment and the loan instalments appear;
    - closing = opening + every line;
    - the lowest point is ≤ the opening.
- Full API regression: 110 files, 1309 / 1309. Authorization matrix: 537 routes.
- Browser QA (`finance_qa`):
  - **Forecast:** cash now ৳530,000 (City Bank). Week 1 carries the overdue August and September rent (−৳60,000). The
    November bills (৳5,600 + ৳120,000), the loan instalments of ৳23,303.92 and PO-000001 (−৳1,700) all appear. Lowest
    point ৳182,788.24 in week 13.
  - **Budget:** "FY 2026-27" from 2026-07 with rent planned at ৳360,000 for the year (spread evenly). Rent to date:
    ৳120,000 planned, ৳31,000 actual, −৳89,000 (favourable). Actual profit −৳33,664.16 equals the income statement.
  - 1440 and 375 px.

## 6. Limitations

- **No sales forecast.** It would need a sales plan; the budget's revenue lines could feed it later.
- **Weekly granularity.** Days within a week aren't distinguished.
- **No foreign currency.** Single-currency books (4H deferred).
