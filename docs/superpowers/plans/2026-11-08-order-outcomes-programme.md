# Order Outcomes Programme — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut cancellations and refused parcels, and reduce manual work (confirmation calls), through six independent PRs.

**Architecture:** Every PR is one worktree off `origin/main`, one migration at most (additive), its own Vitest coverage and desktop + 375 px screenshots of any UI. Each one ships to all three stores (shared code). Owner-facing switches default to OFF unless stated, so merging changes no behaviour until the owner turns a feature on.

**Tech Stack:** pnpm + turbo; `apps/api` Express + Prisma + Postgres + Vitest; `apps/web` Next.js 15 / React 19 / Tailwind 3; `packages/shared` zod schemas + pure helpers.

**Spec:** the owner's request of 2026-11-08 ("tumi ja ja boleso shob gula implement kroo") applied to the six proposals in the session reply: (1) SMS self-confirm link, (2) cancellation report, (3) risky-buyer advance, (4) review-request SMS, (5) size run-out alert, (6) partial-delivery wizard.

## Global Constraints

- Never change a live selling price or a stock figure by hand; no forced finance values (memory: no-price-changes, no-forced-fixes).
- Never send an order to Steadfast automatically (no-auto-courier-booking).
- Storefront UI copy English; SMS may stay Bangla (existing templates are Bangla) (site-language).
- No store names or hand-written BD phone regex in runtime code — use `normalizeBdPhone` / `PHONE_REGEX` (store-identity guard).
- Every new admin page needs a NAV_NODES route or a `deprecatedRoutes` entry (navigation architecture test).
- New public routes are listed in the auth route matrix; route counts updated in the matrix test.
- Migration folder names sort after `20261214100000` (e.g. `20261215100000_…`).
- No production deploy approval until the owner says "live".

## Order of work

| PR | Branch | Depends on | Owner input needed |
|---|---|---|---|
| 1 | `feat/sms-self-confirm` | — | none (switch OFF by default) |
| 2 | `feat/cancellation-report` | — | none |
| 3 | `feat/review-request-sms` | — | none (switch OFF) |
| 4 | `feat/size-runout-alert` | — | none |
| 5 | `feat/partial-settle-wizard` | — | none |
| 6 | `feat/risky-buyer-advance` | 2 (reuses refusal counts) | rule values; ships OFF with suggested defaults |

PRs 2–6 get their detailed task list in this file when each starts.

## Review Focus (PR 1)

- A link opened after staff already confirmed or cancelled the order: show the order's current state, change nothing, record nothing.
- A link opened twice, or by two people at once: the order confirms once (row lock + PENDING check), the second sees "already confirmed".
- A guessed or tampered link (wrong signature, unknown order number): 404 page, identical for both, no hint which part was wrong.
- A prepaid / non-COD order: no link in the SMS (nothing to confirm by phone).
- The switch off: PLACED SMS is byte-identical to today's.

---

## PR 1 — Customer confirms the order from the SMS link

**What it does:** When "Let customers confirm by SMS link" is on, the order-placed SMS of a PENDING cash-on-delivery order carries a short link `<SITE_URL>/c/<orderNumber>.<sig>`. Opening it shows the order (items, total, address) with one **Confirm order** button and a **Cancel order** button (cancel asks "Are you sure?"). Confirming records an `OrderConfirmationAttempt` with outcome `CONFIRMED`, `adminId = null`, note `Confirmed by the customer from the SMS link`, and moves the order PENDING → CONFIRMED through `applyOrderTransition` (so the usual CONFIRMED SMS and side effects run). Cancelling records outcome `DECLINED` and cancels via the same transition with note `Cancelled by the customer from the SMS link`. Staff call queues already only show PENDING orders, so a self-confirmed order leaves the call list on its own.

**Files:**
- Create: `apps/api/prisma/migrations/20261215100000_sms_self_confirm/migration.sql` — `ALTER TABLE "SmsNotificationSetting" ADD COLUMN "customerSelfConfirmEnabled" BOOLEAN NOT NULL DEFAULT false;`
- Modify: `apps/api/prisma/schema.prisma` (that column), `packages/shared/src/schemas/sms-settings.ts` (field), `packages/shared/src/sms-templates.ts` (`{confirmLink}` placeholder + default PLACED_WITH_LINK template)
- Create: `apps/api/src/modules/orders/self-confirm.ts` — signing + service
- Create: `apps/api/src/modules/orders/self-confirm.routes.ts` — public routes, mounted in `app.ts` under `/api/order-confirm`
- Modify: `apps/api/src/lib/order-sms.ts` — add the link for PLACED when enabled and eligible
- Create: `apps/web/app/(storefront)/c/[code]/page.tsx` + `apps/web/components/storefront/self-confirm-card.tsx`
- Modify: admin SMS settings page (toggle) — `apps/web/app/admin/(shell)/settings/sms/page.tsx` (or wherever `adminDailyBriefEnabled` is toggled; follow that)
- Test: `apps/api/src/modules/orders/self-confirm.integration.test.ts`, `packages/shared/src/sms-templates.test.ts` (extend)

**Interfaces:**
- Produces: `selfConfirmCode(orderNumber: string): string` → `"<orderNumber>.<first 10 chars of base64url HMAC-SHA256(orderNumber, secret)>"`, secret = `process.env.ORDER_LINK_SECRET || env.jwtAccessSecret` with a `self-confirm:` payload prefix.
- Produces: `parseSelfConfirmCode(code: string): string | null` → order number when the signature matches (`constantTimeEqual`), else null.
- Produces: `getSelfConfirmView(code): Promise<SelfConfirmView>`; `SelfConfirmView = { orderNumber, status, total, items: {name, variantLabel, quantity, imageUrl|null}[], shippingArea, canAct: boolean }` (`canAct` = status PENDING and COD).
- Produces: `confirmBySelf(code, action: "confirm" | "cancel"): Promise<SelfConfirmView>`.
- Routes: `GET /api/order-confirm/:code` → `{ order: SelfConfirmView }`; `POST /api/order-confirm/:code` body `{ action }` → same. Both 404 `NOT_FOUND` for a bad code. Rate-limited like other public order routes.

### Task 1: Signed code (pure)

- [ ] **Step 1: Write the failing tests** in `self-confirm.integration.test.ts` (unit block):
  - `selfConfirmCode("AZ1001")` matches `/^AZ1001\.[A-Za-z0-9_-]{10}$/` and is stable across calls.
  - `parseSelfConfirmCode(selfConfirmCode("AZ1001")) === "AZ1001"`.
  - flipping one signature char, `"AZ1001"`, `"AZ1001."`, `"AZ1002.<sig of AZ1001>"` → `null`.
- [ ] **Step 2:** Run `pnpm --filter api exec vitest run src/modules/orders/self-confirm` → FAIL (module missing).
- [ ] **Step 3:** Implement both functions in `self-confirm.ts` with `signPayload` / `constantTimeEqual` from `lib/token-hash.ts`.
- [ ] **Step 4:** Re-run → PASS. **Commit** `feat(orders): signed self-confirm code`.

### Task 2: Service + migration

- [ ] **Step 1: Failing integration tests** (fixtures: `createStockedProduct`, `createManualOrder` with `paymentMethod: "COD"`, `trackOrder`):
  - confirm: PENDING COD order → status CONFIRMED; one attempt `{ outcome: "CONFIRMED", adminId: null }`; a status-history note contains `Confirmed by the customer from the SMS link`.
  - second confirm on the same code → returns view with `status: "CONFIRMED"`, `canAct: false`, attempt count still 1.
  - cancel: → CANCELLED, attempt `DECLINED`, stock released (variant stock back to the pre-order value).
  - an order already CANCELLED by staff → `confirmBySelf(code,"confirm")` leaves it CANCELLED, no attempt.
  - bad code → rejects `{ statusCode: 404 }`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Add the migration + schema column. Implement `getSelfConfirmView` and `confirmBySelf` in `self-confirm.ts`: inside `prisma.$transaction`, lock the order row the way `confirmation.service.ts` `lockOrder` does (export it from there rather than copying), return the view unchanged unless `status === "PENDING"` and payment method COD; write the attempt; call `applyOrderTransition(tx, id, { status, note }, { adminId: null })`; clear `followUpAt`/claim/escalation like `recordConfirmationAttempt`; after commit `runTransitionSideEffects(outcome)`.
- [ ] **Step 4:** Run → PASS. **Commit** `feat(orders): customers confirm or cancel their own order from a link`.

### Task 3: Public routes

- [ ] **Step 1: Failing supertest cases:** GET good code → 200 with `order.orderNumber`; GET bad code → 404; POST `{action:"confirm"}` → 200 status CONFIRMED; POST `{action:"delete"}` → 400. No auth cookie, no CSRF header needed (public, same as `/api/orders/track`; check how that route is exempted and copy it).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement `self-confirm.routes.ts` (zod `{ action: z.enum(["confirm","cancel"]) }`), mount in `app.ts`, add both routes to the auth route matrix and bump its count. **Step 4:** PASS. **Commit.**

### Task 4: SMS carries the link

- [ ] **Step 1: Failing tests** (`order-sms` test or the integration file, with the test SMS provider capturing bodies):
  - switch OFF → PLACED body equals `renderOrderSms(DEFAULT_CUSTOMER_SMS_TEMPLATES.PLACED, …)` exactly.
  - switch ON, COD PENDING → body contains `/c/<orderNumber>.` and the SITE_URL host.
  - switch ON, non-COD (e.g. EPS/paid) → no `/c/`.
  - a custom PLACED template without `{confirmLink}` → link appended as ` নিশ্চিত করুন: <link>` (so owners' own templates still get it).
- [ ] **Step 2:** FAIL. **Step 3:** `renderOrderSms` gains optional `confirmLink`; `deliverCustomerOrderSms` builds it for PLACED when enabled + eligible (needs `paymentMethod` + `status` in `OrderSmsFacts` — extend `orderFacts`). Link base = the store's public site URL used by other customer links (find the existing helper, e.g. the one payment links use). **Step 4:** PASS. **Commit.**

### Task 5: Storefront page `/c/[code]`

- [ ] **Step 1:** Server component fetches `GET /api/order-confirm/:code` (no cache); `notFound()` on 404. `SelfConfirmCard` (client) shows order number, item rows (image 48 px, name, variant, qty), total, delivery area; buttons **Confirm order** (primary) and **Cancel order** (ghost, confirm dialog); after action shows the result state ("Thank you — your order is confirmed" / "Your order is cancelled"). When `canAct` is false show the current status only. Loading state on buttons, error toast + retry on failure. Theme tokens only.
- [ ] **Step 2:** Verify on the review stack (API on a private DB, web `next dev`), default + nasihamart + tahafi themes, desktop 1280 and 375 px; no horizontal overflow. Screenshots in the PR.
- [ ] **Step 3:** `pnpm --filter web lint` + `tsc --noEmit` clean. **Commit.**

### Task 6: Admin switch

- [ ] **Step 1:** Add the toggle "Let customers confirm by SMS link" with help text "Order-placed SMS for cash-on-delivery orders gets a link. Customers who confirm skip the call list." next to the existing customer SMS toggles; schema field in `sms-settings.ts`; settings service passes it through (test: PATCH sets it, GET returns it).
- [ ] **Step 2:** Screenshot desktop + 375. **Step 3:** Full checks: `pnpm --filter api test` (alone — no concurrent vitest), web lint/tsc, store-identity + navigation guards. **Commit**, push, PR.
