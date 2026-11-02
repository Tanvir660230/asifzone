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

## §4 Ordered, not yet arrived

See the plan; documented here when built.

## §5 Packaging

See the plan; documented here when built.

## §6 Material usage report

See the plan; documented here when built.
