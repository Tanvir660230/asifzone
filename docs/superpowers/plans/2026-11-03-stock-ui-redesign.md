# Stock, purchasing, production & packaging — UI redesign (plan, awaiting owner approval)

Mockup: https://claude.ai/artifact/1exrQVS2TKHKS3PJ8hBVWr (5 boards). UI only: no backend/DB/API change. Owner said: no commit/deploy without approval.

## Problems found (2026-11-03, on main 8f8b49ed)
1. Two tab levels: Stock tabs (Stock, Purchases, Suppliers, Material usage, Production, History, More) + Production's own tabs (Home, Runs, Recipes, Materials). Materials hidden under Production; POs, returns, bills, packaging under More → Finance pages.
2. Purchase = a modal with stacked line cards; bulk purchases scroll; price only as "paid in all"; no draft.
3. Purchases list shows receipts only; orders on the way live on the Stock page; PO detail is a Finance page.
4. Production home: 4 identical nav cards duplicating the tabs; packaging rules split between Finance › Packaging and the product kit.
5. Big headings (H1 ~40px), many chips/badges; status colours not uniform.

## Proposal
- One Stock section with a grouped side menu (desktop) / section picker (phone): Inventory (Materials & items, Movements, Counts & reconciliation) · Purchase (Purchases, Suppliers) · Production (Recipes, Production runs) · Packaging · Reports (Material usage, Stock value, Purchase reports). Existing routes kept; old tab bar replaced; Finance keeps its own links.
- Materials & items: one compact table (name+SKU, type, in stock, free, status sentence, used by, avg cost), filter chips (To buy / Out / Shared), side detail panel (used by, recent movements, buy/count/wasted).
- New purchase: full page (not modal), editable table (item, qty, unit, into-stock conversion, price/unit, discount, damaged, line total), extras row with share method, sticky summary (to pay, units on the bill check, paid from), draft kept on this device (localStorage — backend has no hub drafts). Arrived/Ordered switch.
- Purchases: one list of orders + receipts with progress, statuses (On the way, Part arrived, Waiting for approval, Bill to enter, Received · paid); receiving inline in the expanded row (ordered/received/to come/good now/damaged), close short.
- Production run page: stepper status, product/recipe/qty, shortage callout naming material & amount, requirement table with used/wasted, packaging panel for the product.
- One status vocabulary + colours: grey OK, orange to buy/waiting, red out/short, blue in progress, green done.

## Limits (backend)
- No Packaging Orders entity (packaging consumed at courier booking via packing rules) → "Packaging" page = packaging BOM per product, not orders.
- No purchase drafts server-side → device draft only.
- Per-line "additional cost" not stored → extras per purchase, share shown per line.
- Production runs = existing production orders/fills; partial receive supported.

## Implementation order (after approval)
1 Stock layout + side menu → 2 Materials table + detail panel → 3 Purchase page (replaces Bought sheet; same API) → 4 Purchases list + inline receiving → 5 Production run page + packaging page → 6 polish, a11y, 375px, e2e (admin-stock-hub, admin-finance-purchasing) updates.

## Progress (branch feat/stock-ui-redesign, worktree C:/dev/asifzone-materials — UNCOMMITTED, owner said no commit without approval)
- 2026-11-03 done: grouped Stock side menu (components/admin/stock/stock-side-nav.tsx; layouts stock/, manufacturing/, inventory/; finance-group-frame + shell section bar hidden on lg for these paths; module-tabs lg:hidden there). New purchase page /admin/stock/purchases/new (BoughtSheet asPage, price-per-unit field, device draft key asifzone:purchase-draft:v1, nav node inventory.purchase-new). Purchases page: Expected deliveries on top + Received list. Materials page: "Needs" column from /stock/items. Production home: cards → header buttons. Production order: shortfalls named with need/have/short + buy link.
- Checks: web tsc clean, eslint clean on changed files, web vitest 135/135. Screenshots desktop+375 in .playwright-mcp/r2-*, r3-*.
- 2026-11-03 later (owner: "full kaz properly shes koro"): Expected deliveries get a status pill (On the way / Part arrived / Waiting for approval, Late in red) and an arrived-of-ordered progress bar; production run page gets a 5-step stepper (Plan → Approved → Making → Received → Closed; phones name only the current step) and a Packaging panel (every-parcel + this-product rules with stock); Packaging page groups rules (Every parcel / By category / By product) with Out / Buy soon beside each; Materials table puts the SKU under the name so actions fit beside the side menu; main sidebar no longer repeats the Stock pages on lg (the side menu lists them).
- Kept as two lists (Expected deliveries above Received) rather than one merged table: orders and receipts come from different APIs with different pagination; merging needs a server endpoint.
- Checks: web tsc 0, eslint 0 on changed files, vitest 135/135; e2e admin-stock-hub + admin-finance-purchasing + admin-section-bar + admin-customers all pass desktop+mobile (local stack :4930/:3930 on materials_test; staff via scripts/create-e2e-staff.ts); no horizontal overflow at 1440 or 375 on purchases, new purchase, materials, packaging, production run.
