# Finance — the owner's home

Finance opened on a book-keeper's page: eight tabs, 56 links, accounting words and a setup checklist ahead of the
numbers. The owner asked for something modern and easy to understand. Finance now opens on four answers and one button.
Every other page stays, folded under **All finance pages**.

## What the page answers

| Question | Shown as | From |
|---|---|---|
| How did the month go? | "৳173,480 profit, from ৳467,362 in sales", then **Every ৳100 you sold**: goods, delivery, ads, other costs, and what you keep. Last month for comparison, plus a month picker (last 6 months). | The income statement for the month, folded by mapping key: `cogs` section = goods; `expense.courier_fees` and `expense.freight_in` = delivery; `expense.advertising` = ads; every other expense, net of other income = other costs. |
| Where is the money? | Steadfast will pay you; payment gateways will pay you; customers still owe; goods in stock at cost; paid in advance; cash, bank and bKash. The total sits at the top. Anything you owe gets one line. | The money map (`custody.service.moneyMap`). |
| Who is owed what? | The owner: put in, took out, still in. Each partner: owed now, this month so far, and a **Pay** button when something is owed. | `equityOverview` and `profitShareOverview`. Only for `finance.sensitive` (the owner). |
| What needs me? | Only things with an action: a payout waiting, a partner to pay, a renewal due or expired, money waiting for approval, books not started. Otherwise one quiet line. | Draft settlements, partner owed, prepaid renewals, pending treasury movements. |

Amounts are whole taka on this page. The detail pages show the paisa.

## Add

One button covers the everyday entries. Each is the same entry its own page makes:

- **A cost.** Amount, date, what it was, kind of cost, and where it was paid from.
  - Kinds of cost: packaging, delivery, ads, hosting, SMS, rent, utilities, other. The rest of the chart is booked by the system or from its own page.
  - Paid from: an account that has money in it, or the owner's own money. The owner's money is `POST /expenses/owner-paid` with funding `CAPITAL`, so it counts as money he put in.
- **Owner took money / put money in.** Uses `POST /equity/owner/money`. Taking money out only offers accounts that have money in them.
- **Pay a partner.** Uses `POST /equity/partners/:id/pay`. The amount defaults to what is owed and can't be more.

## API

`GET /api/v1/finance/owner-home?month=YYYY-MM` (`finance.read`; `people` is null without `finance.sensitive`). Service:
`domain/finance/owner-home.service.ts`. It only reads. Test: `finance-owner-home.integration.test.ts`.

## Web

- `app/admin/(shell)/finance/page.tsx`: the home, with the map folded below.
- `components/admin/finance/owner-home.tsx`
- `components/admin/finance/quick-add.tsx`

Roles without the books still see the map, unfolded.
