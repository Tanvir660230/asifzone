# Stock hub — Bought · Filled · Counted

Status: **specification 2026-10-22** (owner conversation of that day; plan `docs/superpowers/plans/2026-10-22-stock-hub.md`).
One admin page, `/admin/stock`, where the owner records every purchase, every bottle fill and every count. Everything
else — stock, cost, money, packaging and what the website sells — follows on its own.

## 1. What the owner does

| Action | When | What is entered |
|---|---|---|
| **Bought** | Anything arrives: oil, empty bottles, boxes, stickers, poly, caps | Items, quantity, the line total paid, extras (transport, customs…), paid from (an account or "Owner's own money") |
| **Filled** | Attar bottles are filled for waiting orders | Fragrance, size, how many |
| **Counted** | Any physical count | What is on the shelf; when short, a reason (damaged, lost, sample) |

Nothing is typed over. Once stock costing is live, the product form no longer edits stock — it points here.

## 2. What the system does

- **Bought** → a goods receipt, a supplier bill matched to it and its payment (owner's own money is booked as capital
  first). Extras are spread over the lines by value, so the average cost includes transport.
- **Filled** → the existing quick refill: oil, bottle, box and sticker leave stock at their average cost, filled bottles
  come in at that exact cost; a fill the materials can't cover is refused with what is short.
- **Counted** → expected on the shelf = stock + units on orders not yet booked with the courier (they are still on
  the shelf). A difference is booked at the average cost as DAMAGED / LOST (loss) or ADJUSTMENT (found, count fix).
- **Website availability** for fill-to-order products (§3), refreshed after every purchase, fill, count and order.
- **Packaging per parcel**, when a parcel leaves: one black poly on every parcel (a packing rule; the material leaves
  stock into packaging cost). Bubble poly is cut from a roll, so it is tracked as a roll (Finance › Stock check: open a
  roll, finish it with the parcels it wrapped), not per parcel.
- **Sale costs**: every order line takes its cost from the moving average. A fill-to-order bottle sold before any of
  its variant was ever valued takes its **recipe's standard cost** (§3) — the line is costed (`INVENTORY_PROVISIONAL`),
  recognised at delivery like any sale, and the fill settles the difference.
- **Low-stock warnings**: days left from the last 30 days' use; low at 10 days or less, or when a fill-to-order
  product can make 10 or fewer.

## 3. Fill to order (attar)

`Product.fillToOrder = true` (attar only; every other product and all of Nasihamart stay `false`, unchanged).
Filled bottles are rarely held: a bottle is filled from bulk oil + an empty bottle + a box + a sticker when orders
come. So a fill-to-order variant's **stock = filled bottles**, and it may go **negative** (ordered, not yet filled).

```
need per unit   = qtyPerUnit × (1 + wastage% / 100)                      (each line of the approved recipe)
free material   = material stock − Σ over variants with stock < 0 of (−stock × need per unit)
makeable(v)     = min over v's recipe lines of ⌊ free material / need per unit ⌋     (no approved recipe → 0)
website sells   = max(0, stock) + makeable(v)
```

Example: Azhaar 650 ml, 6 ml per bottle, 166 empty 6 ml bottles → 108 can be sold. Ten unfilled orders (stock −10)
reserve 60 ml → 98. A material shared by several fragrances (the 12 ml bottle) is counted in full for each of them on
the website; checkout locks the materials, so the last bottle is sold exactly once. Without an approved recipe a
fill-to-order product sells only filled bottles — never unlimited. The engine is `packages/shared/src/engines/fill-capacity.ts`.

**Cost of a bottle sold before it is filled.** When the variant has no average yet (nothing of it ever valued), the
exit cost is the recipe's standard cost:

```
standard cost   = Σ over the approved recipe's lines (supplied by the business) of
                  qtyPerUnit × (1 + wastage% / 100) × the material's moving average     (rounded once, half to even)
```

(no average for some material → no cost, as before: `NONE` and a missing-cost note at delivery). The order line carries
it (`INVENTORY_PROVISIONAL`) and the costing deficit is an **unbooked** layer at that cost (`costing.service` header):
nothing is posted when it is sold, the cost of goods is booked at delivery from the line, and the fill that covers the
units posts only *actual − standard* to 5150 (0 when prices haven't moved). A cancel before the fill nets the layer at
the same cost with nothing posted. The inventory account check reads `ledger = valuation + in-transit − unbooked deficit`
(the bottles' cost is on the way to the customer while their materials are still on the shelf).

The same holds after the first fill, the normal attar path: **every** unit a fill-to-order variant sells beyond its
filled bottles is an unbooked layer, at the variant's moving average once it has one (else the recipe cost, else no
cost). Bottles that are filled leave as any sale does; an order of 3 with 1 filled bottle is 1 ordinary exit + 2
unbooked. So 5150 moves only by *actual − provisional* at the fill, and a month end between sale and fill shifts no
profit. Ordinary products (and their oversells) keep booked provisional deficits.

### Filled as one entry, bottles owed, and the attar trace (inventory recovery phase 3, 2026-10-24)

**Filled** (`POST /stock/fills`, `manufacturing.approve`, `Idempotency-Key`) is a stock hub entry of kind `FILL`, like
Bought and Counted. `/quick-refills` runs through the same code (`domain/stock/fill.service.ts`).

- **Checked before anything is written** (409, nothing written):
  - the size has an approved recipe (`NO_RECIPE` — unconfigured, so it can't be filled; nothing is invented);
  - every material named as used or wasted is in that recipe (`FILL_MATERIAL_NOT_IN_RECIPE`);
  - stock holds what the fill takes (`FILL_SHORT`, each short material with needed / in stock). What the fill takes is the
    recipe's need (as the production order plans it), or `used` when given, plus `wasted`.
- **Once.** A double tap waits (`STOCK_ENTRY_IN_PROGRESS`); a replay returns the fill (200); the same key for a different
  fill is refused (`IDEMPOTENCY_KEY_REUSED`). A failure part-way (`FILL_STOPPED`) keeps what was done; sending the same
  form again resumes at that step. The issue replays by its request key, usage is absolute, the receipt is posted once
  and the order is found by its notes marker, so a retry never takes oil or bottles twice.
- **Waste** (`wasted` + `wasteReason`, required): issued on top of the bottles' material and declared as scrap. It leaves
  stock and stays in the bottles' cost (normal loss). The reason is kept on the production order.
- **The record**: date, who, bottles, each material used and wasted with its value, cost and cost per bottle.

**Bottles owed and which orders are ready** (`fill-status.service.ts`, derived — no table):

```
on the shelf (filled) = max(0, stock + waiting)    waiting = units on orders not yet given to the courier
owed (to fill)        = max(0, −stock)
```

Filled bottles go to the waiting orders oldest first. Each line reads `READY`, `PARTLY_FILLED` (k of n) or
`AWAITING_FILL`. Shown on the order page (`GET /api/orders/:id/fill-status`) and in the trace.

**The trace** (`GET /stock/items/:id/trace`, `inventory.read`; costs only with `costing.read`) gives one size's whole
picture:
- filled on the shelf, on orders, owed, can make;
- the recipe (or `recipeMissing`), with each material's stock and average and its recent purchases;
- the waiting orders with their readiness;
- every fill (materials used and wasted, cost per bottle, who and when);
- the last 90 days (sold, back from cancellations, returned, filled, count corrections);
- the valuation and any open "stock without a cost".

Costing is a moving average, so a bottle is traced to the materials of its fill and to those materials' recent
purchases, not to one purchase lot.

The stock page shows **Raw materials** (stock unit ml, l, g, kg) and **Packaging** (pieces, rolls…) as separate groups.
Which group a material is in is read from its stock unit (`materialRole`), so there is no setting per material.

## 4. Go-live order

A one-off script (`apps/api/scripts/finance/asif-zone-stock-golive.ts`) reads a **fresh count taken on go-live day**
from a JSON file (`--counts`, shape: `asif-zone-stock-golive.counts.example.json`, which holds the 2026-10-22 figures;
the file is validated strictly and a count more than a day old is refused). Dry run first, then `--apply`; each step
finds before it creates, so a second `--apply` writes nothing.

1. **Materials** (kind MATERIAL, SKUs `MAT-OIL-AZHAR/ROYAL/SWEET/ZAYAN` in `ml`, `MAT-BTL-6`, `MAT-BTL-12`, `MAT-BOX`,
   `MAT-STICKER`, `MAT-POLY-BLACK`, `MAT-POLY-BUBBLE` in `pcs`), each set to the count (an unvalued adjustment made
   once per variant — the cutover values it).
2. **Recipes** per attar product, one line set per size: 6 ml = oil 6 + bottle 6 ml 1 + box 1 + sticker 1; 12 ml =
   oil 12 + bottle 12 ml 1 + box 1 + sticker 1; wastage 0; supplied by the business; approved. A variant whose size
   isn't 6ml / 12ml stops the run.
3. **Attar**: `fillToOrder = true`; each variant's stock = filled bottles counted − units on orders not yet booked with
   the courier (negative = ordered, not filled). Caps keep their per-colour stock; the website total + caps on unbooked
   orders is compared with the counted caps, and a difference stops `--apply` unless `--accept-caps-difference`.
   Open orders not yet in the books (not delivered, not paid online) whose lines carry no cost, or the old typed
   catalog cost (attar at ৳610), get today's cost as the checkout records it (`CATALOG`; attar: its recipe cost at the
   counted rates). Their delivery is then costed, and the cutover counts them as on the way to customers.
   **Attar ordered and not filled** needs nothing special: the cutover starts each such variant's deficit at its recipe
   cost (from the batch's approved material costs), unbooked, so those bottles count once in the true-up (on the way to
   customers, not again as materials) and their fill posts only the difference. The run prints how many units are
   waiting to be filled.
4. **Valuation cutover**: materials at the counted rates, attar at recipe cost (bottles ordered and not filled: an
   unbooked deficit at recipe cost), caps at the owner's cost (KNOWN), any other tracked variant at its cost price
   (ESTIMATED) or MISSING (acknowledged). True-up = valuation + in-transit − unfilled at recipe cost − the inventory
   account; it all goes to the opening-balance correction (3900, "Stock counted <date> for go-live"), so no profit
   changes. Costing switches on.
   The pre-go-live adjustments' "stock without a value" notes are closed as valued by the cutover.
5. **Packaging**: black poly ×1 per parcel on every parcel (a packing rule, from now on). Bubble poly: one roll is
   opened on go-live day if the count has a roll and none is open.
6. **Product cache** cleared and the attar products' read model refreshed; the script prints what the website sells per
   attar variant (filled + can be made).
7. **Finance checks** (read only, not recorded as runs). `--apply` exits non-zero if any `inventory.*` check isn't
   MATCHED.

### Rehearsal (2026-10-23, copy of `stock_qa` = production 2026-10-20 + the 2026-10-22 count correction)

Example counts file (0 filled bottles), `--accept-caps-difference` (website 45 + 2 waiting vs 43 counted):

| | ৳ |
|---|---:|
| Inventory account (1610) before | 2,13,739.29 |
| Valuation (materials 1,26,512.50 incl. polys + caps 45 × 587) | 1,52,927.50 |
| In-transit (open orders at cost; +13,676 from 174 lines given today's cost) | 64,306.00 |
| Unfilled attar at recipe cost (68 units, unbooked deficit) | −25,180.00 |
| True-up → 3900 opening-balance correction (5150: 0) | −21,685.79 |
| 1610 after = valuation + in-transit − unfilled | 1,92,053.50 |

The true-up is the 2026-10-22 count's pipeline already holding the unfilled attar (−25,180: their materials are counted
too), plus caps on the website above the count (+1,174), the polys now held as stock (+2,336) and the sticker rate in
whole paisa (−15.74). Every inventory check MATCHED; the two pre-existing differences of that copy
(`commerce.receivables`, `cost.completeness`) were there before. A second `--apply` changed no table (pg_stat
insert/update/delete counters identical). October: 5100 208,243.00 and 5150 0 before and after the go-live. Then a new
order of one Azhaar 6 ml (stock −21 → −22) was costed at its recipe cost ৳328.50 (`INVENTORY_PROVISIONAL`, unbooked
deficit 22 at 328.50); filling all 22 left 5150 at 0; delivering it booked 5100 +328.50 once, no missing-cost note;
every inventory check MATCHED after each step. Website after go-live: Azhaar 6 ml 71, 12 ml 35; Royal 6 ml 145, 12 ml
98; Sweet 6 ml 37, 12 ml 18; Zayan 6 ml 120, 12 ml 60 (all made, none filled).

## 5. API and safeguards

All under `/api/v1/finance`. Bought, Counted and Filled need an `Idempotency-Key` header; the same key replays (200), a different
request under it is refused (409 `IDEMPOTENCY_KEY_REUSED`).

| Route | Permission | Notes |
|---|---|---|
| `GET /stock` | `inventory.read` | The overview; values and average costs only with `costing.read` |
| `GET /stock/purchases?limit=` | `purchasing.read` | Recent purchases; amounts and unit costs only with `costing.read`; payment status read live |
| `GET /stock/purchases/:id` | `purchasing.read` | One purchase: `complete`, `pendingStep` |
| `POST /stock/purchases` | `purchasing.receive` (+ `purchasing.approve`, `ap.manage`, `finance.transact`; + `finance.sensitive` for the owner's own money) | 201 / 200 replay |
| `POST /stock/purchases/:id/finish` | as above | Completes a purchase stuck mid-way, optionally from another account while nothing has been paid (`PAID_FROM_LOCKED` otherwise) |
| `POST /stock/counts` | `inventory.adjust` | 201 / 200 replay |
| `POST /stock/fills` | `manufacturing.approve` | 201 / 200 replay; resumable (§3, phase 3) |
| `GET /stock/items/:id/trace` | `inventory.read` | One item's trace; costs only with `costing.read` |

- **Checked before anything is written** (409, nothing written): the date is in open books (`BEFORE_OPENING_DATE`,
  `PERIOD_CLOSED`, `PERIOD_SOFT_CLOSED`), the supplier isn't on hold (`SUPPLIER_ON_HOLD`), a cash box or wallet holds
  what is still to be paid (`INSUFFICIENT_FUNDS`; a bank may go overdrawn, as in treasury). Amounts: each at most
  1,000,000,000, a purchase at most 10,000,000,000.
- **Owner's own money** passes only through his "<owner> — own money" cash account (made the first time), never another
  cash box, and needs `finance.sensitive` like `POST /equity/owner/money`.
- **Leases are fenced**: each claim gets a token; every save, completion and release is conditional on it and renews the
  lease. A request that outlived its lease stops with 409 `STOCK_ENTRY_LEASE_LOST`. The receipt and bill stamps
  (`stock-purchase:<key>:receipt|invoice`) are unique in the database among receipts not reversed and bills not voided.
- **Counts** are kept with what should have been on the shelf (`StockCount.siteStock` = stock + units waiting unpacked)
  and their count line (`StockCount.sourceId`), so Finance → Stock check shows the true difference and a retry never
  records a count twice.

## 6. Go-live on Asif Zone

Run it off-peak; checkout does **not** need to be paused. Each variant's stock is set in one transaction under its row lock
(the lock every sale takes), with the units waiting on unbooked orders read inside it, so an order placed meanwhile is
counted exactly once; the cutover locks every stock-tracked variant while it posts, so checkouts wait a few seconds.

1. **Merge and deploy** the stock hub (the normal deploy; it runs the migrations).
2. **Count the shelf** that day (waiting attar orders may stay unfilled: they are held at recipe cost) and write
   the counts file from `apps/api/scripts/finance/asif-zone-stock-golive.counts.example.json` (every number, plus
   `countedOn` = today). Copy it to the server, e.g. `scp counts.json root@187.77.137.12:/tmp/counts.json`.
3. On the server:

   ```bash
   cd /opt/asifzone
   bash docker/backup.sh                                       # database + uploads backup first
   docker build -f apps/api/Dockerfile --target build -t asifzone-api-tools .   # tools image of the deployed code
   docker compose -f docker/docker-compose.yml --env-file docker/.env exec -T api env > /tmp/api.env
   NET=$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' $(docker compose -f docker/docker-compose.yml --env-file docker/.env ps -q api))
   GOLIVE="docker run --rm --env-file /tmp/api.env --network $NET -w /repo/apps/api -v /tmp/counts.json:/tmp/counts.json asifzone-api-tools npx tsx scripts/finance/asif-zone-stock-golive.ts --as <owner admin email> --counts /tmp/counts.json"
   $GOLIVE                                  # dry run: read every number (and how many attar units wait to be filled)
   $GOLIVE --apply --expect-trueup <the projected true-up the dry run printed>
                                            # add --accept-caps-difference only if the dry run asks and the numbers are right
   $GOLIVE --apply                          # must print "nothing to write (already live)"
   rm /tmp/api.env
   ```

4. **Check**: the run ends with every `inventory.*` check MATCHED (exit code 0); Finance › Reconciliation shows the
   same; `/admin/stock` shows the materials and what each attar can make; the shop sells attar up to that number.

`--apply` refuses to run without `--expect-trueup` matching the true-up it projects (within ৳1): a mistyped count shows
up there as a figure nobody expected. Every count is printed next to the site's current figure for that item.

If `--apply` stops half way (an error is printed), fix the cause and run it again: each step finds what an earlier run
made. Stock is set once per item: if the counts file differs from what an earlier run already set, the run lists the
differences and stops unless `--keep-earlier-counts` (correct those items under Stock › Counted after go-live). Once the cutover has posted, stock is no longer set from the file — later counts go through Stock › Counted.

## 7. The smart stock page (2026-10-24)

Owner request: the page should say what to do, work clearly on a phone, and still read well with many more products.
Plan: `docs/superpowers/plans/2026-10-24-stock-smart.md`. The actions keep one name everywhere — **Received goods**
(was Bought), **Filled bottles** (was Filled), **Count** (was Counted); the API and test ids are unchanged.

### Today (`GET /stock/today`, `inventory.read`)

Only what needs doing, each with its one action (`stock-today.service.ts`, worked out on each read):

| Task | When | Action |
|---|---|---|
| Fill N bottles for M orders | a fill-to-order size owes bottles; names a material that can't cover them | **Mark filled** (one form for every size) |
| Bottles that couldn't be filled | a booking's auto-fill was refused (below) | — (fill them; it clears itself) |
| Reorder N items | a bought item is low or out, or must be ordered within 3 days to arrive in time | **Review** → by supplier → **Record purchase** |
| This week's count | cycle count: by 30-day use value, the top 80% every 7 days, the next 15% every 30, the rest every 90; at most 8 | **Start** (one item a screen) |
| Approve a loss | a staff count loss waits (below) | **Review** → Approve / Reject |

Nothing to do reads "All caught up". A store with no fill-to-order products (Nasihamart) never shows the fill task.

### The stock list (`GET /stock/items?status=&group=&q=&cursor=&limit=`, `inventory.read`)

Every item with a status — `NEEDS_FILL` (bottles owed), `OUT` (none to sell while it is used or on orders), `LOW`,
`OK`, `EMPTY` (none left, no use in 30 days and no orders: a size not stocked any more, not an emergency) — what it can
still sell, the recipe material that runs out first, and for a bought item the reorder suggestion:

```
suggested = max(0, ⌈used per day × (days to arrive + days of stock to keep)⌉ − available)
order by  = today + max(0, ⌊available ÷ used per day⌋ − days to arrive)
```

A material's available stock leaves out what owed bottles will take. Search, filters, sorting (by what needs doing, then
SKU) and cursor paging are on the server; 1,500 items page in well under 800 ms. Counts per status honour the search and
kind, not the status. An item's settings (`PUT /stock/items/:id/settings`, `inventory.adjust`; `StockItemSetting`) are
its usual supplier, days to arrive (default 3) and days of stock to keep (default 30). Received goods prefilled from the
reorder list shows the unit price paid last time per line and asks for a check (never blocks) above +20%.

### Bottles filled at courier booking (owner decision 2026-10-24)

An attar parcel is only booked once its bottles are filled, so booking with Steadfast — one order or bulk — records the
fill of the bottles still owed for it, worked out before it leaves the shelf (filled bottles go to waiting orders oldest
first, so filled bottles on the shelf are used first). It runs through `recordFill` (§3, phase 3) with the key
`auto-fill:<order>:<variant>:<units>`. It never fails a booking: a refused fill (no recipe, a material short) is kept as a
`StockAutoFillFailure`, shown on Today, and marked resolved once the size no longer owes bottles. Nothing happens before
stock costing is live. A parcel marked shipped without a Steadfast booking is not filled automatically.

### Count losses wait for the owner (owner decision 2026-10-24)

A loss counted by someone without `inventory.approve` (owner only) worth at least `FinanceBusiness.countLossApprovalThreshold`
(default ৳1,000; at the average cost, else the cost price; an item with neither counts as over) is not booked: the count
is kept and a `StockCountApproval` waits (`GET /stock/approvals`, `POST /stock/approvals/:id/decision`). Approving applies
the difference recorded at the count — once — through the ordinary adjustment; rejecting moves nothing. The owner's own
counts and every gain are booked at once, as before.

### Navigation

Inventory in the sidebar: **Stock**, **Stock levels** (movements, write-offs) and **Production**, whose pages — Overview,
Production orders, Bills of materials, Materials — are tabs on it.
