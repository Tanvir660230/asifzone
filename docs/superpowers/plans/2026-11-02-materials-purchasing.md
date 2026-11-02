# Materials, purchasing & packaging — implementation plan and progress

**Read this first when resuming (any Claude account).** Plan Doc (owner-approved 2026-11-02, "implement koro"):
https://claude.ai/artifact/TTnGEdbuS5KpiyPJLL3No2 — sections referenced below as §n.

- Worktree: `C:/dev/asifzone-materials`, branch `feat/materials-purchasing` (base origin/main 63adb0a2).
- Test DB: `materials_test` on local Postgres :5432 (apps/api/.env.test). Run ONE vitest at a time.
- Owner talks Bangla (বাংলা অক্ষর in chat); UI text English; code/commits English.
- Never force finance/stock values on live data; no price changes; nothing deployed without owner OK for these migrations.

## Defaults taken for the open questions (owner may override)

| Q | Default used |
| --- | --- |
| Q2 partial deliveries / paid ahead | Build P3 (the brief requires partial receiving) |
| Q3 caps separate from bottles | No data change; owner adds a cap material if needed |
| Q4 purchase units | Owner enters them per item (UI) |
| Q5 approval of "Ordered" | Auto-approved when the person holds `purchasing.approve`; otherwise the order waits SUBMITTED |
| Q6 tupi/T-shirt packaging | Owner sets packing rules in the new Packaging block |
| Q7 gift packaging at checkout | Not built (P6 skipped) |
| Q8 pre-packing | Not built |
| Q9 reorder points | Optional per item; empty = current days-of-cover rule |

## Phases (one commit group each; tick when done + verified)

### P1 + P2 — DONE (API + web) 2026-11-02; UI screenshots still to take at the end
- [ ] Migration: `MaterialPurchaseUnit.archivedAt`; `GoodsReceiptLine` + `PurchaseOrderLine`: `purchaseUnitId?`, `purchaseUnitLabel?`, `purchaseUnitFactor?`, `purchaseQty?`
- [ ] materials.service: purchase units edited by id (add / archive / restore), never deleted once used; stock unit locked after first movement
- [ ] stockPurchaseSchema lines: `purchaseUnitId?` + `purchaseQty?` (server converts; refuses non-whole result with nearest options); `documentTotal` counted in bill units
- [ ] purchase.service: conversion + snapshot onto receipt lines (direct receipt) ; simple mode keeps it in steps
- [ ] bought-sheet: send unit id + qty, show "= N stock units", bill units total
- [ ] Tests

### P2 — purchase form details (§3, §5, §6.2, D1, D4, D5)
- [ ] Migration: `Product.materialType` (RAW/PACKAGING/CONSUMABLE), `GoodsReceiptLine`/`PurchaseOrderLine` `grossUnitPrice?`, `discountAmount?`; `StockItemSetting.reorderPoint?`, `safetyStock?`
- [ ] Line discount; damaged on arrival (qtyRejected); extras method QUANTITY/VALUE
- [ ] Duplicate material check (normalised name) with force + reason
- [ ] Material type in materials form + stock list filter; reorder figures in item settings
- [ ] Tests

### P3 — Ordered and Expected (§4)
- [ ] `POST /stock/purchases` with `arrived:false` → approved (or submitted) PO
- [ ] `GET /stock/purchases/expected`, `POST /stock/purchases/orders/:poId/deliveries` (idempotent; good/damaged; bill now or later)
- [ ] Close short via existing close
- [ ] Duplicate check also against cutover lines/journals
- [ ] Expected tab UI
- [ ] Tests

### P4 — packaging (§7.2, §7.4, §8)
- [ ] Overlap guard: packing rule vs approved recipe for the same product (both directions)
- [ ] Packaging block on kit panel (list/add/deactivate rules reaching the product)
- [ ] `POST /stock/waste` (DAMAGED with note)
- [ ] Tests

### P5 — material usage report (§9.3)
- [ ] `GET /stock/reports/material-usage?month=YYYY-MM` read-only
- [ ] Stock › Usage view
- [ ] Tests

### Finish
- [ ] Full API suite, web lint/tsc/unit, stock + purchasing e2e
- [ ] UI screenshots desktop + 375 px
- [ ] Code review; PR; ask owner before merge (migrations touch stock/purchase rules)

## Progress log (newest last)

- 2026-11-02: plan approved; worktree created.
- 2026-11-02: P1+P2 API done: migration 20261209100000_materials_purchasing; materials.service (type, duplicate check, unit reconcile, unit lock); purchase.service (server conversion, damaged, discount, extrasMethod); goods receipt snapshot; reorder point. Test: src/domain/stock/materials-purchasing.integration.test.ts (13 pass). Next: web (bought-sheet, materials page, item settings), then P3.
- Resume recipe: `pnpm install`, `pnpm --filter @clothing-brand/shared build`, test DB materials_test (`DATABASE_URL=postgresql://postgres@localhost:5432/materials_test?schema=public npx prisma migrate deploy` in apps/api). Edits were applied with node scripts in the session scratchpad; nothing depends on them.
- 2026-11-02: P1+P2 web done: bought-sheet (unit id sent, inexact flagged, discount/damaged, extras share method), materials page (type, filter, duplicate prompt), item panel (reorder at / always keep). Next: P3 Ordered + Expected.
- 2026-11-03: P3 API done (order.service.ts; POST /stock/orders, GET /stock/orders/expected, POST /stock/orders/:id/deliveries; 17 tests pass; role matrix 790). Next: P3 web (Bought sheet 'arrived?' switch + Expected list + delivery sheet).
- 2026-11-03: P3 web done (bought-sheet arrived/ordered switch, expected-orders.tsx with DeliverySheet). Next: P4 packaging.
