# Site Health Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the owner eyes on the live stores (errors + real phone speed), close the TikTok server-side tracking gap, and clean up abandoned worktrees/PRs so no work gets lost.

**Architecture:** Errors keep flowing through the existing provider-neutral `captureError` (apps/api/src/lib/observability/error-capture.ts); a new DB-backed reporter registered in `server.ts` groups them by fingerprint into `ErrorGroup`. The storefront beacons its own crashes and Core Web Vitals to two new public, rate-limited endpoints (same trust model as `/api/analytics/pageview`). Both surface in Admin › System health. TikTok Events API copies the Meta CAPI design exactly: a provider in `providers/events/`, an outbox consumer written in the order transaction, the same `purchase_<orderNumber>` event id the browser pixel already uses.

**Tech Stack:** Express + Prisma + Postgres + Vitest (api), Next.js 15 / React 19 + TanStack Query (web), `next/web-vitals`, Playwright.

**Spec:** chat on 2026-10-16 ("Amar website er kon sector ta aro improve kora proyojon?" → findings 1, 2, 3, 5; finding 4 (order SMS) is already covered by the PLACED/CONFIRMED/SHIPPED/DELIVERED/CANCELLED touchpoints in `apps/api/src/domain/outbox/consumers.ts:29`, so it is out of scope).

## Global Constraints

- Work in a new worktree `C:/dev/asifzone-health` on branch `feat/site-health` from `origin/main`; API :4900, web :3900, test DB = a private copy (see memory "Local e2e setup", "PG connection limit"). Never run two vitest runs at once.
- No vendor SDK (no Sentry, no web-vitals npm package beyond what `next/web-vitals` ships). No new external accounts needed except the owner's TikTok Events API token.
- Public endpoints: zod-validated, `trackingRateLimit`, always reply `204` (never echo input, never 4xx-leak why a beacon was dropped other than validation).
- Never store PII: messages/stacks go through `maskText` (apps/api/src/lib/observability/logger.ts); vitals carry no ids, no IPs, no user agent.
- Admin UI: Apple-style, light only, existing primitives (`components/ui/table`, `ErrorState`, `PageHeader`), phone card-list pattern from the admin native pass, works at 375px; loading/empty/error states.
- Storefront changes must not alter rendering in either theme (`default` stays pixel-identical); the reporters render nothing.
- Each installation (Asif Zone, Nasihamart) has its own DB — no install id columns needed.
- Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Error storm** (a crashed DB or a hot loop raising thousands of errors/sec) → reporter buffers in memory, one upsert per fingerprint per flush, never recurses into `captureError`, never blocks a request. Test in Task 2.
2. **Database down while reporting** → the reporter's flush fails silently and drops the buffer; the original request still gets its 500. Test in Task 2.
3. **Browser-extension / third-party noise** (`ResizeObserver loop`, `Script error.`, stacks with no `/_next/` frame) → dropped on the client, so the admin list is not flooded. Test in Task 3.
4. **Junk/hostile beacons** (huge strings, negative or absurd vitals values, 1000 samples in one body) → rejected by zod; nothing stored. Tests in Tasks 3 and 5.
5. **TikTok not configured / token wrong** → no outbox intent when disabled; a 4xx from TikTok is unrecoverable (not retried forever), 5xx/429 retried. Tests in Task 8.

---

## Phase A — Housekeeping

### Task 1: Worktree and PR triage (report only, no deletions)

**Files:**
- Create: `C:/Users/tanvi/AppData/Local/Temp/claude/c--Users-tanvi-OneDrive-Documents-All-Website-Asif-Zone/4c23af1e-1a9d-437d-9d24-f12ca47421f6/scratchpad/worktree-triage.md` (report)

- [ ] **Step 1:** For each worktree with uncommitted changes (`asifzone-consolidation` 107, `asifzone-storefront` 190, `asifzone-nm-theme` 35, `asifzone-mobile` 27, `asifzone-orders-polish` 22, `asifzone-variant-delivery` 15, `asifzone-phase1` 13, `asifzone-isolation` 10, `asifzone-main-sync` 5), run `git -C <wt> status --porcelain` and, per changed file, `git -C <wt> diff origin/main -- <file> | wc -l` to see whether the content already exists on main.
- [ ] **Step 2:** Classify each worktree: **Already on main** (diff vs origin/main empty for all tracked changes) / **Unique work** (list files + one-line summary) / **Junk** (only `.next`, logs, screenshots).
- [ ] **Step 3:** Open PRs: #3–#17 and #23 → `git merge-base --is-ancestor origin/<branch> origin/main`; for the 3 not on main (#23 `integration/sync-github-and-local`, #3 `test/admin-product-type-e2e`, #2 `security/remove-hardcoded-ssh-password`), diff their one commit against main and say whether it is still needed (#2: the file it fixes, `deploy_vps.py`, was removed 2026-10-09).
- [ ] **Step 4:** Hand the report to the owner. Removing worktrees, deleting branches and closing PRs happens only after they approve each line. Unique work from another session is not committed by us (memory: committing other sessions' work is blocked) — list it for the owner.

---

## Phase B — Error monitoring

### Task 2: ErrorGroup table + DB-backed reporter

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (new model), new migration `apps/api/prisma/migrations/<ts>_error_groups/`
- Create: `apps/api/src/lib/observability/error-fingerprint.ts`
- Create: `apps/api/src/lib/observability/error-store-reporter.ts`
- Modify: `apps/api/src/server.ts` (register reporter on boot, `flush()` on shutdown)
- Test: `apps/api/src/lib/observability/error-fingerprint.test.ts`, `apps/api/src/lib/observability/error-store-reporter.integration.test.ts`

**Interfaces:**
- Consumes: `CapturedError`, `ErrorReporter`, `registerErrorReporter` from `error-capture.ts`.
- Produces:
  - `type ErrorSource = "api" | "web"`
  - `fingerprintError(captured: CapturedError): string` — sha1 hex of `source | errorName | normalizedMessage | firstFrame`; `normalizedMessage` replaces digits runs with `#` and quoted strings with `"…"`; `firstFrame` = first stack line containing `/src/` or `/_next/`, stripped of line:col and query. `source` read from `captured.context?.source ?? "api"`.
  - `createErrorStoreReporter(opts?: { flushIntervalMs?: number; maxGroups?: number }): { report: ErrorReporter; flush(): Promise<void>; stop(): void }` — defaults 5000 ms, 200 groups.

```prisma
model ErrorGroup {
  id                String    @id @default(cuid())
  fingerprint       String    @unique
  source            String    // "api" | "web"
  errorClass        String
  title             String    // "<ErrorName>: <masked message>" truncated to 200
  sampleStack       String?   // masked, first 8 lines
  lastPath          String?   // route or storefront path
  lastCorrelationId String?
  count             Int       @default(0)
  firstSeenAt       DateTime  @default(now())
  lastSeenAt        DateTime
  resolvedAt        DateTime?

  @@index([resolvedAt, lastSeenAt])
}
```

- [ ] **Step 1: Failing unit tests** (`error-fingerprint.test.ts`): same error with different order numbers in the message → same fingerprint (`"Order AZ-1042 not found"` vs `"Order AZ-2210 not found"`); different first frame → different fingerprint; `context.source: "web"` vs default → different fingerprint.
- [ ] **Step 2:** `pnpm --filter api test -- error-fingerprint` → FAIL (module missing).
- [ ] **Step 3:** Implement `fingerprintError`.
- [ ] **Step 4: Failing integration tests** (`error-store-reporter.integration.test.ts`):
  - `report` ×1000 of one error then `flush()` → exactly one `ErrorGroup` row, `count === 1000`.
  - A group with `resolvedAt` set receives a new occurrence → `resolvedAt` becomes `null`, `count` increments.
  - 300 distinct fingerprints with `maxGroups: 200` → 200 rows, no throw.
  - `flush()` while prisma `$transaction` is mocked to reject → resolves without throwing, buffer emptied, `captureError` not called (spy).
  - `report` returns synchronously (does not await I/O).
- [ ] **Step 5:** Run → FAIL.
- [ ] **Step 6:** Implement: in-memory `Map<fingerprint, {count, latest CapturedError}>`; `flush` does one `prisma.errorGroup.upsert` per entry (`count: { increment }`, `lastSeenAt: now`, `resolvedAt: null`, latest title/stack/path/correlationId, all text through `maskText`); timer `.unref()`. Add migration with `pnpm --filter api prisma migrate dev --name error_groups` against the private test DB only (memory: never use dev/test DB as shadow).
- [ ] **Step 7:** Register in `server.ts` next to the other boot steps (skip when `NODE_ENV === "test"`); call `flush()` in the existing shutdown handler.
- [ ] **Step 8:** Run both test files → PASS. Commit `feat(ops): group production errors in ErrorGroup`.

### Task 3: Storefront crash beacons

**Files:**
- Create: `apps/api/src/modules/ops/client-errors.routes.ts` (+ mount at `/api/v1/client-errors` where `/api/v1/ops` is mounted)
- Create: `apps/web/lib/report-client-error.ts`
- Create: `apps/web/components/system/client-error-listener.tsx` (mount in `apps/web/app/providers.tsx`)
- Modify: `apps/web/app/global-error.tsx` (call `reportClientError(error, "boundary")` in a `useEffect`)
- Test: `apps/api/src/modules/ops/client-errors.integration.test.ts`, `apps/web/lib/report-client-error.test.ts`

**Interfaces:**
- Consumes: `captureError` (api).
- Produces:
  - `POST /api/v1/client-errors` body `{ message: string(1..500), stack?: string(..4000), digest?: string(..64), path: string(1..300, starts with "/"), kind: "boundary" | "unhandled" }` → `204`. Calls `captureError(err, { source: "web", path, digest, kind })` where `err` is an `Error` with `name = "ClientError"`, `message`, `stack` from the body.
  - `shouldReportClientError(message: string, stack: string | undefined): boolean` and `reportClientError(error: unknown, kind: "boundary" | "unhandled"): void` (sendBeacon via the same helper `lib/analytics.ts` uses; at most 5 reports per page load; same message+kind only once).

- [ ] **Step 1: Failing API tests:** valid body → 204 and one `ErrorGroup` with `source "web"` after `flush()`; `message` of 501 chars → 400; `path: "https://evil"` → 400; 25 requests from one IP in a minute → later ones 429 (existing `trackingRateLimit`).
- [ ] **Step 2: Failing web tests:** `shouldReportClientError("ResizeObserver loop limit exceeded", …) === false`; `("Script error.", undefined) === false`; stack with only `chrome-extension://` frames → false; stack with an `/_next/static/chunks/` frame → true; 6th distinct `reportClientError` call → no beacon (spy on `navigator.sendBeacon`).
- [ ] **Step 3:** Run both → FAIL. Implement. Listener component: `window` `error` + `unhandledrejection`, returns `null`; mounted for storefront and admin alike — `path` tells them apart.
- [ ] **Step 4:** Run → PASS. Commit `feat(ops): storefront and admin crash reports`.

### Task 4: Errors in Admin › System health + dashboard signal

**Files:**
- Modify: `apps/api/src/modules/ops/ops.routes.ts` / controller / service (follow the `/reliability` handler)
- Modify: the `/api/v1/ops/attention` service (add `openErrors`)
- Modify: `apps/web/lib/api/ops.ts`, `apps/web/app/admin/(shell)/system-health/page.tsx` (new `ErrorsSection`, anchor `#errors`), dashboard attention list component (where existing attention signals render)
- Test: `apps/api/src/modules/ops/errors.integration.test.ts`, `apps/web/e2e/system-health-errors.spec.ts`

**Interfaces:**
- Produces:
  - `GET /api/v1/ops/errors?status=open|resolved&limit=50` (`ops.read`) → `{ items: Array<{ id, source, title, lastPath, count, firstSeenAt, lastSeenAt, resolvedAt }> }`, open = `resolvedAt null`, ordered `lastSeenAt desc`. Never returns `sampleStack` in the list.
  - `GET /api/v1/ops/errors/:id` (`ops.read`) → item + `sampleStack` + `lastCorrelationId`.
  - `POST /api/v1/ops/errors/:id/resolve` (`ops.repair`) → 204; audited via `lib/audit.ts`.
  - attention payload gains `openErrors: number` = open groups with `lastSeenAt` in the last 24 h.
  - `opsApi.listErrors(status)`, `opsApi.getError(id)`, `opsApi.resolveError(id)`.

- [ ] **Step 1: Failing API tests:** list filters open/resolved; resolve sets `resolvedAt` and writes an audit row; staff without `ops.repair` → 403; attention `openErrors` counts only last-24 h open groups.
- [ ] **Step 2:** Run → FAIL; implement; run → PASS.
- [ ] **Step 3: UI:** section "Errors" — rows: title, where ("Website · /products/…" or "Server · <path>"), "×{count}", "last seen {timeAgo}", button "Mark fixed"; row opens a sheet with the stack and correlation id (for support). Empty: "No errors in the last 7 days." Error: `ErrorState` with retry. Phone: card list. Dashboard attention: "{n} new errors" → `/admin/system-health#errors`.
- [ ] **Step 4: e2e:** seed one `ErrorGroup`, open System health, see the row, click Mark fixed, row disappears; at 375px no horizontal scroll.
- [ ] **Step 5:** `pnpm --filter web lint`, the e2e spec, screenshots desktop + 375px; `impeccable` + `web-design-guidelines` on changed files. Commit `feat(admin): errors in System health`.

---

## Phase C — Real phone speed

### Task 5: Web-vitals storage, ingestion, report, retention

**Files:**
- Create: `packages/shared/src/web-vitals.ts` (+ export from the package index)
- Modify: `apps/api/prisma/schema.prisma` + migration `<ts>_web_vitals`
- Create: `apps/api/src/modules/ops/web-vitals.routes.ts` (public POST at `/api/v1/vitals`; admin GET under `/api/v1/ops/vitals`), `web-vitals.service.ts`
- Create: `apps/api/src/jobs/web-vitals-retention-cron.ts` (pattern: `storage-trash-cron.ts`; start in `server.ts`)
- Test: `apps/api/src/modules/ops/web-vitals.integration.test.ts`

**Interfaces:**
- Produces (shared):
  - `type WebVitalMetric = "LCP" | "INP" | "CLS" | "FCP" | "TTFB"`
  - `type PageKind = "home" | "category" | "product" | "search" | "cart" | "checkout" | "landing" | "account" | "other"`
  - `type DeviceKind = "mobile" | "desktop"`
  - `WEB_VITAL_THRESHOLDS: Record<WebVitalMetric, { good: number; poor: number }>` = LCP 2500/4000, INP 200/500, CLS 0.1/0.25, FCP 1800/3000, TTFB 800/1800
  - `rateVital(metric, value): "good" | "needs-improvement" | "poor"` (≤good → good, >poor → poor)
- Prisma:

```prisma
model WebVitalSample {
  id        String   @id @default(cuid())
  metric    String
  value     Float
  pageKind  String
  device    String
  createdAt DateTime @default(now())

  @@index([createdAt, metric])
}
```

- `POST /api/v1/vitals` body `{ samples: Array<{ metric, value, pageKind, device }> (1..10) }`; value bounds: CLS 0..10, others 0..60000 → `204`. Skips bot user agents with the same check `analytics.controller.trackPageView` uses.
- `GET /api/v1/ops/vitals?days=7` (`ops.read`, days 1..30) → `{ rows: Array<{ metric, pageKind, device, p75: number, samples: number, rating }> }` using `percentile_cont(0.75)` grouped by metric/pageKind/device; rows with `< 20` samples still returned (UI marks them "few visits").
- Cron deletes samples older than 30 days, daily.

- [ ] **Step 1: Failing tests:** `rateVital("LCP", 2500) === "good"`, `("LCP", 4001) === "poor"`, `("CLS", 0.15) === "needs-improvement"`; POST with 11 samples → 400; `value: -1` → 400; `CLS 50` → 400; bot UA → 204 and nothing stored; seeded 4 LCP values 1000/2000/3000/4000 for product/mobile → GET returns p75 3250 and rating "needs-improvement"; retention removes a 31-day-old row and keeps a 29-day-old one.
- [ ] **Step 2:** Run → FAIL; implement; run → PASS. Commit `feat(ops): store and report Core Web Vitals`.

### Task 6: Storefront vitals reporter + "Site speed" in System health

**Files:**
- Create: `apps/web/lib/page-kind.ts`, `apps/web/components/analytics/web-vitals-reporter.tsx`
- Modify: storefront root layouts `apps/web/app/(storefront)/layout.tsx`, `(storefront-detail)/layout.tsx`, `(landing)/layout.tsx` (mount reporter; not admin)
- Modify: `apps/web/lib/api/ops.ts`, `apps/web/app/admin/(shell)/system-health/page.tsx` (`SiteSpeedSection`)
- Test: `apps/web/lib/page-kind.test.ts`, `apps/web/e2e/system-health-speed.spec.ts`

**Interfaces:**
- Consumes: shared `PageKind`, `WEB_VITAL_THRESHOLDS`, `rateVital`; `GET /api/v1/ops/vitals`.
- Produces: `pageKindFromPath(pathname: string): PageKind`; `opsApi.getVitals(days)`.

- [ ] **Step 1: Failing tests:** `pageKindFromPath("/") === "home"`, `"/products/black-panjabi" → "product"`, `"/category/panjabi" → "category"` (match the real storefront route segments — read `app/(storefront)` and `(storefront-detail)` folders first), `"/lp/eid" → "landing"`, `"/checkout" → "checkout"`, `"/account/orders" → "account"`, `"/about" → "other"`.
- [ ] **Step 2:** Run → FAIL; implement; PASS.
- [ ] **Step 3:** Reporter: `useReportWebVitals` from `next/web-vitals`, keep only the five metrics, device = `matchMedia("(max-width: 767px)")`, queue and flush with `sendBeacon` on `visibilitychange → hidden` and when the queue reaches 10. Renders `null`.
- [ ] **Step 4:** "Site speed" section: Phone / Computer segmented control (default Phone); rows per page kind; columns "Loads main content" (LCP), "Responds to taps" (INP), "Layout jumps" (CLS); value formatted (`2.4 s`, `180 ms`, `0.05`) + Good / Needs work / Slow chip from existing badge tokens; "few visits" hint below 20 samples. Empty: "Collecting speed data — numbers appear after a few dozen visits."
- [ ] **Step 5: e2e:** seed samples, see the product row with its chip; storefront visit + `page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")))` sends a beacon to `/api/v1/vitals` (wait for request). Screenshots both themes' home unchanged; admin desktop + 375px.
- [ ] **Step 6:** Lint, `impeccable` + `web-design-guidelines`. Commit `feat(admin): real-visitor site speed`.

### Task 7: Lab speed baseline and quick fixes (both themes)

**Files:** decided by findings; record results in `docs/PERFORMANCE_BASELINE.md`.

- [ ] **Step 1:** Production build on :3900 (memory: Windows build EPERM — stop the dev server first), Lighthouse mobile (Moto G Power, slow 4G) on home, a category, a PDP, cart, checkout, one `/lp/<slug>`, for `STORE_THEME=default` and `nasihamart`. Record LCP / TBT / CLS / JS kB per page.
- [ ] **Step 2:** Fix only findings that are (a) LCP element not prioritised / wrong image size, (b) layout shift > 0.1 from un-sized media/fonts, (c) a client bundle > 50 kB that can move to a server component or `dynamic()`. Anything else goes in the doc as "later".
- [ ] **Step 3:** Re-run Lighthouse, record before/after. Screenshots confirm `default` pixel-identical. Commit `perf(storefront): <what>`.

---

## Phase D — TikTok Events API

### Task 8: TikTok Events API provider + settings

**Files:**
- Modify: `packages/shared/src/integrations.ts` (TikTok group: add `TIKTOK_ACCESS_TOKEN` secret "Events API access token", optional; `TIKTOK_TEST_EVENT_CODE` text, optional)
- Modify: `apps/api/src/config/env.ts` (`tiktok: { pixelId, accessToken, testEventCode }` getters via `integrationSetting`)
- Modify: `apps/api/src/providers/errors.ts` (`TikTokApiError(message, retryable)`, same shape as `MetaApiError`)
- Create: `apps/api/src/providers/events/tiktok-events.ts`
- Modify: `apps/api/src/providers/registry.ts` (`tiktokServerEvents` sink + capability row like the Meta one at :251)
- Test: `apps/api/src/providers/events/tiktok-events.test.ts`

**Interfaces:**
- Produces:
  - `isTikTokEventsEnabled(): boolean` — pixelId && accessToken && `liveProvidersEnabled()` && (production || testEventCode).
  - `interface TikTokServerEvent { event: "Purchase"; event_time: number; event_id: string; user: { email?: string; phone?: string; external_id?: string; ip?: string; user_agent?: string; ttp?: string; ttclid?: string }; page: { url: string }; properties: { currency: string; value: number; order_id: string; content_type: "product"; contents: Array<{ content_id: string; quantity: number; price: number }> } }`
  - `sendTikTokEvent(event: TikTokServerEvent): Promise<void>` — POST `https://business-api.tiktok.com/open_api/v1.3/event/track/`, header `Access-Token`, body `{ event_source: "web", event_source_id: pixelId, data: [event], test_event_code? }`, 8 s timeout. TikTok answers HTTP 200 with `code != 0` on errors: `code 0` → ok; HTTP 5xx/429 or `code` 40100 (rate limit) → retryable; any other non-zero code → not retryable. Error text = `code`/`message`/`request_id` only.
  - `getProviders().tiktokServerEvents: ServerEventSink`.

- [ ] **Step 1: Failing tests** (mock `fetch`): disabled when token missing; disabled in non-production without test code; body has `event_source_id` = pixel id and token only in the header; `{code:0}` resolves; `{code:40001}` → `TikTokApiError` `retryable false`; HTTP 503 → retryable true; fetch abort → retryable true; error message contains no email/phone.
- [ ] **Step 2:** Run → FAIL; implement; PASS. Settings › Integrations shows the two new fields (check `integrations.integration.test.ts` still passes). Commit `feat(pixels): TikTok Events API provider`.

### Task 9: Server-side TikTok Purchase via the outbox

**Files:**
- Create: `apps/api/src/lib/tiktok/purchase.ts`
- Modify: `apps/api/src/lib/meta/capi.ts` (`metaContextFromRequest` also captures `ttp` from cookie `_ttp` and `ttclid` from cookie `ttclid` — rename nothing, add the two optional fields to `MetaRequestContext`)
- Modify: `apps/web/lib/pixels/tiktok.ts` (store `ttclid` from the landing URL in a first-party cookie `ttclid`, 7 days, SameSite=Lax — only when TikTok pixel is configured and consent passes)
- Modify: `apps/api/src/domain/outbox/consumers.ts` (`"tiktok-events-purchase"` consumer)
- Modify: `apps/api/src/modules/orders/order.service.ts:460` (push intent when `getProviders().tiktokServerEvents.enabled()`)
- Test: `apps/api/src/lib/tiktok/purchase.integration.test.ts`, extend `apps/web/e2e/ad-pixels.spec.ts`

**Interfaces:**
- Consumes: `sendTikTokEvent`, `TikTokServerEvent`, `metaPurchaseEventId`, `sha256` from `lib/meta/capi.ts`, `getCurrency`.
- Produces: `buildTikTokPurchaseEvent(orderId: string, context: MetaRequestContext): Promise<TikTokServerEvent | null>`; `processTikTokPurchase({ orderId, context }): Promise<void>`.

- [ ] **Step 1: Failing tests:** event_id equals `purchase_<orderNumber>` (same as the browser pixel); email hashed from trimmed lowercase, phone hashed as E.164 `+8801…` from a local `01…` number; contents use variant ids with `price` = `priceSnapshot`; deleted order → `null` and no send; placing an order with TikTok enabled writes a `tiktok-events-purchase` outbox row, with TikTok disabled writes none; Meta row unaffected either way.
- [ ] **Step 2:** Run → FAIL; implement (non-retryable `TikTokApiError` → `UnrecoverableError`, same as `processMetaPurchase`); PASS.
- [ ] **Step 3:** e2e: `?ttclid=abc` landing sets the cookie when the TikTok pixel id is configured, not otherwise.
- [ ] **Step 4:** Commit `feat(pixels): server-side TikTok Purchase`.

---

## Phase E — Finish

### Task 10: Docs, full verification, review, PR

**Files:** `docs/MASTER_SYSTEM_INVENTORY.md` (§25: mark INC-01 abandoned cart, INC-02 zones (`settings/delivery-zones`), INC-05 consent banner, INC-06 manifest/offline as done after verifying each in code; INC-07 and INC-12 done by this branch; §26 add System health errors/speed), `docs/AD_PIXELS.md` (TikTok Events API setup: where to get the token in TikTok Ads Manager › Events › Web › Settings › Generate access token).

- [ ] **Step 1:** Update docs.
- [ ] **Step 2:** `pnpm --filter api test` (alone; stop spare APIs first), `pnpm --filter web test`, `pnpm --filter web lint`, the three new/changed e2e specs + `ad-pixels.spec.ts`. All output captured.
- [ ] **Step 3:** `/code-review` on the branch, then `/security-review` (two new public endpoints). Fix findings.
- [ ] **Step 4:** Push branch, open PR to `main`. Owner merges (memory: merge is theirs). After merge: AZ auto-deploys; NM via `deploy.sh` command handed to the owner; owner pastes the TikTok access token in Settings › Integrations on each store.
