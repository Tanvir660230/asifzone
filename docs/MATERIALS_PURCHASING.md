# Materials, purchasing and packaging

How Asif Zone buys and uses materials. It extends the stock hub (docs/STOCK_HUB.md), purchasing (docs/FINANCE_PHASE_4*.md)
and manufacturing (docs/MANUFACTURING.md); nothing here replaces them. Plan and audit: the owner-approved plan Doc of
2026-11-02 and docs/superpowers/plans/2026-11-02-materials-purchasing.md.

## §1 Materials

A material is a product of kind `MATERIAL` (unchanged). Added:

- **Type** — `Product.materialType`: RAW, PACKAGING or CONSUMABLE; null on finished goods (database CHECK) and on a material
  nobody has typed yet. Used for filters and reports only.
- **One material, one name** — creating a material whose name means the same as another (case, spaces and punctuation
  ignored, any script) is refused with `409 MATERIAL_DUPLICATE` and the matches; sending `duplicateReason` creates it anyway
  and the reason goes into the finance audit entry. A shared material is simply one that several recipes or packing rules
  name — there is no "shared" flag.
- **Reorder figures** — `StockItemSetting.reorderPoint` and `safetyStock` (stock units, optional). At or below its reorder
  point an item that would be OK shows LOW and its reorder suggestion is due today; the suggestion buys lead time + cover +
  safety stock (or, with no recent use, up to reorder point + safety stock). Empty = the days-of-cover rule alone.
- **Stock unit** — must be the smallest unit ever bought or used (stock is whole units). It can't change once the material
  has stock or any stock movement (`409 MATERIAL_UNIT_IN_USE`).

## §2 Purchase units

`MaterialPurchaseUnit` says "1 {label} = {factor} {stock unit}" for one material only (a bundle may be 200 stickers on one
item and 50 on another; nothing converts between materials).

- The purchase form sends a line either in the stock unit (`quantity`) or as `purchaseUnitId` + `purchaseQty`. The server
  converts, exactly (ten-thousandths × ten-thousandths in integers). A result that is not a whole number of stock units is
  refused, `400 PURCHASE_UNIT_NOT_WHOLE`, naming the whole amounts either side (1.5 tola = 17.4957 g → 17 or 18 g). Nothing
  is rounded silently.
- The goods receipt line keeps a snapshot: `purchaseUnitId`, `purchaseUnitLabel`, `purchaseUnitFactor`, `purchaseQty`
  (that receipt line's share, 4 decimals). It is informational — stock and value come from the stock-unit quantity. A
  database CHECK keeps the snapshot whole or absent.
- Editing a material's units: the list sent is the units on offer. A unit no purchase or order used is deleted when left out;
  a used one is archived (hidden from pickers, still named by its receipts) and its size can't change (`409
  PURCHASE_UNIT_IN_USE` — add a new label instead). Sending an archived label again restores it.
- "Units on the bill" (`documentTotal`) is counted as the bill shows it: 10 litre + 5 bundles + 1,000 pcs = 1,015.

## §3 Discount, damaged on arrival, extras

- `discount` per line: `amount` stays what was paid for the line after the discount — the only figure stock is valued at.
  The receipt stores `discountAmount` (spread over its lines) and `grossUnitPrice` = (amount + discount) ÷ units arrived, per
  stock unit, for price history.
- `damaged` per line, in stock units: units that arrived broken. They are rejected on the receipt (`qtyRejected`) — never
  stock, never value — and the line total is spread over the good units. At least one good unit (`PURCHASE_ALL_DAMAGED`);
  getting money back is a supplier return or credit note.
- `extrasMethod`: VALUE (default, as before) or QUANTITY — how the extras' landed cost (or, before costing is live, the
  catalog cost) is spread over the lines.

- **Already in stock without a purchase** — the duplicate check also warns when at least 70% of the items bought came into
  stock in the 30 days before without a purchase (restock, import, count gain), by at least half of what is being bought
  (`matchStockAdded`, duplicate-purchase.ts). Both live duplicates of October 2026 were of this kind. A warning only.

## §4 Ordered, not yet arrived

The purchase form asks **Has it arrived?** (only for people with `purchasing.manage`, once costing is live).

- **No, ordered** — `POST /stock/orders` makes a purchase order with the same lines (stock or purchase units, discount; no
  damaged units, no extras, no payment). No stock moves. It is approved at once when the person holds `purchasing.approve`,
  otherwise it waits SUBMITTED for an approver (Finance › Purchase orders). Its lines keep the purchase-unit snapshot and
  discount like a receipt. The Idempotency-Key rides in the order's delivery terms (`stock-order:<key>`) under an advisory
  lock, so a retry or double tap returns the same order.
- **Expected deliveries** — `GET /stock/orders/expected`: submitted, approved and part-received orders, oldest first, per
  item ordered / received / rejected / still to come (stock units, with the purchase unit). Shown on Stock while any exist.
- **Receive** — `POST /stock/orders/:id/deliveries`: per item good and damaged units. Good units are spread over the item's
  order lines by what each still waits for (beyond the order's tolerance an approver confirms on Finance › Purchase orders,
  as always); damaged units are rejected. The receipt is posted at the order's price. The bill is made now (optionally paid
  from a cash box, bank or wallet) or later (the receipt waits in GRNI and Finance › Bills); transport paid with the
  delivery is a landed cost over that receipt (by value or quantity). Every document carries `stock-delivery:<key>:<step>`,
  so a retry carries on from the step that failed and never writes twice.
- **Close short** — the existing close on Finance › Purchase orders ends an order whose rest will never come.

## §5 Packaging

- **One consumption point per material.** Recipe materials leave stock at the fill; packing-rule materials when the courier
  is booked. A packing rule (create, or switching one back on) that would take a material the product's approved recipe
  already takes is refused (`409 PACKING_RULE_IN_RECIPE`); approving a recipe that takes a material an active packing rule
  takes for that product is refused (`409 RECIPE_MATERIAL_IN_PACKING_RULE`). A rule for one size only clashes with a recipe
  line for every size or for that size.
- **Packaging on the product** — `GET /stock/products/:id/packaging` lists every rule that reaches a product (its own, a
  size, its category, every parcel). The product's kit panel shows them and adds or switches off the product's own and
  per-size rules (tupi packet + sticker per unit; polybag, hangtag per unit; a size sticker per size).
- **Wasted** — `POST /stock/waste` (materials only, `inventory.adjust`, idempotent): a DAMAGED movement out at the moving
  average with the reason typed. A loss at or over the count-loss approval threshold is the owner's to record.

## §6 Material usage report

`GET /stock/reports/material-usage?month=YYYY-MM` (read-only, `inventory.read`; Stock › Material usage): per material —
opening, bought, sent back, used in fills, what the month's closed fills planned from their recipes, packed, wasted, count
differences, other (order returns), closing. Opening and closing come from today's stock less later movements, so the row
always adds up. Flags: more used than the recipes say, count loss, count gain, waste.
