# Smart Stock page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/admin/stock` from a page of numbers into a page that says what to do today — fill, reorder, count, approve — and keeps working at 1,000+ items.

**Architecture:** Three new read endpoints (`/stock/today`, `/stock/items`, `/stock/items/:id/settings`) built on the existing `stockHub()` computation; one new table for per-item stock settings and one for count adjustments waiting for approval; an auto-fill hook after courier booking that calls `recordFill` (inventory recovery phase 3). The web page is rebuilt around a Today list and a filtered, paginated item list; the existing Bought / Filled / Counted sheets stay as the entry points, extended (batch fill, prefilled reorder, guided phone count).

**Tech Stack:** Express + Prisma + Postgres (Vitest integration tests on the test DB), Next.js 15 / React 19 / TanStack Query / Tailwind tokens, Playwright e2e.

**Spec:** proposal artifact https://claude.ai/artifact/DUaEDQnvRVP6LSwQoP5jzK (v2) + owner decisions 2026-10-24 (below). Domain rules: `docs/STOCK_HUB.md`.

## Owner decisions (2026-10-24)

- UI language: **English only**.
- Auto-record the fill at courier booking: **yes** — only the bottles not yet filled; filled bottles on the shelf are used first.
- Count losses by staff above **৳1,000** (at average cost) wait for owner approval; the owner's own counts never wait.
- Production, Production orders, Bills of materials, Materials leave the sidebar; they stay reachable as tabs.

## Dependency on another session

Inventory recovery phase 3 (session asif-zone-f5, worktree `C:/dev/asifzone-partner-guard`, uncommitted on 2026-10-24) adds
`POST /stock/fills` + `recordFill` (`apps/api/src/domain/stock/fill.service.ts`), `materialKind` on overview items,
`GET /stock/items/:id/trace`, `GET /api/orders/:id/fill-status`, and edits `stock-hub.tsx`, `stock-row.tsx`,
`filled-sheet.tsx`, `lib/api/stock.ts`, `owner-books.routes.ts`, `schema.prisma`.

- **Tasks 1–4 (API, new files only)** may start now on `feat/stock-smart`; new routes go in a NEW router file, schema
  additions are appended at the end of `schema.prisma`, migrations are dated `20261128*` (after `20261127100200`).
- **Tasks 5–10** start only after f5's branch is committed: rebase `feat/stock-smart` onto it (or onto main once merged).
  Never edit files in `C:/dev/asifzone-partner-guard`.

## Global Constraints

- Admin design: Apple-style, calm, **light only**; tokens from `packages/ui-tokens`, recipes in `apps/web/app/globals.css`,
  primitives in `apps/web/components/ui/*`, motion from `apps/web/lib/motion.ts`. No hard-coded colours.
- Every new UI handles loading, empty and error states and works at **375px**.
- Ships to both installations. Nasihamart has no fill-to-order products: every attar-only part must render nothing there
  (no empty "Fill" task, no fill filter chip) — check with `STORE_THEME=nasihamart`.
- Money is minor units in the API (`toMinor` / `toMajorNumber`); values and costs only with `costing.read`.
- Every write takes an `Idempotency-Key` (hub-entry.ts pattern); retries never double-book.
- Accounting rules are unchanged: count differences still post through `adjustVariantStockInTx`; fills through `recordFill`.
- Copy: plain English, sentence case, buttons name the action ("Mark 47 filled", toast "47 bottles marked filled").

## Review Focus

1. **Courier booking succeeds but the fill can't be made** (oil short, no recipe): the booking must stand, the bottles stay owed, and Today shows "3 booked bottles couldn't be filled — Sweet Luxe oil short". Test in Task 6.
2. **Bulk booking of 50 orders**: one failing fill must not stop the others or the bookings; each order fills once even if the bulk call is retried. Test in Task 6.
3. **An approval decided after stock moved**: approving a pending loss applies the difference recorded at count time, never a recomputed one; approving twice is a no-op. Test in Task 3.
4. **Item list at 1,500 items**: `/stock/items?status=NEEDS_FILL&limit=50` answers under 800 ms on the test DB with 1,500 seeded variants, and paging never repeats or skips a row (stable sort by urgency then sku). Test in Task 2.
5. **Nasihamart (no attar, no materials)**: Today shows only reorder/count tasks or "All caught up"; no fill UI rendered. Test in Task 7 e2e.

---

### Task 1: Per-item stock settings (supplier, lead time, cover days)

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (append at end)
- Create: `apps/api/prisma/migrations/20261128100000_stock_item_settings/migration.sql`
- Create: `apps/api/src/domain/stock/item-settings.service.ts`
- Create: `packages/shared/src/schemas/stock-settings.ts` (export from the shared index)
- Test: `apps/api/src/domain/stock/item-settings.integration.test.ts`

**Interfaces:**
- Produces: model `StockItemSetting { id, variantId @unique, preferredSupplierId String?, leadTimeDays Int @default(3), coverDays Int @default(30), updatedAt, updatedByAdminId String? }`;
  `getItemSettings(variantIds: string[]): Promise<Map<string, ItemSettings>>` (missing row → defaults `{ preferredSupplierId: null, leadTimeDays: 3, coverDays: 30 }`);
  `setItemSettings(variantId: string, input: StockItemSettingsInput, actor: FinanceActor): Promise<ItemSettings>` (audit `stock.item_settings`);
  `lastPurchasePrice(variantIds: string[]): Promise<Map<string, { unitCost: number; supplierId: string; date: string }>>` from the latest posted `GoodsReceiptLine` per variant.
- Zod: `stockItemSettingsSchema = { preferredSupplierId: string|null, leadTimeDays: int 0..120, coverDays: int 7..180 }`.

- [ ] Step 1: Tests — `defaults when no row`, `set then get round-trips`, `rejects coverDays 5 (400)`, `lastPurchasePrice picks the newest receipt line and ignores reversed receipts`.
- [ ] Step 2: Run `pnpm --filter api exec vitest run src/domain/stock/item-settings.integration.test.ts` → FAIL.
- [ ] Step 3: Model + migration + service.
- [ ] Step 4: Run → PASS. `pnpm --filter api exec prisma validate` clean.
- [ ] Step 5: Commit `feat(stock): per-item supplier, lead time and cover days`.

### Task 2: Item list API — status, search, paging, reorder suggestion

**Files:**
- Create: `apps/api/src/domain/stock/stock-items.service.ts`
- Create: `apps/api/src/modules/finance/stock-smart.routes.ts` (mounted beside owner-books routes, same `/api/v1/finance` prefix)
- Modify: the router index that mounts `owner-books.routes.ts` (one `use` line)
- Test: `apps/api/src/domain/stock/stock-items.integration.test.ts`

**Interfaces:**
- Consumes: `stockHub(viewer)` items (`StockHubItem`), Task 1 `getItemSettings`, `lastPurchasePrice`.
- Produces: `GET /stock/items?status=&group=&q=&cursor=&limit=` (`inventory.read`) →
  `{ items: StockListItem[], counts: Record<StockStatus | "ALL", number>, nextCursor: string | null }`.
  `type StockStatus = "NEEDS_FILL" | "OUT" | "LOW" | "OK"`;
  `StockListItem = StockHubItem & { status: StockStatus; canSell: number | null; limitedBy: { sku: string; name: string } | null; reorder: { suggested: number; orderBy: string | null } | null; settings: ItemSettings }`.
  `classify(item): StockStatus` — NEEDS_FILL when `policy?.owed > 0`; OUT when sellable is 0; LOW when `item.low`; else OK.
  `suggestedReorder = max(0, ceil(usedPerDay × (leadTimeDays + coverDays)) − available)`; `orderBy = today + (daysLeft − leadTimeDays)` days, null when no use.
  Sort: NEEDS_FILL (owed desc) → OUT → LOW (daysLeft asc) → OK (name); tie-break sku. Cursor = opaque offset of that sort.
  `limitedBy`: the recipe material that caps `makeable` (reuse fill-capacity's per-line computation; export a helper from a new file if fill-capacity.service.ts is under f5's edit — do not modify it).
- [ ] Step 1: Tests — `status for owed attar is NEEDS_FILL`, `q matches sku and product name case-insensitively`, `counts ignore the status filter but honour q`, `paging 1,500 seeded variants by 50 returns each exactly once` (Review Focus 4, with a timing assert < 800 ms), `suggested reorder for 10/day, lead 3, cover 30, 100 on hand = 230`, `values null without costing.read`.
- [ ] Step 2: Run → FAIL. Step 3: implement. Step 4: Run → PASS.
- [ ] Step 5: Commit `feat(stock): filtered, paged stock list with status and reorder suggestions`.

### Task 3: Count losses above the limit wait for the owner

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (append), migration `20261128100100_count_approvals`
- Modify: `apps/api/src/domain/stock/count.service.ts` (not in f5's change set — re-check `git status` in their worktree before editing)
- Create: `apps/api/src/domain/stock/count-approval.service.ts`
- Modify: `packages/shared/src/permissions.ts` — add `"inventory.approve"` (OWNER only; FINANCE_ADMIN too)
- Routes: `stock-smart.routes.ts`
- Test: `apps/api/src/domain/stock/count-approval.integration.test.ts`; update `apps/api/src/domain/auth/authorization.integration.test.ts` role matrix

**Interfaces:**
- Produces: model `StockCountApproval { id, businessId, stockCountId @unique, variantId, difference Int, reason String, valueMinor Int, status ("PENDING"|"APPROVED"|"REJECTED"), requestedByAdminId, decidedByAdminId?, decidedAt?, note?, createdAt }`;
  setting `FinanceBusiness.countApprovalLimitMinor Int @default(100000)` (৳1,000);
  in `recordCounts`: a shortfall line whose `|difference| × avgCost` ≥ limit, by an actor without `inventory.approve`, records the StockCount and a PENDING approval and posts **no** adjustment; the line's outcome carries `pendingApprovalId`.
  `GET /stock/approvals?status=PENDING` (`inventory.read`), `POST /stock/approvals/:id/approve|reject` (`inventory.approve`, Idempotency-Key) — approve calls `adjustVariantStockInTx` with the **recorded** difference and the count's reason/source; second decision → 200 replay, no write.
- [ ] Step 1: Tests — `staff count 4 short at ৳460 each → pending, stock unchanged`, `owner same count → adjusted at once`, `gain never waits`, `approve applies −4 even if 2 sold meanwhile` (Review Focus 3), `approve twice writes once`, `reject keeps the count, stock unchanged`, `STAFF lacks inventory.approve` (matrix).
- [ ] Step 2: FAIL → Step 3: implement → Step 4: PASS, plus full `count.service` suites.
- [ ] Step 5: Commit `feat(stock): staff count losses over ৳1,000 wait for the owner`.

### Task 4: Today API

**Files:**
- Create: `apps/api/src/domain/stock/stock-today.service.ts`, route in `stock-smart.routes.ts`
- Test: `apps/api/src/domain/stock/stock-today.integration.test.ts`

**Interfaces:**
- Consumes: Task 2 list computation (call the service function, not HTTP), Task 3 pending approvals.
- Produces: `GET /stock/today` (`inventory.read`) →
  ```ts
  { fill: { bottles: number; orders: number; lines: { variantId; name; owed }[]; short: { sku; name; need; have }[] } | null,   // null when nothing owed or no fill-to-order products
    fillProblems: { orderNumber; variantId; name; units; reason }[],   // filled from Task 6's StockAutoFillFailure rows; [] until then
    reorder: { items: { variantId; name; daysLeft; suggested; orderBy; supplier: { id; name } | null }[]; suppliers: number } | null,
    count: { due: { variantId; name }[]; minutes: number } | null,
    approvals: { id; name; difference; value: number | null; by: string }[] }
  ```
  Count due list = cycle count: rank items by 30-day use value; top 80% of value → every 7 days, next 15% → 30, rest → 90; due when last StockCount older than its interval (never counted = due); at most 8, highest value first; `minutes = ceil(due × 0.75)`.
- [ ] Step 1: Tests — `nothing owed → fill null`, `owed 23+14 across 2 orders → bottles 37, orders 2`, `material short for the owed bottles lists it`, `cycle count interval classes with a seeded value spread`, `at most 8 due`, `approvals listed only PENDING`, `store with no fill-to-order products → fill null` (Review Focus 5, API half).
- [ ] Step 2–4: FAIL → implement → PASS.
- [ ] Step 5: Commit `feat(stock): Today — what to fill, reorder, count and approve`.

**— Rebase onto f5's committed phase 3 before Task 5 —**

### Task 5: Web API client + Stock page shell (Today + list)

**Files:**
- Modify: `apps/web/lib/api/stock.ts` (types + `getStockToday`, `listStockItems`, `setItemSettings`, `listApprovals`, `decideApproval`)
- Rewrite: `apps/web/components/admin/stock/stock-hub.tsx` (header, Today, list; keep the incomplete-purchase alerts and go-live state)
- Create: `apps/web/components/admin/stock/today-list.tsx`, `stock-list.tsx` (search, status segmented control with counts, rows, "Load more"), `item-panel.tsx` (opens f5's trace view + a Settings tab bound to Task 1)
- Remove after replacing: group components in `stock-row.tsx` that the list supersedes (keep any f5 still imports)
- Test: `apps/web/e2e/admin-stock-hub.spec.ts` (extend)

**Interfaces:** Header actions renamed: **Received goods** (was Bought), **Filled bottles** (was Filled), **Count** (was Counted) — same sheets and test ids (`stock-action-bought|filled|counted`). Today rows: test ids `today-fill`, `today-reorder`, `today-count`, `today-approval`, `today-clear` ("All caught up"). List: `stock-list`, `stock-filter-<STATUS>`, `stock-row-<sku>`.
- [ ] Step 1: Write e2e `Today shows the fill task and opens the fill sheet`, `filter Needs filling shows only owed sizes`, `search narrows the list`, phone 375px snapshot has no horizontal scroll.
- [ ] Step 2: Implement with `Card`, `Badge`, `Button`, `SegmentedControl`/`Tabs` primitives; status pill colours from semantic tokens (info/warning/success/danger).
- [ ] Step 3: Loading (skeleton rows), empty ("Nothing needs filling"), error (ErrorState + retry) for Today and list.
- [ ] Step 4: `pnpm --filter web lint`, `pnpm --filter web exec tsc --noEmit`, e2e on a go-live rehearsal DB copy (`stockrel_golive` template).
- [ ] Step 5: impeccable critique + web-design-guidelines pass on the changed files; screenshots desktop + 375px; fix.
- [ ] Step 6: Commit `feat(stock): Today and a searchable stock list`.

### Task 6: Auto-fill at courier booking

**Files:**
- Create: `apps/api/src/domain/stock/auto-fill.service.ts`; schema append `StockAutoFillFailure { id, orderId, variantId, units, reason, createdAt, resolvedAt? }`, migration `20261128100200_auto_fill`
- Modify: `apps/api/src/modules/courier/courier.service.ts` — call after the order update in `bookOrderWithSteadfast` (after line ~214) and per booked order in `bookOrdersWithSteadfastBulk`
- Test: `apps/api/src/domain/stock/auto-fill.integration.test.ts`

**Interfaces:**
- Consumes: f5's `recordFill(input: StockFillInput, actor: FinanceActor, key: string)`, `waitingLines` (fill-status.service).
- Produces: `fillForBookedOrder(orderId: string): Promise<{ filled: { variantId; units }[]; failed: { variantId; units; reason }[] }>`.
  For each fill-to-order line of the order: units this order still needs = its AWAITING/PARTLY share from `waitingLines` evaluated **before** booking removed it from the shelf (compute the share first, then book). Calls `recordFill` with key `auto-fill:<orderId>:<variantId>` and actor = system actor of the booking admin. Never throws: errors are written to `StockAutoFillFailure` and logged; the booking response is unchanged. Resolved automatically when a later manual fill covers the units.
- [ ] Step 1: Tests — `booking an order of 2 owed Azhaar 6 ml fills 2 and moves oil 12 ml`, `filled bottle on the shelf is used first: owed 1 of 2 → fills 1`, `oil short → booking stands, failure row, stock still owed` (Review Focus 1), `bulk of 3 with one short → 2 fill, 1 failure, all booked` (Review Focus 2), `retrying the same booking fills once`, `non-attar order → no fill call`, every inventory.* finance check MATCHED after.
- [ ] Step 2–4: FAIL → implement → PASS; run `courier` and `fill-to-order` suites too.
- [ ] Step 5: Commit `feat(stock): record the fill when an attar parcel is booked`.

### Task 7: Batch fill sheet

**Files:**
- Modify: `apps/web/components/admin/stock/filled-sheet.tsx` (on top of f5's version: keep its wastage panel per line, collapsed by default)
- Test: e2e in `admin-stock-hub.spec.ts`

**Interfaces:** Opens with every owed size pre-ticked at its owed count (from `/stock/today` `fill.lines`), steppers per line, a "Takes from stock" summary summed over ticked lines, button "Mark N filled". Saves **sequentially**, one `POST /stock/fills` per line with key `batch:<formId>:<variantId>`; shows per-line progress; on a failure stops, keeps saved lines marked done, shows the problem; a retry resumes (same keys replay). Opening from "Filled bottles" with nothing owed shows the single-size form (pre-fill for later).
- [ ] Step 1: e2e `mark all owed filled in one save → owed 0 everywhere`, `untick one line → it stays owed`, `material short on line 3 → lines 1–2 saved, 3 shows the shortage, retry saves 3 only`, Nasihamart: no Filled action (Review Focus 5).
- [ ] Step 2: Implement. Step 3: run e2e + lint. Step 4: Commit `feat(stock): fill every waiting bottle in one form`.

### Task 8: Reorder review → Received goods prefilled

**Files:**
- Create: `apps/web/components/admin/stock/reorder-sheet.tsx`
- Modify: `bought-sheet.tsx` (accept `initialLines: { variantId; qty; lastUnitCost? }[]`, show "Last time ৳x/unit" under each line, warn when entered unit cost > last × 1.2 — warning only, never blocks)
- Test: e2e

**Interfaces:** Reorder sheet groups `today.reorder.items` by supplier (none → "No supplier set — set one in the item's settings"), ticks all, editable quantities, button "Record as received…" opens Bought with those lines and the supplier. Copy: "Order by Thu 30 Oct" from `orderBy`.
- [ ] Step 1: e2e `reorder opens Received goods with the suggested quantities`, `price 25% above last shows the check message`.
- [ ] Step 2–3: implement, lint, e2e. Step 4: Commit `feat(stock): reorder list by supplier, prefilled purchases with last price`.

### Task 9: Guided count (phone) + approvals UI

**Files:**
- Create: `apps/web/components/admin/stock/guided-count.tsx`, `approval-sheet.tsx`
- Modify: `counted-sheet.tsx` (entry point: "Start this week's count" uses `today.count.due`; desktop keeps the full list)
- Test: e2e

**Interfaces:** One item per screen: name, "Books say N" (expected), large numeric input (`inputMode="numeric"`), live difference, reason chips (Damaged / Lost / Sample / Miscounted before; gain: Found / Miscounted before), Back / Next / Skip, progress "3 of 7". Last step: summary (matched / short / over, total value with `costing.read`), "Save count" posts one `/stock/counts` call. Lines returned with `pendingApprovalId` show "Waiting for the owner's approval". Approval sheet: count, who, value, Approve / Reject (with note).
- [ ] Step 1: e2e at 375px `guided count of 3 items saves one count`, `staff loss over ৳1,000 shows waiting`, owner `approve applies it`.
- [ ] Step 2–3: implement, lint, e2e. Step 4: Commit `feat(stock): count one item at a time on the phone; approve big losses`.

### Task 10: Navigation, docs, release checks

**Files:**
- Modify: `apps/web/lib/admin/navigation.ts:263-271` — sidebar under Inventory shows **Stock** and **Production** only; `inventory.stock`, `inventory.production-orders`, `inventory.boms`, `inventory.materials` keep their routes and appear as tabs on the Production page (and Stock levels as a link in the item panel). Keep Ctrl+K keywords.
- Modify: `docs/STOCK_HUB.md` (Today, list, settings, auto-fill, approvals), `docs/MASTER_SYSTEM_INVENTORY.md` (new endpoints/tables)
- Test: existing nav unit tests + `admin-dashboard.spec.ts` Ctrl+K

- [ ] Step 1: Update nav test expecting sidebar children `["Stock", "Production"]` for inventory; run → FAIL → change → PASS.
- [ ] Step 2: Full checks: `pnpm --filter api test` (alone — no concurrent vitest), `pnpm --filter web lint`, `pnpm --filter web test:e2e admin-stock-hub.spec.ts`, both themes screenshot (`STORE_THEME=default` / `nasihamart`) desktop + 375px.
- [ ] Step 3: `/code-review` on the branch; fix.
- [ ] Step 4: Commit `docs(stock): smart stock page`, open PR (owner merges; deploy per runner notes).
