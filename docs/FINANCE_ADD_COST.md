# Add cost

Owner request (2026-11-23): recording and finding costs was "ghuray pechay". There were 11 places to enter a cost and 8
pages to see one, and almost every cost paid with Asif's own money needed two or three records by hand. The audit and
plan: https://claude.ai/artifact/WjKKAXDJLLHUxByiLFRKer.

## One way in

**Add cost** opens the same sheet from everywhere:

- the **Add cost** button on Money › Spending;
- the Create (+) menu (`/admin/finance/spending?new=cost`);
- **Add cost** on Money › Overview and its New menu;
- **Add cost** on Money › More › Expenses.

The sheet asks what it was (8 tiles), then how much, whose money, when, and a line about it. "Again" repeats one of the
last four expenses in one tap.

| Tile | What it makes | Where it counts |
|---|---|---|
| Goods or materials | opens Stock › New purchase (stock and its cost, as before) | Goods |
| Bringing goods | a landed cost on the purchase picked (default the latest); **before stock costing is live**, an expense on freight-in | Goods |
| Ads | money paid to the ad account (Meta charged the card). The daily spend still comes from Money › Ads | not spending itself: the daily ad spend is |
| Packaging | an expense on the packaging account | Packaging |
| Bills | an expense on the account picked (rent, SMS, internet…), marked fixed | that account |
| Paid for months | a prepaid cost over 1–24 months from the date | whole on the day paid; profit a month at a time |
| Equipment | the payment onto a fixed-asset account and the asset in the register, with its life | not spending: an asset |
| Something else | an expense, default "Other operating expenses" | Other |

The accounts offered for bills leave out what the books fill themselves or only an accountant uses: salaries, ads,
courier, gateway fees, freight-in, depreciation, settlement adjustments, purchase tax, cash over/short, unallocated,
interest and disposal losses.

## Whose money

- **Asif's own money** (first, for the owner only, as it needs `finance.sensitive`). The money comes in as his capital
  through the "<owner> — own money" cash account and pays the cost the same day: two records, one step, the same as the
  purchase form and the owner's history. **The shop pays it back later** books it as owed to him instead (an owner
  advance that "Repay owner" can pay).
- **A cash, bank or wallet account**: paid from it.
- For **Ads** with the owner's money, his money goes straight into the ad account, as it was recorded before.

## Taking one back out

On Spending, an expense, a prepaid cost or a carrying cost opens to what it was. **Take it out** (`finance.reverse`;
`finance.post` for a carrying cost) asks why and reverses it:

- an expense: its payment;
- a prepaid cost: its payment and the monthly shares already booked;
- a carrying cost: the landed cost and the stock value it added.

When the owner's money came in for it, that comes back out too. The records stay in the history, marked reversed, with
the reason. **Add a corrected one** opens Add cost. Goods purchases open their own page.

## Menu

Money keeps the everyday tabs: Overview, Spending, Accounts & cash, Bills to pay, Payments & refunds, and Courier &
gateway. Expenses, Prepaid costs, Loans and Bank reconciliation are under **More**. Search (Ctrl K) still finds every page.

## Ads kept up to date

- The existing alert counts days a running campaign has no spend.
- **ads.behind** (new) catches the case it missed: no campaign is marked running, but spend was recorded within the last
  45 days and then stopped for more than 3 days. Asif Zone had nothing after 10 November.
- Money › Ads says "Ad spend is recorded up to …" with **Import the file** (the Ads Manager export).

## API

- `GET /api/v1/finance/costs/options` (`finance.read`): who may use the owner's money, the accounts, the purchases and
  "again".
- `POST /api/v1/finance/costs` (`finance.transact`, Idempotency-Key): one cost. The same key returns the same cost.
- `POST /api/v1/finance/costs/undo` (`finance.transact`; the kind's own permission is checked inside): take one out.

The service is `apps/api/src/domain/finance/add-cost.service.ts`. It calls each record's own `…InTx` function
(expenses, prepaid, landed costs, fixed assets) in one transaction, so a cost is never half made. Tests:
`add-cost.integration.test.ts`. They cover each kind, the owner's money, refusals, undo and the books' checks matching
after it.
