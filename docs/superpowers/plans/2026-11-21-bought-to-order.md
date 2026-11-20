# Bought to order — count stock, never stop selling (Tahafi phase 1)

Owner decision 2026-11-21 (D1): Tahafi's jackets keep showing every size in stock, but the admin counts real stock so
purchases, goods receipts, the YG Fashion balance and "what to buy" work. Plan Doc: https://claude.ai/artifact/CD1fPGMS4wZereBjyritB3

## Idea

A READY product (sold from the shelf, not filled to order) that is stock-tracked may carry the selling rule the attar
already has (`Product.stockPolicy`): **UNLIMITED** (never sold out) or **BACKORDER** (up to N per size beyond the shelf).
Its stock then goes below zero when it sells faster than goods arrive — below zero = sold, not yet bought — and a goods
receipt covers it. No recipe, no filling: what covers the shortfall is a purchase.

The selling machinery already exists for fill to order: the capacity loader (`fill-capacity.service`) turns a policy into
an allowance (`policyExtra`), checkout takes floors (`fillToOrderFloors`) so stock may go negative, and costing treats units
issued beyond stock as an unbooked deficit covered by the next inflow. This change opens that path to READY products with a
policy, through one predicate, and leaves everything that is about recipes and filling to fill to order only.

`sellsPastShelf(p) = p.trackInventory && (p.fillToOrder || policyOf(p) !== "TRACKED")` (packages/shared), where a variant's
own policy overrides the product's.

## Changes

1. **Shared**: `sellsPastShelf` + tests. `stockPolicySchema` unchanged.
2. **Capacity loader** (`loadRecipes`): products where `fillToOrder` OR (`trackInventory` AND a non-TRACKED policy on the
   product or a variant). Recipes still only from fill-to-order products (a READY product has none → makeable 0, sellable =
   max(0, stock) + allowance).
3. **Selling path** — replace `fillToOrder` with `sellsPastShelf` where it decides availability or floors:
   pricing.service (quote), storefront read-model, category in-stock, product.service list/detail, order.service checkout
   floors + exchange preview, return-request exchange, order-modification + restore (`fillToOrderFloorsFor` — loader), flash
   sale select, `withFillToOrder` / `fillToOrderInStockIds` guards.
4. **Low stock alert** (order.service:548): a bought-to-order variant alerts at its threshold like any READY product (keep
   `!fillToOrder`, which already includes it).
5. **Stock policy** (`setStockPolicy`): allow UNLIMITED / BACKORDER on a tracked READY product (clothes, caps); refuse on an
   untracked one ("turn stock counting on first"). Stocking: READY with units owed stays allowed when the policy sells past
   the shelf.
6. **Counts** (count.service / count-approval): a variant that sells past the shelf may be counted below what is waiting to
   ship (its floor is −waiting), like fill to order.
7. **Costing** (`exitCost`): a bought-to-order exit beyond valued stock is an unbooked deficit at the moving average; with
   no average yet, at the product's cost price (the supplier price, owner-entered) as the provisional standard — never the
   catalog price silently, and NONE if there is no cost price. The goods receipt that covers it posts actual − provisional.
8. **Reorder** (stock-items.service:114): bought-to-order variants are bought, never "made" — they stay in reorder
   suggestions; units owed count as demand.
9. **Admin UI**: product › Stock: "When out of stock: Stop selling / Keep selling (count what's owed) / Allow up to N";
   stock lists show negative stock as "N owed" (not an error).
10. **Untouched**: auto-fill at booking, recipes, fill, production home, kits, store capabilities (production nav).

## Tests (TDD, Vitest, `stock-policy.integration.test.ts` style, literal expected values)

- A READY tracked product on UNLIMITED with stock 0: storefront shows in stock, quote sells 5, checkout takes stock to −5;
  TRACKED sibling at 0 still 409s.
- BACKORDER limit 2: third unit beyond the shelf refused.
- Untracked product: policy change refused.
- Goods receipt of 8 into stock −5: stock 3, deficit covered, ledger balances (`assertInventoryInvariants`, reconciliation).
- Cost: sale beyond stock with an average → unbooked at average; without one → at cost price, INVENTORY_PROVISIONAL.
- Count below waiting allowed for bought-to-order, refused for plain READY.
- Order modification / restore from Trash / exchange to a bought-to-order size never 409 on stock.
- Asif Zone / Nasihamart products (TRACKED, not fill) behave exactly as before (existing suites).

## Rollout

PR → CI → merge; live only on the owner's word. Tahafi switch (phase 2): owner counts physical stock → products to
trackInventory + UNLIMITED + count posted + cutover at YG prices → YG supplier + opening due (owner's figure).
