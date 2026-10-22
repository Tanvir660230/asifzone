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
- **Sale costs**: every order line takes its cost from the moving average (a fill-to-order line sold before filling is
  the costing deficit, settled when the bottle is filled).
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
   Two corrections so that nothing is costed twice or not at all:
   - **Open orders** not yet in the books (not delivered, not paid online) whose lines carry no cost, or the old typed
     catalog cost (attar at ৳610), get today's cost price as the checkout records it (`CATALOG`). Their delivery is then
     costed, and the cutover counts them as on the way to customers.
   - **Attar ordered and not filled**: after go-live, such a sale is booked at its cost and the costing engine sets the
     cost aside (Dr inventory / Cr 5150) until the bottle is filled (Dr 5150, the real cost). Orders taken before go-live
     never had that entry, so the script makes it once (`stock-golive:unfilled:<date>`). Without it, filling them would
     cost them twice (the fill to 5150 and the delivery to cost of goods). The amount is in 5150 on go-live day and is
     used up as those orders are filled; it stops `--apply` unless `--accept-unfilled-orders`. Better: fill and bag
     every waiting attar order before counting — they then count as filled bottles and nothing is set aside.
4. **Valuation cutover**: materials at the counted rates, attar at recipe cost, caps at the owner's cost (KNOWN), any
   other tracked variant at its cost price (ESTIMATED) or MISSING (acknowledged). The whole true-up goes to the
   opening-balance correction (3900, "Stock counted <date> for go-live"), so no profit changes. Costing switches on.
   The pre-go-live adjustments' "stock without a value" notes are closed as valued by the cutover.
5. **Packaging**: black poly ×1 per parcel on every parcel (a packing rule, from now on). Bubble poly: one roll is
   opened on go-live day if the count has a roll and none is open.
6. **Product cache** cleared and the attar products' read model refreshed; the script prints what the website sells per
   attar variant (filled + can be made).
7. **Finance checks** (read only, not recorded as runs). `--apply` exits non-zero if any `inventory.*` check isn't
   MATCHED.

### Rehearsal (2026-10-23, copy of `stock_qa` = production 2026-10-20 + the 2026-10-22 count correction)

Example counts file (0 filled bottles), `--accept-caps-difference` (website 45 + 2 waiting vs 43 counted),
`--accept-unfilled-orders`:

| | ৳ |
|---|---:|
| Inventory account (1610) before | 2,13,739.29 |
| Unfilled attar set aside (68 units, Cr 5150) | +25,180.00 |
| Ledger at the cutover | 2,38,919.29 |
| Valuation (materials 1,26,512.50 incl. polys + caps 45 × 587) | 1,52,927.50 |
| In-transit (open orders at cost; +13,676 from 174 lines given today's cost price) | 64,306.00 |
| True-up → 3900 opening-balance correction (5150: 0) | −21,685.79 |
| 1610 after = valuation + in-transit | 2,17,233.50 |

The true-up is the count script's 2026-10-22 pipeline holding the unfilled attar a second time (−25,180), plus caps
on the website above the count (+1,174), the polys now held as stock (+2,336) and the sticker rate in whole paisa
(−15.74). Every inventory check MATCHED; the two pre-existing differences of that copy (`commerce.receivables`,
`cost.completeness`) were there before. A second `--apply` changed no table (pg_stat insert/update/delete counters
identical). October profit: +25,180 in 5150 on go-live day only; after the 68 waiting bottles were filled (quick refill)
5150 was back to 0 for them, so the month's profit is what it was without the go-live. Website after go-live: Azhaar
6 ml 71, 12 ml 35; Royal 6 ml 145, 12 ml 98; Sweet 6 ml 37, 12 ml 18; Zayan 6 ml 120, 12 ml 60 (all made, none filled);
a checkout of one Azhaar 6 ml succeeded (stock −21 → −22, sells 71 → 70) and one above what can be made was refused.

## 5. API and safeguards

All under `/api/v1/finance`. Bought and Counted need an `Idempotency-Key` header; the same key replays (200), a different
request under it is refused (409 `IDEMPOTENCY_KEY_REUSED`).

| Route | Permission | Notes |
|---|---|---|
| `GET /stock` | `inventory.read` | The overview; values and average costs only with `costing.read` |
| `GET /stock/purchases?limit=` | `purchasing.read` | Recent purchases; amounts and unit costs only with `costing.read`; payment status read live |
| `GET /stock/purchases/:id` | `purchasing.read` | One purchase: `complete`, `pendingStep` |
| `POST /stock/purchases` | `purchasing.receive` (+ `purchasing.approve`, `ap.manage`, `finance.transact`; + `finance.sensitive` for the owner's own money) | 201 / 200 replay |
| `POST /stock/purchases/:id/finish` | as above | Completes a purchase stuck mid-way, optionally from another account while nothing has been paid (`PAID_FROM_LOCKED` otherwise) |
| `POST /stock/counts` | `inventory.adjust` | 201 / 200 replay |

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

Run it off-peak: the cutover locks every stock-tracked variant while it posts, so checkouts wait for a few seconds.

1. **Merge and deploy** the stock hub (the normal deploy; it runs the migrations).
2. **Count the shelf** that day — preferably right after filling and bagging every waiting attar order — and write
   the counts file from `apps/api/scripts/finance/asif-zone-stock-golive.counts.example.json` (every number, plus
   `countedOn` = today). Copy it to the server, e.g. `scp counts.json root@187.77.137.12:/tmp/counts.json`.
3. On the server:

   ```bash
   cd /opt/asifzone
   bash docker/backup.sh                                       # database + uploads backup first
   docker build -f apps/api/Dockerfile --target build -t asifzone-api-tools .   # tools image of the deployed code
   COMPOSE="docker compose -f docker/docker-compose.yml --env-file docker/.env"
   API=$($COMPOSE ps -q api)
   docker exec "$API" printenv | grep -Ev '^(PATH|HOSTNAME|HOME|NODE_VERSION|YARN_VERSION)=' > /tmp/api.env
   NET=$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' "$API")
   GOLIVE="docker run --rm --env-file /tmp/api.env --network $NET -w /repo/apps/api -v /tmp/counts.json:/tmp/counts.json asifzone-api-tools npx tsx scripts/finance/asif-zone-stock-golive.ts --as <owner admin email> --counts /tmp/counts.json"
   $GOLIVE                                  # dry run: read every number
   $GOLIVE --apply                          # add --accept-caps-difference / --accept-unfilled-orders only if the dry run asks and the numbers are right
   $GOLIVE --apply                          # must print "nothing to write (already live)"
   rm /tmp/api.env
   ```

4. **Check**: the run ends with every `inventory.*` check MATCHED (exit code 0); Finance › Reconciliation shows the
   same; `/admin/stock` shows the materials and what each attar can make; the shop sells attar up to that number.

If `--apply` stops half way (an error is printed), fix the cause and run it again: each step finds what an earlier run
made. Once the cutover has posted, stock is no longer set from the file — later counts go through Stock › Counted.
