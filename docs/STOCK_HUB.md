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
- **Packaging per parcel**, when a parcel leaves: one black poly on every parcel, one bubble poly on every parcel that
  holds attar (packing rules; the material leaves stock into packaging cost).
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

A one-off script (`apps/api/scripts/finance/asif-zone-stock-golive.ts`, dry run first, then `--apply`; a second run
writes nothing):

1. **Materials** at the 2026-10-22 count: four oils in `ml` (Azhaar, Royal, Sweet, Zayan), bottle 6 ml, bottle 12 ml,
   box, sticker, black poly, bubble poly roll (`pcs`).
2. **Recipes** per attar product: 6 ml = oil 6 + bottle 6 ml 1 + box 1 + sticker 1; 12 ml = oil 12 + bottle 12 ml 1 +
   box 1 + sticker 1; wastage 0; approved.
3. **Attar variants' stock** = −(units on orders not booked with the courier) — the shelf holds no filled bottles.
4. **Valuation cutover** with costs (caps, materials at the bought rates, attar variants at their recipe cost); the
   difference is booked as "Stock counted 2026-10-22".
5. **`fillToOrder = true`** on the four attar products.
6. **Packing rules**: black poly every parcel ×1; bubble poly ×1 per parcel on each attar product.
7. **Read model rebuild** — the website then shows attar availability = makeable.

Afterwards every finance check must read MATCHED.

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
