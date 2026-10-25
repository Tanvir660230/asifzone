# Cost & profit planning

What one sale of each product and size costs — making and selling — and what it earns. A **planning aid**: nothing here
is booked. The books keep booking what things really cost (stock averages, courier payouts, ad spend); planned vs
actual compares the two (later phase).

Code: `apps/api/src/domain/finance/cost-sheet.service.ts`, schemas `packages/shared/src/schemas/cost-sheet.ts`,
admin `components/admin/cost-sheet/cost-sheet-field.tsx` (product › Pricing & Inventory › Cost & profit) and
`/admin/finance/product-costs` (list + shop & category defaults).

## 1. Lines

Every size has the same eight lines. Each is `fixed + percent × price`, so profit at any price is exact.

| Line | Worked out (AUTO) from |
|---|---|
| Making | the latest approved recipe at the materials' moving averages (a material with none: its reference cost — marked *estimate*); no recipe → the size's stock average → its cost price; else **unknown** |
| Parcel packing | the active packing rules for a one-item parcel, at the materials' averages |
| Delivery | the courier rate card: inside-Dhaka share × the Dhaka fee + the rest × the outside fee |
| Payment fees | COD % × the cash-on-delivery share + the gateway's % and fixed fee × the online share |
| Returns | return rate × what the courier keeps for a parcel that comes back (rate card's return-charge %) |
| Ads | the last 30 days' ad spend ÷ the orders placed in them (0 with no spend) |
| Labour, Other | nothing unless set |

An unknown cost stays unknown — never 0 (BUSINESS_DECISIONS P5-6): the total says "+", profit is shown before it, and
no suggested price is given.

## 2. Levels

`CostProfile` (scope BUSINESS / CATEGORY / PRODUCT) holds assumptions and `CostProfileLine`s (mode FIXED — money per sale,
or PERCENT_OF_PRICE). For each line of a size the nearest level that sets it wins:

**this size → the product → its category → the shop → AUTO.**

Assumptions follow the same chain: inside-Dhaka share (default 50%), cash-on-delivery share (100%), return rate (last 60
days' returned ÷ delivered + returned), target margin (30%). Saving a level with nothing set removes its profile.

## 3. What the sheet shows

Per size: each line with where it came from, cost per sale, **profit per sale**, margin, the most ads can cost before
the sale loses money (`price − every cost but ads`), and the **suggested price** for the target margin:
`Σ fixed ÷ (1 − target − Σ percent)`. "Try a price" recomputes in the page.

Product costs lists every size worst margin first with chips (loss, below target, unknown). Production home's *Needs
you* lists sizes below their target to someone with `costing.read`.

## 4. API and permissions

| | |
|---|---|
| `GET /api/v1/finance/cost-sheets/products` | every active product's sizes (`costing.read`) |
| `GET /api/v1/finance/cost-sheets/products/:id` | one product's sheet + its own profile (`costing.read`) |
| `GET /api/v1/finance/cost-sheets/defaults` | the shop's and each category's profile (`costing.read`) |
| `PUT /api/v1/finance/cost-sheets/:scope/:scopeId?` | save one level, replacing its lines (`costing.adjust`), audit-logged |

## 5. Planned vs actual

The product's sheet shows, per size, the plan at today's price beside what the books booked per sale over the last 30
days — from the profit report's per-size figures (`sizes`: each order's goods cost, packaging, courier and gateway
charges and its share of ad spend, shared over its lines by value, ÷ units sold). The books keep courier COD and
return charges inside the courier's fee, so the comparison groups **delivery, COD, returns & fees** together. A cost
above plan (or a price / profit below it) is marked.

Real wastage for recipes is in docs/MANUFACTURING.md §4.
