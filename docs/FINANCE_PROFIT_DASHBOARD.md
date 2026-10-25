# Profit dashboard

Owner request (2026-10-22): see every day how much profit the business made and how much went on ads — today, the last
few days, a month, three months or any custom range — simply and as a chart.

## Where

- **Finance › Reports & books › Profit** (`/admin/finance/profit`) — the dashboard on top, then the existing profit by
  product / by order tables and the before-the-books estimate (§8–§9 of FINANCE_OWNER_BOOKS.md) for the same period.
- **Dashboard › Profit** — yesterday, the last 7 days, the week's sales and ad spend and 14 days of small bars, linking to
  the page. Shown only with `finance.view`.

## Data — `GET /api/v1/finance/profit/daily?from=&to=` (`finance.read`)

Each business day's POSTED income-statement lines (by journal `entryDate`), folded into one bucket per account:

| Bucket | Accounts |
|---|---|
| sales | every REVENUE account (merchandise, shipping, adjustments, returns, outside sales) |
| goods | COGS accounts except `cogs.packaging` |
| packaging | `cogs.packaging` |
| delivery | `expense.courier_fees`, `expense.freight_in` (same as the owner's home) |
| paymentFees | `expense.gateway_fees` |
| ads | `expense.advertising` |
| running | every other EXPENSE, OTHER_EXPENSE, minus OTHER_INCOME |

`profit = sales − all the costs`, so the days add up exactly to the income statement's net profit for the range
(tested). `orders` = distinct orders with a merchandise sale credited that day (delivered or paid), not orders placed.

Defaults to the last 30 days ending today; at most 366 days. `prior` is the same length just before (as the income
statement), returned as `priorTotals`. `totals.salesPerAdTaka` = sales ÷ ads.

## Rules on the page

- A sale counts on the day its parcel is delivered; ads on the day they ran — the chart says so.
- Presets: Today, Yesterday, 7 days, 30 days (default), This month, Last month, 3 months, Custom. In the URL
  (`?view=&from=&to=&gran=`) so a view can be bookmarked.
- The chart shows one measure at a time (Profit / Sales / Ads / Orders) — never two scales. Profit bars are signed (green
  up, red down). Grouped by day up to 45 days, then by week (weeks start Saturday), then by month; switchable. Today or
  Yesterday alone shows the last 14 days with the chosen day lit. Every chart has a summary and a table view.
- Changes against the period before are shown only when that whole period is inside the books (a part-empty period would
  read as "up from nothing"). Costs going up are red, sales and profit going up green.
- Ad campaigns for the period come from `GET /ads/campaigns` (its orders are attributed by visit, not by the books).

## 5. Month by month (`/admin/finance/monthly`)

`GET /api/v1/finance/profit/monthly` (finance.read, owner-only) folds the daily profit (§above) into one row per month from
the books' opening date to today: sales, goods, packing, delivery, payment fees, ads, running costs and profit. The months
add up to the income statement for the same span (asserted in `finance-charges.integration.test.ts`).

Each month also says what is still to settle before it can be closed:
- `estimatedCostPct` — the share of the month's goods cost (COGS journal lines) still valued from an estimate, not a bill;
- `openExceptions` — finance exceptions raised in the month and not resolved;
- `unpaidByCourier` — delivered COD parcels of that month the courier hasn't paid for yet.

`readyToClose` is true only when the month is over, still open, and all three are zero. Nothing here closes a month — that
stays in Month-end, by the owner. A month opens to its delivered orders, least-earning first (from `/finance/profit`).

## 6. Stock corrections apart (2026-10-26)

Every day (and month, and total) also carries `stockCorrections` — count differences (5210 `cogs.count_adjustments`) and
cost corrections (5150 `cogs.cost_adjustments` / `cogs.purchase_price_differences`), positive = a cost, negative = a gain —
and `salesProfit`, the profit from selling before them. `goods` is now only the goods sold (5100) and shrinkage (5200,
5220: damaged, lost, waste — real costs). `profit` is still the books' net (= `salesProfit − stockCorrections`), so the
days still add up to the income statement.

On the pages: the chart's Profit bars, the dashboard's glance (yesterday, 7 days, 14 bars) are the profit from selling; a
correction shows in the bar's tooltip and as "Stock corrections" in Where the money went; the headline stays the books'
figure with a line "Includes stock corrections of … — from selling alone …"; Month by month has a "Stock fixes" column.
A correction day is therefore never read as a selling loss or gain (24/25 Oct 2026: +2.8 lakh / −2.8 lakh of fixes).
