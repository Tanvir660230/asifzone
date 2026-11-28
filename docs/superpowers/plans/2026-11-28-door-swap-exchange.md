# Door-Swap Exchange — Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff start a size/colour/defect exchange from a delivered order; the replacement ships as a linked exchange order whose parcel carries the full price as protected COD and a Bangla rider note, so the customer pays only the fee when the old item is handed over and the full price when it isn't.

**Architecture:** Reuse `ReturnRequest` (type `EXCHANGE`) as the link between the original order and the replacement order, adding door-swap columns (reason, fee, protected COD, swap status, evidence). A new `door-swap.service.ts` creates request + replacement order in one transaction without restocking the original item (that waits for the parcel scan, phase B). Courier booking asks one helper for the COD to book, so an open door swap books its protected amount. Sales/metrics already exclude orders linked by `ReturnRequest.exchangeOrderId`.

**Tech Stack:** Express + Prisma + Postgres (Vitest integration tests on `clothing_brand_test`), Next.js 15 admin (React 19, react-query), Playwright e2e.

**Spec:** this file, section "Design" below (decided 2026-11-28 from the live data audit; owner delegated the decisions: "vebe chinte best solution koro").

## Design (the spec)

Live data (Tahafi 11-04…11-28, 9 exchange chains; AZ 30 days) showed: exchanges entered as fee-only orders (৳70/100/120/135) so a customer could keep both items; no link between original and replacement; a torn item ("Product chira geche") charged a fee and nothing kept it off the shelf; exchanges marked RETURNED on the original (09W4RB: false refund due); old items never received into stock.

Rules:
1. Reasons: `CUSTOMER_SIZE`, `CUSTOMER_COLOR` (customer's choice → customer pays the fee) and `WRONG_ITEM_SENT`, `DEFECT` (our fault → fee 0). `DEFECT` and `WRONG_ITEM_SENT` require an evidence note (e.g. "WhatsApp photo seen").
2. Window from the original's delivery: 3 days for customer reasons, 7 days for our-fault reasons. Past it: refused with `EXCHANGE_WINDOW_PASSED` unless `overrideReason` (≥ 5 chars) is given — recorded on the request.
3. Fee (customer reasons): the delivery fee the store charges for the order's district (inside/outside Dhaka from the quote); staff may override with any amount ≥ 0.
4. Money: replacement order `subtotal` = new item value, `discount` = credit for the old item (≤ new value), `shippingFee` = fee, `total` = fee + max(0, new − old). A cheaper new item leaves no refund in phase A (recorded as `refundDue` 0; staff use store credit by hand).
5. Protected COD booked with the courier = fee + full new item value (what keeping both costs). The rider note says both numbers.
6. Original order keeps its status (never marked RETURNED by an exchange); the old item is **not** restocked at creation.
7. One open door swap per original order item (`swapStatus` `AWAITING_SWAP`).
8. Rider note (Bangla, prepended to the parcel note): `এক্সচেঞ্জ: পুরনো {name} {size}/{color} হাতে নিয়ে শুধু ৳{total} নিন। পুরনোটা না দিলে ৳{protectedCod} নিন, নইলে নতুনটা ফেরত আনুন।` (our-fault, total 0: `…হাতে নিয়ে কোনো টাকা নেবেন না।`)

Phase B (separate plan): outcome from Steadfast COD facts (fee → SWAPPED, full → KEPT_BOTH becomes a sale, returned → REFUSED), parcel scanner expects the old item, DEFECT items to a not-for-sale bin, "old item not back after 5 days" list. Phase C: exchange report by product × size.

## Global Constraints

- Money is integer minor units in services (`fromMajor`/`toMajor`, existing helpers); never trust client prices.
- Admin UI English, light, Apple-style; tokens/primitives only (`apps/web/components/ui/*`), works at 375 px with loading/empty/error states.
- Rider note text is Bangla exactly as in rule 8.
- Permission: `orders.manage`. Idempotency-Key header honoured (same key → same request).
- A shared change ships to all three stores; nothing brand-specific.
- Migration is additive (new nullable columns + enums); no data rewrite.

## Review Focus

- Variant out of stock or same as the original → 409 / 400 with a clear message, nothing written.
- Original order not delivered (PENDING/SHIPPED/CANCELLED) or deleted → 400.
- Double-click "Create exchange" → one request, one replacement order (idempotency key).
- Booking the replacement through the **bulk** booking path also uses the protected COD.
- Original item already returned in full (ReturnRequest RETURN lines) → refused like the existing `priceExchange` guard.

---

### Task 1: Schema — door-swap columns on ReturnRequest

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (model `ReturnRequest`, new enums)
- Create: `apps/api/prisma/migrations/20261128120000_door_swap_exchange/migration.sql`
- Modify: `packages/shared/src/schemas/` — new `door-swap.ts`, export from index

**Interfaces:**
- Produces: enums `ExchangeReason { CUSTOMER_SIZE CUSTOMER_COLOR WRONG_ITEM_SENT DEFECT }`, `SwapStatus { AWAITING_SWAP SWAPPED KEPT_BOTH REFUSED OLD_RECEIVED OLD_MISSING }`; ReturnRequest columns `swap Boolean @default(false)`, `exchangeReason ExchangeReason?`, `exchangeFee Decimal? @db.Decimal(10,2)`, `protectedCod Decimal? @db.Decimal(10,2)`, `swapStatus SwapStatus?`, `evidenceNote String?`, `overrideReason String?`; index `@@index([orderItemId, swapStatus])`.
- Produces (shared): `createDoorSwapSchema = z.object({ orderItemId: cuid, requestedVariantId: cuid, reason: z.enum(EXCHANGE_REASONS), evidenceNote: nullableString(300), fee: z.number().min(0).max(5000).optional(), overrideReason: nullableString(200) })` with refine: evidenceNote required (≥ 3 chars) for `DEFECT`/`WRONG_ITEM_SENT`; `type CreateDoorSwapInput`; `EXCHANGE_OUR_FAULT = ["WRONG_ITEM_SENT","DEFECT"]`; `EXCHANGE_WINDOW_DAYS = { customer: 3, ours: 7 }`.

- [ ] Step 1: Add enums/columns, write migration with `prisma migrate diff`, apply to the test DB (`DATABASE_URL=<.env.test> npx prisma migrate deploy`) — never use the dev/test DB as shadow DB.
- [ ] Step 2: Shared schema + unit test `door-swap.test.ts`: DEFECT without evidence fails with "Say what proves the defect"; CUSTOMER_SIZE without evidence passes; fee −1 fails.
- [ ] Step 3: `pnpm --filter @clothing-brand/shared build && npx vitest run` (shared) → PASS. Commit.

### Task 2: `createDoorSwap` service

**Files:**
- Create: `apps/api/src/modules/return-requests/door-swap.service.ts`
- Modify: `apps/api/src/modules/return-requests/return-request.service.ts` (export `priceExchange`-style pricing as `priceSwap(db, { originalOrder, originalItem, requestedVariantId })` if the existing function needs a request row — extract, don't duplicate)
- Test: `apps/api/src/modules/return-requests/door-swap.integration.test.ts`

**Interfaces:**
- Consumes: Task 1 types.
- Produces: `createDoorSwap(orderId: string, input: CreateDoorSwapInput, adminId: string, idempotencyKey: string | null): Promise<{ request: ReturnRequest; exchangeOrder: Order; fee: number; total: number; protectedCod: number }>`; `swapCourierFacts(orderIds: string[]): Promise<Map<string, { protectedCod: number; note: string }>>` (only requests with `swap && swapStatus = AWAITING_SWAP`).

- [ ] Step 1: Failing tests (delivered order of variant A price 1390, Dhaka district, store fees 60/120):
  - `CUSTOMER_SIZE` to variant B (same price): exchange order total 60, shippingFee 60, discount 1390, `protectedCod` 1450; original order status still `DELIVERED`; variant A stock unchanged, variant B stock −1; request `swap=true`, `swapStatus=AWAITING_SWAP`.
  - `DEFECT` with evidence: total 0, protectedCod 1390.
  - new variant price 1590: total 60 + 200 = 260, protectedCod 1650.
  - delivered 4 days ago, `CUSTOMER_SIZE`, no override → 409 `EXCHANGE_WINDOW_PASSED`; with `overrideReason` → created, reason stored.
  - second swap on the same item while the first is AWAITING_SWAP → 409 `EXCHANGE_OPEN`.
  - same Idempotency-Key twice → same request id, one exchange order.
  - order status SHIPPED → 400; requested variant = original variant → 400; requested variant out of stock → 409.
  - `swapCourierFacts([exchangeOrder.id])` → protectedCod 1450 and note equal to the rule-8 text.
- [ ] Step 2: Run `INSTALL_ID= REVALIDATE_SECRET= npx vitest run src/modules/return-requests/door-swap.integration.test.ts` → FAIL.
- [ ] Step 3: Implement. Delivery time = latest `OrderStatusHistory` DELIVERED/PARTIALLY_DELIVERED `createdAt`. Fee for customer reasons = `quoteShippingFor(order)` (the server quote's zone fee for the order's district/zone key; read how `quoteOrderModification` resolves it and reuse). Stock exit for the new item through the same decrement + 409 guard `createExchangeOrder` uses. Replacement order `status CONFIRMED`, `paymentMethod COD`, `adminNotes` "Exchange for {orderNumber} ({label}) — door swap", statusHistory note same. Request row: `type EXCHANGE`, `status APPROVED`, `reason` = human label, `idempotencyKey`. No restock of the original.
- [ ] Step 4: Tests PASS; also rerun `return-request*.test.ts` (existing customer exchange unchanged). Commit.

### Task 3: Route

**Files:**
- Modify: `apps/api/src/modules/orders/order.routes.ts`, `order.controller.ts`
- Modify: `apps/api/src/domain/auth/admin-routes.snapshot.txt`
- Test: extend `door-swap.integration.test.ts`

**Interfaces:**
- Produces: `POST /api/orders/:id/exchanges` (requireAdmin, `orders.manage`, validate `createDoorSwapSchema`) → 201 `{ request, exchangeOrder, fee, total, protectedCod }`; `GET /api/orders/:id/exchanges` → `{ exchanges: Array<{ id, reason, swapStatus, fee, total, protectedCod, exchangeOrder: { id, orderNumber, status }, original: { name, size, color }, requested: { size, color }, createdAt }> }`.

- [ ] Step 1: Failing tests: staff without `orders.manage` → 403; POST then GET lists it.
- [ ] Step 2–4: implement, update route snapshot, PASS, commit.

### Task 4: Courier booking books the protected COD with the Bangla note

**Files:**
- Modify: `apps/api/src/modules/courier/courier.service.ts` (single booking ~l.397, bulk ~l.506, note building ~l.401/491)
- Test: `apps/api/src/modules/courier/courier-swap.integration.test.ts`

**Interfaces:**
- Consumes: `swapCourierFacts` (Task 2).
- Produces: `courierCodAmounts(orderIds): Promise<Map<string, number>>` = protectedCod for open swaps else `codToCollect`.

- [ ] Step 1: Failing test with the courier provider stubbed (pattern from existing courier booking tests): booking the exchange order sends `codAmount` 1450 and a note starting with `এক্সচেঞ্জ:`; bulk booking the same → 1450; a normal order unchanged; `courierCodBooked` stored 1450.
- [ ] Step 2–4: implement (note = swap note + existing note joined by " | "), PASS, commit.

### Task 5: Admin UI — "Exchange" on a delivered order

**Files:**
- Create: `apps/web/components/admin/orders/detail/exchange-dialog.tsx`
- Modify: `apps/web/components/admin/orders/detail/` Changes & returns section (the region holding "Change order"), `apps/web/lib/api/admin-order-adjustments.ts` (client fns `createDoorSwap`, `listOrderExchanges`)
- Test: `apps/web/e2e/admin-door-swap.spec.ts`

**Interfaces:**
- Consumes: Task 3 routes.

- [ ] Step 1: Failing e2e: deliver a seeded order via API, open it, click "Exchange" (`data-testid="start-exchange"`), choose item, pick size XL (`exchange-variant`), reason "Customer's size" (`exchange-reason-CUSTOMER_SIZE`), see summary text `Customer pays ৳60 when the old item is handed over · ৳1,450 if they keep both` (`exchange-summary`), click "Create exchange" (`create-exchange`) → link to the new order (`exchange-order-link`) and the list row shows "Waiting for swap". DEFECT without evidence keeps the button disabled with the hint "Say what proves the defect". Run desktop + mobile projects.
- [ ] Step 2: Implement the dialog with `ui-modal` primitives: item radio (lines of the order), variant picker of the same product (sizes/colours with stock; out-of-stock disabled), reason segmented control, evidence textarea (required for our-fault reasons), fee field (prefilled from the API's quote preview — add `fee` to a `POST /api/orders/:id/exchanges/preview` only if the dialog can't compute it; prefer returning it from a dry-run flag `?preview=1` on the same route), window warning with override reason field. Show existing exchanges with status chip.
- [ ] Step 3: `pnpm --filter web lint`, tsc, run the spec (prod build per local e2e recipe) → PASS; screenshots 1440 + 375. Commit.

### Task 6: Verify and ship

- [ ] Full API suite (`pnpm --filter api test`, no concurrent vitest), web vitest, `web lint`, e2e specs touched + `order-adjustments.spec.ts`, `admin-parcel-scanning.spec.ts`.
- [ ] Open PR "Door-swap exchange (phase A)"; CI green; merge. **Deploy only on the owner's "লাইভ করো"** (migration touches money/stock rules).
