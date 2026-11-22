# Spending

Owner request (2026-11-22): see how much was spent, month by month and date by date, on one page that is easy to read.
Before this the answer was spread over Expenses, Profit, Ads, Purchases and Courier.

## Where

**Money › Spending** (`/admin/finance/spending`), the second tab of Money. Needs `finance.view`.

1. The last months as bars. A month is picked by tapping its bar; **Choose dates** takes any range.
2. One total: "November so far, you spent ৳…", then each kind with its amount. Tapping a kind shows only its rows.
3. Day by day, newest first: every row with its amount. A purchase opens to its items; any other row links to its page.

## Data: `GET /api/v1/finance/spending?from=&to=` (`finance.read`)

Read-only. Defaults to this month so far; at most 366 days. The kinds and the days both add up to `total` (tested).

| Kind | What counts | Day |
|---|---|---|
| Goods and materials | posted goods receipts at the bill price, the cost of bringing them (landed costs), and purchases saved before stock costing is live | the day bought |
| Ads | `expense.advertising` | the day the ads ran |
| Delivery | `expense.courier_fees`, `expense.freight_in` | the day the books took it; an estimate until the courier pays out |
| Packaging | expense accounts named packaging (tape, for example) | the day of the expense |
| Payment fees | `expense.gateway_fees` | the day the books took it |
| Salaries | `expense.salaries`, `expense.employer_contributions` | the day the books took it |
| Other | every other expense | the day of the expense |

Counted once, never twice:

- An expense comes from its own row; its payment in the ledger is left out. A reversed one is gone from both.
- A prepaid cost (a domain, a licence) counts whole on the day it was paid; its monthly shares are left out.
- Depreciation, the cost of goods sold, stock corrections and packaging used on parcels are not spending. Their purchase was.
- Paying a supplier's bill later is not a second spend: the goods counted when they were bought. This is spending, not
  cash out. A purchase on credit is here, and a drawing by an owner is not.

## Not the same as Profit

Profit counts the cost of the goods that were **sold**. Spending counts the goods that were **bought**. A month with a large
purchase shows more spending than cost, and both are right.

`adsMissingAfter` is the last day that has ad spend, when the period goes on past it. The page then says the total is low and
offers **Add ad spend**.

Tests: `finance-ads-prepaid-packaging.integration.test.ts`, "spending".
