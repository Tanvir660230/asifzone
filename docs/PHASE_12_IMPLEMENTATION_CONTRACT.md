# Phase 12 Implementation Contract — Store Identity & Provider Configuration

**Status:** AUDIT / CONTRACT ONLY. Nothing in this document has been implemented. No code, migration, API, provider,
frontend or deployment change was made while preparing it.
**Audited code:** `2ad99c7` (production release: `claude/charming-gauss-e26lar` + Phase 11), branch
`phase-12/store-identity-provider-config`.
**Phase 11 live gate:** authenticated OWNER/STAFF/customer smoke verification is still open (owner decision to start
Phase 12 in parallel). Nothing here depends on it.

Markers used: **ALREADY CORRECT** (keep as is), **DECISION REQUIRED** (owner must choose before the work package
starts), **DEFERRED** (belongs to a later phase).

---

## 1. Phase objective

Make the current codebase deployable as **Store A, Store B, Store C** — each a separate single-store deployment
(one deployment, one Postgres, one Redis, one configuration) — from the **same Git commit**, where everything that
differs between stores is **configuration, secrets or store data**, never a source edit or fork.

Concretely, at the end of Phase 12:

1. No runtime code path needs the string "Asif Zone", the domain `asifzone.com`, or any other store identity.
2. Store identity has exactly one owner (the Phase 7 identity owner), with the few missing fields added there.
3. Application/domain code calls providers through **capability interfaces**; which concrete provider (or none) is
   active is decided by configuration at one composition point.
4. Provider credentials stay out of source, the database, the browser and the logs (verified by guards).
5. Bangladesh-specific rules live in **one country module**, not scattered (behaviour unchanged).
6. Deployment differs per store only by an env file + domain/certificate inputs, documented as a checklist.

## 2. Non-goals

- Multi-tenant SaaS, more than one store per database, `storeId` columns — **DEFERRED** (not planned).
- Multi-country / country packs / localization / per-order currency / multi-currency accounting — **DEFERRED**.
  Bangladesh rules are *isolated*, not generalized.
- Dedicated worker split, Redis-backed rate limiting, object storage, Kafka/event sourcing, daily facts, custom roles,
  courier unknown-outcome recovery redesign — **DEFERRED**.
- No change to pricing, quote, payment ledger, refunds, inventory, metrics, authorization (Phase 10), outbox (Phase 8)
  or historical snapshot semantics. No new writer for an existing business fact.
- No UI redesign / theming system. Presentation is only re-pointed at its configuration owner.
- Same-VPS hosting of two stores (shared edge proxy) — **DECISION REQUIRED (D-12)**, default DEFERRED.

## 3. Existing architecture (as audited)

- **Monorepo:** pnpm + Turbo. `apps/api` (Express 4 + Prisma 5, 85 models), `apps/web` (Next.js 15 App Router:
  storefront + account + admin in one app), `packages/shared` (engines, schemas, formatters, permissions),
  `packages/ui-tokens`, `packages/config`.
- **SSOT chain (unchanged by this phase):** DB truth → domain service → pure engine (`packages/shared/src/engines`) →
  read model (`ProductReadModel`) → API → admin / storefront / reports.
- **Configuration owners (Phase 7, `docs/PHASE_7_SIGNOFF.md` §1) — ALREADY CORRECT:**

  | Concept | Owner | Reader |
  |---|---|---|
  | Currency, timezone | `StoreSetting.currency/timezone` | `apps/api/src/domain/config/commerce-settings.ts` |
  | Identity (name, tagline, logos, favicon, contact email/phone) | `StoreSetting` | `settings.service.getSettings()` |
  | Tax | `TaxSetting` | `domain/pricing/pricing-config.ts` `loadTaxConfig` |
  | Shipping | `ShippingZone` / `ShippingRate` (+ `StoreSetting.shippingFee*` compatibility mirror) | `loadShippingZones` |
  | Social links | `SocialLink` table | `modules/social-links` |
  | Payment-method badges | `PaymentMethodOption` table | `modules/payment-methods` |
  | Display locale | `DISPLAY_LOCALE` constant (`packages/shared/src/format.ts`) | formatters |
  | SKU pattern / prefix | `CatalogSetting` | `modules/catalog/sku.service.ts` |
  | SMS notification toggles/templates | `SmsNotificationSetting` | `modules/sms-settings` |

- **Single-store singletons** (`id = "singleton"`): `StoreSetting`, `TaxSetting`, `CatalogSetting`,
  `SmsNotificationSetting`. **ALREADY CORRECT** for one-store-per-database; nothing in Phase 12 changes this.
- **Provider configuration today:** credentials and endpoints from env (`apps/api/src/config/env.ts`, 35 variables);
  store-level *enablement* toggles in `StoreSetting` (`codEnabled`, `onlinePaymentEnabled`, `epsPaymentEnabled`,
  `liveChatEnabled`, Tawk ids); `LIVE_PROVIDERS=off` + network guard (`apps/api/src/lib/provider-guard.ts`) block all
  outbound provider traffic in tests/e2e.
- **Deployment:** one compose project (`docker/docker-compose.yml`: postgres, redis, api, web, nginx, certbot),
  `docker/deploy.sh` (Phase 11 backup → verify → build → migrate → switch → readiness → proxy), nginx config
  hard-wired to `asifzone.com`.

## 4. Store identity audit

Search: `asif[ _-]?zone|asifzone` (case-insensitive) over all tracked files (lockfile excluded), plus monogram `AZ`,
contact/address strings, static brand assets.

| # | Location | Occurrence | Class | Owner / action |
|---|---|---|---|---|
| I-1 | `apps/web/components/admin/product-form.tsx:250`, `apps/web/components/admin/product-wizard/steps.tsx:88` | placeholder `"e.g. Asif Zone Originals"` | C Presentation | Neutral placeholder (or `{storeName} Originals` from settings). |
| I-2 | `apps/web/components/storefront/header.tsx:17` | code comment example `"Asif Zone" -> "AZ"` | F Documentation (comment) | Neutral example. Behaviour already derives the monogram from `settings.storeName` — **ALREADY CORRECT**. |
| I-3 | `packages/shared/src/sku.ts:5,53,68` | `AZ` in help text / comments | C/F | Neutral example. Actual prefix is `CatalogSetting.skuPrefix` — **ALREADY CORRECT**. |
| I-4 | `apps/api/prisma/schema.prisma` `CatalogSetting.skuPrefix @default("AZ")` | schema default | A Store configuration (default) | **DECISION REQUIRED (D-8)**: neutral default (e.g. `"SKU"`) for *new* databases. Additive default change only; existing rows untouched. |
| I-5 | `apps/web/app/icon.png`, `apple-icon.png`, `favicon.ico` | committed brand artwork used when `StoreSetting.faviconUrl` is unset (`apps/web/app/layout.tsx:47-57`) | C Presentation | **DECISION REQUIRED (D-9)**: replace with neutral fallback artwork; real icon comes from `faviconUrl`. |
| I-6 | `apps/web/components/storefront/footer.tsx:148` | `"Dhaka, Bangladesh"` shown as the store's location | A Store configuration | New identity field (address) on the identity owner — §5. |
| I-7 | `apps/web/components/storefront/footer.tsx:16-17` | hard-coded bKash / Nagad badges | A Store configuration | Re-point at existing `PaymentMethodOption` (already the owner) — **DECISION REQUIRED (D-7)** on fallback when empty. |
| I-8 | `apps/web/app/(storefront)/terms/page.tsx:127` | "governed by the laws of Bangladesh" | A Store configuration (legal) | Jurisdiction from identity owner (§5). Remaining policy prose: §11. |
| I-9 | `apps/web/app/(storefront)/{faq,shipping-returns,contact}/page.tsx`, `packages/shared/src/sections.ts:56` | Dhaka delivery-time copy | B/C (country rule rendered as copy) | Copy derives from the country module's delivery estimate (§10); prose policy content **DEFERRED** (CMS). |
| I-10 | `apps/web/e2e/admin-product-preview.spec.ts:10`, `admin-product-workflow.spec.ts:11`, `product-system-acceptance.spec.ts:252,418` | `"… | Asif Zone"` SEO title strings | E Test fixture | Read the store name from the seeded settings instead of a literal (keeps tests valid for any seed). |
| I-11 | `apps/api/src/modules/storage/storage.service.test.ts:49,50,84` | `https://asifzone.com/uploads/...` | E Test fixture | Neutral `https://store.example/...`. |
| I-12 | `docker/nginx/nginx.conf:65-96` | `server_name`, redirect host, cert paths | D Infrastructure | Template from deploy inputs (§13). |
| I-13 | `docker/docker-compose.yml:152` | certbot renewal comment | F | Neutral wording. |
| I-14 | `docker/gdrive-backup.sh:6,21`, `docker/gdrive-restore.sh:16` | default remote `gdrive:asifzone-backups` | D Infrastructure | Already overridable by `GDRIVE_REMOTE`; make it required (no store default). |
| I-15 | `docker/migrate-to-new-vps.sh` (21), `docker/zero-downtime-migrate.sh` (21), `.github/workflows/migrate-vps.yml` (3) | one-off Asif Zone VPS migration tooling | D Infrastructure / G Historical | **DECISION REQUIRED (D-14)**: retire (move to `docs/history/` or delete) — not part of the reusable deployment path. |
| I-16 | `deploy_vps.py`, `inspect_vps.py` | legacy shared-hosting paths and repo URL | D / G | Same as I-15 (target is the retired Hostinger account). |
| I-17 | `.gitignore:17` | `/AsifZone Eps/` | D (local tooling) | Harmless; keep or genericize. |
| I-18 | `docs/CLOUDFLARE_SETUP.md`, `docs/TARGET_ARCHITECTURE.md`, `docs/MASTER_ARCHITECTURE_AUDIT.md`, `docs/PHASE_7_AUDIT.md` | narrative references | F Documentation / G Historical | Keep (historical record). New docs use "the store". |
| I-19 | Package scope `@clothing-brand/*`, DB name `clothing_brand` | naming | D / H | **H Legitimate fixed value** for the package scope (internal name, not visible identity). DB name: §13 (env-driven). |

**Result:** application runtime code contains **no** functional dependency on the Asif Zone identity. Identity already
flows from `StoreSetting` into metadata (`apps/web/app/layout.tsx:41-64`), OpenGraph, footer copyright, emails
(`apps/api/src/lib/email-template.ts:22-25`, Phase 7 D-5), SMS `{storeName}` (`packages/shared/src/sms-templates.ts`),
shipping labels (`apps/web/components/orders/shipping-label-square.tsx:79`) — **ALREADY CORRECT**. What remains is
presentation leftovers (I-1..I-3, I-5..I-9), test fixtures (I-10, I-11) and infrastructure (I-12..I-17).

## 5. StoreProfile proposal

**Finding:** a separate `StoreProfile` / `StoreIdentity` table would be a **second owner** of identity, which Phase 7
assigned to `StoreSetting` (written only by `settings.service.updateSettings`, read through `getSettings()`, cached as
`settings:singleton` and web tag `settings`). Phase 7 explicitly rejected a parallel `CommerceSettings` table for the
same reason.

**Proposal (recommended): no new table.** Add the missing identity fields to `StoreSetting` as nullable, additive
columns, written only by `settings.service.updateSettings`, validated in `packages/shared/src/schemas/settings.ts`,
exposed through the existing settings response. Conceptually this is "the StoreProfile section of StoreSetting".

| Field | Exists today? | Proposed | Notes |
|---|---|---|---|
| Store/display name | `storeName` | keep | ALREADY CORRECT |
| Tagline / description | `tagline` | keep | ALREADY CORRECT (used as meta description) |
| Logo, logo on dark, favicon | `logoUrl`, `logoOnDarkUrl`, `faviconUrl` | keep | ALREADY CORRECT |
| Support email / phone | `contactEmail`, `contactPhone` | keep | ALREADY CORRECT |
| WhatsApp / call / live chat | `whatsapp*`, `call*`, `liveChat*`, `tawk*` | keep | ALREADY CORRECT |
| Social links | `SocialLink` table | keep | ALREADY CORRECT |
| Search-console verification | `googleSiteVerification` | keep | ALREADY CORRECT |
| **Legal name** | no | `legalName String?` | Terms, receipts, structured data `legalName`. |
| **Postal address** | no | `addressLine String?`, `addressCity String?`, `addressRegion String?`, `addressPostalCode String?`, `addressCountry String? (ISO-3166 alpha-2)` | Footer (I-6), contact page, JSON-LD `Organization.address`. |
| **Governing-law jurisdiction** | no | `legalJurisdiction String?` (free text, e.g. "Bangladesh") | Terms (I-8). |
| **Support hours** | no | `supportHours String?` | Contact page (optional). **DECISION REQUIRED (D-2)** |
| Domain / public URLs | env only (`NEXT_PUBLIC_SITE_URL`, `WEB_ORIGIN`, `API_ORIGIN`) | **stay env** | A DB copy would be a second truth that can disagree with what nginx/TLS actually serve. **DECISION REQUIRED (D-3)**, recommendation: env only. |
| Locale | `DISPLAY_LOCALE` constant | **stay constant** | Localization is DEFERRED. |
| Currency, timezone | `StoreSetting` (Phase 7) | **unchanged owner** | Not duplicated. |
| Tax | `TaxSetting` | **unchanged owner** | Not duplicated. |
| Shipping | `ShippingZone`/`ShippingRate` | **unchanged owner** | Not duplicated. |

**DECISION REQUIRED (D-1):** confirm "extend `StoreSetting`" over a new `StoreProfile` table.

## 6. Commerce Settings ownership boundaries

| Concept | Owner after Phase 12 | Writer | Reader | Never in |
|---|---|---|---|---|
| Identity (§5 fields) | `StoreSetting` | `settings.service.updateSettings` | `getSettings()` | env, code literals |
| Currency / timezone | `StoreSetting` via `commerce-settings` | same | `getCommerceSettings()` | env, code literals (existing guard) |
| Tax / shipping | `TaxSetting` / `ShippingZone` | `pricing-config` | `loadTaxConfig` / `loadShippingZones` | identity section |
| Payment-method availability (business) | `StoreSetting.codEnabled/onlinePaymentEnabled/epsPaymentEnabled` | settings | checkout/quote | env |
| Payment/SMS/email/courier **credentials & provider choice** | **env** (deployment) | deploy | `providers/registry` (§14) only | DB, web bundle, logs |
| Public URLs / domain | env | deploy | `env.ts` (api), `lib/env.ts` (web) | DB |
| Country rules (phone format, regions, Dhaka split) | code: country module (§10) | code | everyone via the module | settings (not configurable in Phase 12) |
| Public tracking ids (Pixel, Clarity, Tawk, Google client id, VAPID public) | env (`NEXT_PUBLIC_*`) / `StoreSetting.tawk*` (existing) | deploy / settings | web | secret stores |

Rule: **effective availability = business toggle (DB) AND provider configured (env)**. Neither side is copied into the
other. (Today this already holds for EPS: `epsPaymentEnabled` + `EPS_*` credentials.)

## 7. Provider audit

| Provider | Implementation | Config / credential source | Timeout | Retry | Idempotency / claim | Error handling | Test strategy | Direct consumers |
|---|---|---|---|---|---|---|---|---|
| **SSLCommerz** (payment) | `apps/api/src/modules/payments/sslcommerz.service.ts` (`initSslcommerzSession`, `validateSslcommerzTransaction`) | env `SSLCOMMERZ_STORE_ID/STORE_PASSWORD/IS_LIVE`, `API_ORIGIN` for callback URLs | **none** (`fetch` at :63 and :108) | none | `PaymentSession.idempotencyKey`, unique `gatewayTransactionRef`, payment ledger (Phase 4) | non-JSON/network → error to caller | network guard, mocked `fetch` in `payment.integration.test.ts` | `payment.service.ts`, `payment.controller.ts` |
| **EPS** (payment) | `modules/payments/eps.service.ts` (`initEpsSession`, `verifyEpsTransaction`, token cache) | env `EPS_*`, `API_ORIGIN` | **none** (`https.request` at :27, `agent:false`) | 3 attempts (300 ms, 1 s) with token invalidation | same as above | logs `[eps] request failed (attempt n/3)` | network guard / mocks | `payment.service.ts`, `payment.controller.ts`, payment reconciliation |
| **COD / MANUAL** | ledger only (`domain/payments`) | — | — | — | Payment ledger idempotency keys | — | integration | ALREADY CORRECT (no external call) |
| **BulkSMSBD** (SMS) | `apps/api/src/lib/sms.ts` `sendSms` | env `BULKSMSBD_API_KEY/SENDER_ID` | 20 s (`SMS_TIMEOUT_MS`) | caller-level (outbox) | outbox consumer dedupe (Phase 8) for order SMS; OTP is synchronous by design | `SmsProviderError`; dev mode when unset or `LIVE_PROVIDERS=off` | provider guard | `customer.service.ts` (OTP, ad-hoc), `campaign.service.ts`, `lib/order-sms.ts`, `domain/outbox/consumers.ts`, `order.service.ts` |
| **Resend** (email) | `apps/api/src/lib/mailer.ts` `sendMail` | env `RESEND_API_KEY/FROM_ADDRESS` | 20 s | caller-level | outbox for payment receipt | `MailProviderError`; disk fallback | provider guard + disk fallback | `auth.service.ts`, `customer.service.ts`, `campaign.service.ts`, `stock-alert.service.ts`, `wishlist.service.ts`, `lib/order-mailer.ts`, outbox consumers |
| **Steadfast** (courier) | `apps/api/src/lib/steadfast.ts` (create, bulk create, status by CID, balance, fraud score) | env `STEADFAST_API_KEY/SECRET_KEY/BASE_URL/WEBHOOK_TOKEN` | 20 s (`STEADFAST_TIMEOUT_MS`) | fraud-score 429 retry (2/4/8 s, Retry-After) | Phase 9 DB booking claim (`courierBookingStartedAt`); `CourierOutcomeUnknownError` keeps claim | `AppError`s | network guard (no adapter-level `liveProvidersEnabled` check — covered by the guard) | `modules/courier/*`, **`modules/customers/customer.service.ts`** (fraud score) |
| **Meta CAPI** | `apps/api/src/lib/meta/capi.ts`, `purchase.ts` | env `META_PIXEL_ID` (= `NEXT_PUBLIC_META_PIXEL_ID`), `META_ACCESS_TOKEN`, `META_API_VERSION`, `META_TEST_EVENT_CODE` | yes | yes | outbox `meta-capi-purchase`, event id dedupe with browser pixel | `MetaApiError` | provider guard | outbox consumers, `meta-capi-worker.ts`, `order.service.ts`, `order.controller.ts`, `payment.service.ts` |
| **Web Push** | `apps/api/src/lib/push.ts` (`web-push`) | env `WEB_PUSH_*` | **none** | none | — | — | — | `campaign.service.ts` |
| **Anthropic** (AI) | `apps/api/src/modules/ai/ai.service.ts` | env `ANTHROPIC_API_KEY/MODEL` | yes (`AI_REQUEST_TIMEOUT_MS`) | SDK default | n/a | `isAiConfigured()` exposed to admin | network guard | `ai.controller.ts` — ALREADY CORRECT (isolated module) |
| **Google sign-in** | `google-auth-library` (customer + admin auth) | env `GOOGLE_CLIENT_ID`, web `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | library | n/a | n/a | — | — | auth modules |
| **File storage** | local disk: `apps/api/src/modules/uploads/upload.service.ts`, `modules/storage` | env `UPLOADS_DIR`, `API_ORIGIN` | n/a | n/a | n/a | — | temp dirs | uploads, AI, storage. **Note:** stored URLs are absolute `${API_ORIGIN}/uploads/...` (`upload.service.ts:56,104,141,159`) — DEFERRED (D-11) |
| **Browser analytics** | Meta Pixel (`apps/web/lib/meta-pixel.ts`), Clarity, Tawk.to | `NEXT_PUBLIC_*`, `StoreSetting.tawk*` | n/a | n/a | n/a | — | e2e runs without ids | web only — ALREADY CORRECT (public ids only) |

**Domain → concrete provider coupling found:**

- `modules/payments/payment.service.ts:138-140, 253-255`: `paymentMethod === "EPS_PG" ? initEpsSession : initSslcommerzSession` duplicated in two places — no gateway interface.
- `modules/customers/customer.service.ts` imports `lib/steadfast` directly (fraud score) and `lib/sms` (OTP) and `lib/mailer`.
- `modules/orders/order.service.ts` imports `lib/sms`, `lib/order-sms`, `lib/meta/capi`, `lib/notify`.
- `modules/campaigns/campaign.service.ts` imports `lib/sms`, `lib/mailer`, `lib/push`.
- `modules/stock-alerts`, `modules/wishlist`, `modules/auth` import `lib/mailer`.
- Admin UI hard-codes provider names in 7 files (Steadfast), 4 (SSLCommerz/EPS), 1 (BulkSMS/Tawk/Clarity) — §12.

SMS, email, Meta and AI are already isolated *modules* with a single send function; they are not yet behind a named
capability interface with a configuration-selected implementation. Payments and courier are the two real couplings.

## 8. Provider capability matrix (actual, not aspirational)

| Capability | SSLCommerz | EPS | COD/Manual | BulkSMSBD | Resend | Steadfast | Meta CAPI | Web Push |
|---|---|---|---|---|---|---|---|---|
| Create payment session | ✓ | ✓ | n/a | | | | | |
| Verify / validate payment | ✓ (validator API) | ✓ (`verifyEpsTransaction`) | n/a | | | | | |
| Callback / IPN | ✓ success/fail/cancel/**ipn** (POST) | ✓ success/fail/cancel (GET) | | | | | | |
| Gateway refund API | ✗ (refunds recorded manually in ledger) | ✗ | ✓ ledger | | | | | |
| Scheduled reconciliation | — | ✓ (payment-reconciliation cron) | | | | | | |
| Send OTP | | | | ✓ (sync, `customer.service.ts:570`) | | | | |
| Transactional message | | | | ✓ (order SMS via outbox) | ✓ (receipt via outbox, auth/customer emails) | | | ✓ |
| Bulk / campaign | | | | ✓ (campaign loop) | ✓ | | | ✓ |
| Create shipment | | | | | | ✓ single + bulk | | |
| Track shipment | | | | | | ✓ by consignment id (cron) + webhook | | |
| Lookup by invoice / cancel | | | | | | ✗ (not implemented; provider capability unverified) | | |
| Balance | | | | | | ✓ | | |
| Fraud / delivery score | | | | | | ✓ (`/fraud_check/score`) | | |
| Server-side Purchase event | | | | | | | ✓ (only Purchase) | |

Interfaces in §16 expose exactly these capabilities; optional ones are declared as optional, never stubbed to fake
success.

## 9. Secret-management audit (no values printed)

| # | Finding | Location | Severity | Status |
|---|---|---|---|---|
| S-1 | No literal production secret in tracked runtime files; `ci.yml:32-34` are `${{ secrets.* }}` references | repo-wide scan | — | ALREADY CORRECT |
| S-2 | Only `*.example` env files are tracked; values are placeholders. `SEED_ADMIN_PASSWORD` example is the dev default, refused outside development/test (`apps/api/src/lib/seed-credentials.ts:17-25`) | `apps/api/.env.example`, `docker/.env.example`, `apps/web/.env.example` | — | ALREADY CORRECT |
| S-3 | No provider credential columns in the schema (only password/token **hashes**) | `schema.prisma` | — | ALREADY CORRECT |
| S-4 | Web bundle receives only public ids (`NEXT_PUBLIC_API_URL/SITE_URL/CLARITY_ID/META_PIXEL_ID/TAWKTO_*/GOOGLE_CLIENT_ID/VAPID_PUBLIC_KEY`) | `apps/web/Dockerfile`, `apps/web/lib/env.ts` | — | ALREADY CORRECT; add an allowlist guard (§21) |
| S-5 | Logger redacts credential-like keys, JWTs, long hex, phones, emails | `apps/api/src/lib/observability/logger.ts:5-70` | — | ALREADY CORRECT |
| S-6 | BulkSMSBD API key travels in the URL query string (`lib/sms.ts:45-54`, provider-imposed). `maskText` does not mask an alphanumeric key embedded in a URL if an error message ever includes the URL | `lib/sms.ts`, `logger.ts` | Low | Add `api_key=` URL-parameter masking to `maskText` + guard test |
| S-7 | `/health` exposes only `status` + `liveProviders`; settings responses contain no env values | `app.ts:77`, `settings.controller.ts` | — | ALREADY CORRECT |
| S-8 | Legacy scripts now read the SSH password from env (`deploy_vps.py:12`, `inspect_vps.py:12`); the previously committed password remains in **git history** (tracked separately from this phase) | legacy scripts | Medium (historical) | Out of scope here; retire scripts (D-14). History scrub is an owner action already tracked. |
| S-9 | Provider credentials are one flat env set; GitHub repo secrets are single-store | `.github/workflows/ci.yml` | Low | Per-store GitHub Environments (§13) |
| S-10 | No secret-presence validation per selected provider at boot (a provider can be "enabled" in settings with missing credentials and fail at request time) | `config/env.ts` | Low | Registry validates selected providers at startup (§14) |

**Provider reliability findings (not secret-related, recorded for the provider work package):**

| # | Finding | Severity |
|---|---|---|
| P-1 | SSLCommerz `fetch` calls have no timeout (`sslcommerz.service.ts:63,108`) — a hung gateway holds the checkout request | Medium |
| P-2 | EPS `https.request` has no timeout (`eps.service.ts:27`) — affects checkout and the reconciliation cron | Medium |
| P-3 | Web Push `sendNotification` has no timeout (`lib/push.ts:36`) | Low |
| P-4 | EPS reconciliation logs `attempt 1/3 … Unexpected end of JSON input` every 10 min in production; the retry succeeds | Low (pre-existing) |

Fixing P-1..P-3 means adding timeouts at the capability boundary (§16). **DECISION REQUIRED (D-6):** include them in
Phase 12 (recommended, behaviour otherwise unchanged) or defer.

## 10. Bangladesh-specific audit

| # | Location | Assumption | Classification | Phase 12 action |
|---|---|---|---|---|
| B-1 | `packages/shared/src/schemas/common.ts:50-64` | `PHONE_REGEX /^01[3-9]\d{8}$/`, `+880/880/00880` folding, `bdPhoneSchema` | Country/business rule | Move into country module `packages/shared/src/country/bd.ts`; re-export from current path for compatibility. |
| B-2 | `apps/api/src/lib/sms.ts:28-31`, `lib/meta/capi.ts:81-84`, `lib/csv.ts:9` | `01…` → `8801…` conversion | Country rule used by providers | Single `toE164(phone)` in the country module; providers call it. |
| B-3 | `packages/shared/src/delivery.ts:1-29` | `isInsideDhaka` (district === "Dhaka"), 1–2 / 3–5 day estimate | Country/business rule | Country module; one owner of the delivery-estimate rule. |
| B-4 | `packages/shared/src/schemas/order.ts:40-103` | BD division → district list | Country reference data | Country module (reference data). |
| B-5 | `packages/shared/src/engines/shipping.ts:5`, `StoreSetting.shippingFeeDhaka/OutsideDhaka`, `courierReturnFee*` | Dhaka vs outside split as fee mirror | Commerce Settings (Phase 2/7 compatibility mirror) | **ALREADY CORRECT** as documented mirror; no change (removing it is DEFERRED). |
| B-6 | `apps/web/lib/structured-data.ts:8-30` | `MerchantReturnPolicy`/shipping `addressCountry: "BD"`, Dhaka region | Presentation of country rule | Country code from identity `addressCountry` (fallback country module); regions from the module. |
| B-7 | `modules/payments/sslcommerz.service.ts:50,52`; `eps.service.ts:149,193-194` | `cus_city: "Dhaka"`, `cus_country: "Bangladesh"`, EPS city/state fallback `"Dhaka"` | Provider configuration (gateway payload defaults) | Provider adapter takes city/country from the order address with fallback from identity address; **no behaviour change for BD orders**. |
| B-8 | `schema.prisma` `currency @default("BDT")`, `timezone @default("Asia/Dhaka")`; `apps/web/lib/api/storefront.ts` outage placeholder; `packages/shared/src/engines/money.ts`, `format.ts`, `apps/web/lib/format.ts` (`৳`) | currency/timezone defaults and symbol table | Commerce Settings (Phase 7) | **ALREADY CORRECT** (Phase 7 guard `configuration-ssot.guard.test.ts:43-60`). |
| B-9 | `packages/shared/src/sms-templates.ts:7-11`, `apps/api/src/lib/sms-templates.ts` | Bangla default SMS templates, `৳` | Presentation default (overridable in `SmsNotificationSetting`) | Keep (store-overridable). Localization DEFERRED. |
| B-10 | `customer.service.ts:570` | OTP text in English, no store name | Presentation | **DECISION REQUIRED (D-13)**: include `{storeName}` (recommended) — wording only. |
| B-11 | `schema.prisma` `Order.shippingDivision/District/Area`, `Address` same | BD address shape | Country data model | **Legitimate fixed behaviour** in Phase 12 (multi-country DEFERRED). |
| B-12 | footer/checkout bKash/Nagad, `PaymentMethodOption` | BD wallet badges | Store configuration | I-7. |
| B-13 | `apps/web/app/(storefront)/{contact,faq,shipping-returns,terms}`, `components/storefront/footer.tsx`, `components/orders/shipping-label-square.tsx` comment, `lib/fuzzy-search.ts` | BD copy/search synonyms | Presentation / reference | Copy via identity + country module where it states a rule; prose DEFERRED. Search synonyms: legitimate fixed. |
| B-14 | Providers BulkSMSBD, Steadfast, SSLCommerz, EPS | BD-only providers | Provider configuration | Selected by configuration (§14); remain the only implementations. |
| B-15 | `apps/api/src/jobs/storage-trash-cron.ts` (Bangladesh time comment), `admin/(shell)/dashboard` | schedule comment / copy | Presentation | Neutral wording ("store time"). |

No Bangladesh behaviour is removed. The module boundary is: **`packages/shared/src/country/bd.ts` is the only file that
knows Bangladesh rules**; everything else imports from it (guard §21). No runtime country switch is introduced.

## 11. Frontend configuration audit

| Surface | Current source | Canonical source | Status |
|---|---|---|---|
| `<title>` default/template | `settings.storeName` (`app/layout.tsx:42`) | StoreSetting | ALREADY CORRECT |
| Meta description | `settings.tagline` (`:43`) | StoreSetting | ALREADY CORRECT |
| OpenGraph / Twitter | `buildOpenGraph`, `siteName: settings.storeName` (`:61-64`, `lib/seo.ts`) | StoreSetting + `NEXT_PUBLIC_SITE_URL` | ALREADY CORRECT |
| Favicon / apple icon | `settings.faviconUrl`, fallback committed `app/icon.png`, `apple-icon.png`, `favicon.ico` | StoreSetting; neutral fallback | I-5 / D-9 |
| Logo | `StoreLogoImage` ← `logoUrl` | StoreSetting | ALREADY CORRECT |
| Structured data | `lib/structured-data.ts`, `packages/shared/src/json-ld.ts` | StoreSetting identity + country module | B-6; add `legalName`/address when set |
| Sitemap / robots | `app/sitemap.ts`, `app/robots.ts` ← `NEXT_PUBLIC_SITE_URL` | env | ALREADY CORRECT |
| Header / monogram | `settings.storeName` | StoreSetting | ALREADY CORRECT |
| Footer | copyright from settings; **address and wallet badges hard-coded** | StoreSetting address; `PaymentMethodOption` | I-6, I-7 |
| Checkout branding | settings + `PaymentMethodOption` + toggles | same | ALREADY CORRECT (badge copy aside) |
| Order tracking / confirmation | settings | same | ALREADY CORRECT |
| Receipts / emails | `renderEmailLayout` ← settings | same | ALREADY CORRECT |
| SMS | templates `{storeName}` ← settings | same | ALREADY CORRECT (OTP: D-13) |
| Shipping label / PDF | `store.logoUrl`, `storeName` | StoreSetting | ALREADY CORRECT |
| Contact page | `contactEmail/Phone`, social links | StoreSetting | ALREADY CORRECT (add address/hours) |
| Terms / privacy / FAQ / shipping-returns prose | hard-coded TSX | **DECISION REQUIRED (D-10)**: Phase 12 parameterizes identity tokens only (name, legal name, jurisdiction, support contact); full CMS-managed policy pages DEFERRED |
| Web build-time config | `NEXT_PUBLIC_*` baked at `next build` (`apps/web/Dockerfile`, compose `build.args`) | env | **DECISION REQUIRED (D-5)**: accept one web build per store from the same commit (recommended), or runtime config injection (larger change, DEFERRED) |

## 12. Admin configuration audit

- Store name / logo / domain / contact: admin reads them from settings — **ALREADY CORRECT**.
- Placeholders "Asif Zone Originals" — I-1.
- SKU prefix help text `AZ` — I-3.
- **Provider names hard-coded in admin UI**: Steadfast (7 files incl. orders pages, `components/admin/order-detail-panel.tsx`),
  SSLCommerz / EPS (4 files), BulkSMS / Tawk / Clarity (settings page). These describe the *only* implementations and
  stay correct while those providers are configured. Proposal: a read-only, booleans-only
  `GET /api/v1/ops/providers` (permission `settings.manage`) returning `{ capability: { provider, configured } }` so
  the admin shows provider names and hides actions for unconfigured capabilities. No credential values, ever.
  **DECISION REQUIRED (D-4)**.
- Bangladesh copy in admin (`+880` hints, Dhaka filters in `admin/(shell)/{customers,orders,settings}`) — B-1/B-3
  via the country module; copy otherwise unchanged.
- Environment assumptions: `apps/web/lib/env.ts` / `lib/seo.ts` localhost fallbacks for dev — ALREADY CORRECT
  (production requires env).
- Role/permission behaviour: untouched. The new endpoint uses an existing permission (Phase 10 map unchanged).

## 13. Deployment configuration audit

What changes between **Store A** and **Store B** built from the same commit:

| Input | Today | Store-specific? | Required change |
|---|---|---|---|
| `docker/.env` (all `JWT_*`, `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, provider credentials, `WEB_ORIGIN`, `API_ORIGIN`, `NEXT_PUBLIC_*`, `REVALIDATE_SECRET`, `OPS_MONITOR_TOKEN`) | one file | yes | none (already env) — documented per-store template |
| DB name `clothing_brand` | hard-coded in compose (`POSTGRES_DB`, `DATABASE_URL`), `docker/deploy.sh:24`, `backup.sh`, `gdrive-backup.sh` | optional | `POSTGRES_DB` env with default `clothing_brand` (backward compatible) |
| Compose project name | implicit `docker` | yes (if two on one host) | `COMPOSE_PROJECT_NAME` in env (default `docker`) |
| Host ports `80/443`, `127.0.0.1:3000/4000` | fixed | only for same-VPS | D-12 (default: one store per VPS → unchanged) |
| nginx `server_name`, redirects, cert paths | hard-coded `asifzone.com` (`docker/nginx/nginx.conf:65-96`) | yes | template with `envsubst` (official nginx image `templates/` mechanism) from `SERVER_NAME` / `SERVER_ALIASES` / `CERT_NAME` |
| certbot issuance | manual first issuance, renewal reads `/etc/letsencrypt/renewal/<domain>.conf` | yes | documented first-issuance step per store |
| Backups | `gdrive-backup.sh` default remote `gdrive:asifzone-backups`, `BACKUP_DIR` | yes | `GDRIVE_REMOTE` required |
| GitHub secrets / CI deploy | single repo-secret set, `ci.yml` deploy job writes one `.env`; production actually deploys via SSH + `docker/deploy.sh` | yes | per-store GitHub **Environments** + documented manual path; **DECISION REQUIRED (D-15)** on canonical deploy path |
| Upload URLs in DB | absolute `${API_ORIGIN}/uploads/...` | yes (domain-bound data) | DEFERRED (D-11): fresh stores are unaffected; only a *domain move* needs a rewrite |
| Worker | jobs start inside the API process (`server.ts`) | no | unchanged (worker split DEFERRED) |
| Redis | one per stack, keys unprefixed | no (one Redis per store) | unchanged |

Same-commit procedure (target): `git checkout <sha>` → copy `deploy/store.env.example` to the store's `docker/.env` →
set `SERVER_NAME`/`CERT_NAME`/`POSTGRES_DB`/`COMPOSE_PROJECT_NAME`/provider selection + credentials → first TLS
issuance → `bash docker/deploy.sh` → seed OWNER (`SEED_ADMIN_EMAIL/PASSWORD`) → configure identity in admin.

## 14. Proposed architecture

```
apps/api/src
├── config/env.ts                 (unchanged role: reads env once; adds provider selection vars)
├── providers/                    NEW — the only place concrete SDKs/HTTP providers are imported
│   ├── capabilities.ts           interfaces (§16)
│   ├── registry.ts               composition point: env → { payment, sms, email, courier, analyticsEvents, push }
│   ├── payment/sslcommerz.ts     moved from modules/payments/sslcommerz.service.ts (same behaviour)
│   ├── payment/eps.ts            moved from modules/payments/eps.service.ts
│   ├── sms/bulksmsbd.ts          from lib/sms.ts
│   ├── email/resend.ts           from lib/mailer.ts
│   ├── courier/steadfast.ts      from lib/steadfast.ts
│   ├── events/meta-capi.ts       from lib/meta/capi.ts
│   ├── push/web-push.ts          from lib/push.ts
│   └── none/*                    explicit "not configured" implementations (throw NotConfigured, never fake success)
├── domain/…, modules/…           depend on registry capabilities, never on providers/* files
packages/shared/src
└── country/bd.ts                 NEW — the only home of Bangladesh rules (§10)
```

- Old import paths (`lib/sms.ts`, `lib/mailer.ts`, `lib/steadfast.ts`, …) remain as thin re-exports during the
  transition so the move is mechanical and reviewable; removed in the last work package.
- Outbox consumers (`domain/outbox/consumers.ts`) call the capability, preserving consumer keys and dedupe.
- Payment flow: `payment.service.ts` asks `registry.payment.gateway(order.paymentMethod)`; the `PaymentMethod` /
  `PaymentProvider` enums and stored ledger rows are unchanged (historical truth).
- AI stays in `modules/ai` (already isolated; behind `isAiConfigured`).

## 15. Proposed environment variables

New (all optional with backward-compatible defaults that reproduce today's behaviour):

| Variable | Default | Purpose |
|---|---|---|
| `PAYMENT_GATEWAYS` | derived: every gateway whose credentials are present (`sslcommerz,eps` today) | which gateways the registry builds; combined with DB toggles |
| `SMS_PROVIDER` | `bulksmsbd` if key present, else `none` (dev-mode log, as today) | SMS capability |
| `EMAIL_PROVIDER` | `resend` if key present, else `none` (disk fallback, as today) | email capability |
| `COURIER_PROVIDER` | `steadfast` if keys present, else `none` | courier capability |
| `PUSH_PROVIDER` | `webpush` if VAPID keys present, else `none` | push |
| `POSTGRES_DB` | `clothing_brand` | DB name (compose, deploy, backup scripts) |
| `COMPOSE_PROJECT_NAME` | `docker` | stack name |
| `SERVER_NAME`, `SERVER_ALIASES`, `CERT_NAME` | none (required for the templated nginx) | nginx/TLS |
| `GDRIVE_REMOTE` | **required** (no store default) | backups |

**DECISION REQUIRED (D-4b):** explicit `*_PROVIDER` variables (recommended: explicit + startup validation that the
selected provider's credentials exist, refusing to boot otherwise in production) vs. pure auto-detection.

Unchanged and documented as per-store: every existing variable in `apps/api/src/config/env.ts` and `docker/.env.example`.
Removed: none.

## 16. Proposed interfaces (TypeScript, illustrative — exact names fixed in W2)

```ts
interface PaymentGateway {
  readonly id: "SSLCOMMERZ" | "EPS_PG";            // existing enum values, unchanged
  createSession(input: GatewaySessionInput): Promise<{ gatewayUrl: string; providerTransactionId: string }>;
  verify?(ref: string): Promise<GatewayVerification>;               // EPS verify, SSLCommerz validator
  reconcile?(ref: string): Promise<GatewayVerification>;            // only gateways that support it (EPS today)
  // no refund(): neither gateway implements a refund API today (§8)
}
interface SmsSender { sendSms(msg: { to: string; body: string }): Promise<void> }     // OTP, transactional, campaign
interface EmailSender { sendMail(msg: MailMessage): Promise<void> }
interface CourierProvider {
  createShipment(input: ShipmentInput): Promise<ShipmentResult>;    // keeps Phase 9 claim + CourierOutcomeUnknownError
  createShipments?(inputs: ShipmentInput[]): Promise<ShipmentResult[]>;
  statusByConsignment(id: string): Promise<CourierStatus>;
  balance?(): Promise<Money>;
  deliveryScore?(phone: string): Promise<DeliveryScore>;
  // no cancel / lookupByInvoice: not implemented, provider semantics unverified (DEFERRED)
}
interface ServerEventSink { sendPurchase(event: PurchaseEvent): Promise<void> }       // Meta CAPI: Purchase only
interface PushSender { send(sub: PushSubscription, payload: PushPayload): Promise<void> }
interface ProviderStatus { capability: string; provider: string | null; configured: boolean } // booleans only
```

Contract rules for every implementation: a bounded timeout (fixes P-1..P-3 if D-6 approved), errors classified as
`definite rejection` vs `outcome unknown` where the caller's claim logic depends on it, `liveProvidersEnabled()`
respected, no credential in thrown messages.

## 17. Proposed database changes

One additive migration (W3), nothing else:

```sql
ALTER TABLE "StoreSetting"
  ADD COLUMN "legalName" TEXT,
  ADD COLUMN "addressLine" TEXT,
  ADD COLUMN "addressCity" TEXT,
  ADD COLUMN "addressRegion" TEXT,
  ADD COLUMN "addressPostalCode" TEXT,
  ADD COLUMN "addressCountry" TEXT,      -- ISO 3166-1 alpha-2, validated in the schema
  ADD COLUMN "legalJurisdiction" TEXT,
  ADD COLUMN "supportHours" TEXT;        -- only if D-2 approves
```

- All nullable, no backfill, no data written → no production row changes. (Whether to *pre-fill* Asif Zone's
  address/legal name is an admin action by the owner after deploy, not a migration.)
- Optional (D-8): `CatalogSetting.skuPrefix` default `"AZ"` → neutral default. Changing a column **default** does not
  touch existing rows.
- No table for providers or credentials (credentials stay env — **DECISION REQUIRED (D-5b)**, recommended).

## 18. Migration strategy

- Expand-only, same as Phases 4–11: `prisma migrate deploy` in the Phase 11 `docker/deploy.sh` flow (backup → verify →
  migrate → readiness). Old code runs on the expanded schema (new columns unread).
- Fresh DB, `migrate status`, `migrate diff` (no drift) on `clothing_brand_test` and on a production-shaped copy, as
  in the Phase 11 release candidate test.

## 19. Backward compatibility strategy

- Every new env var defaults to today's behaviour (§15); an unchanged Asif Zone `.env` deploys identically.
- Old provider import paths re-export the moved implementations until W6.
- API responses: settings response gains nullable fields only; new provider-status endpoint is additive.
- Web renders new identity fields only when set; when unset, the footer omits the address line (instead of showing
  "Dhaka, Bangladesh"). **For Asif Zone this is a visible change until the owner fills the address** — owner fills it
  before/at deploy (acceptance criterion).
- No URL, cookie, auth or permission change.

## 20. Test strategy

Provider isolation for every test: `LIVE_PROVIDERS=off`, provider credentials blank, network guard on.

| Area | Tests |
|---|---|
| Identity is configuration-driven | API integration: update identity via settings → `getSettings()`, email layout, SMS `{storeName}` render the new values; web: metadata/OG/footer/contact/terms/JSON-LD read settings (component + Playwright with a non-Asif-Zone seed name) |
| Second store, same code | Integration suite run with a **different seeded identity** (name, legal name, address, SKU prefix) and different provider selection (`SMS_PROVIDER=none`, `COURIER_PROVIDER=none`); Playwright smoke against a second seed: title, footer, checkout, order confirmation contain only the seeded identity, no "Asif Zone" anywhere in rendered HTML |
| Provider selection | registry unit tests: env → implementation; missing credentials for a selected provider → startup error in production mode; `none` implementations throw `NotConfigured`, never succeed |
| Capability behaviour unchanged | existing payment, courier claim, outbox consumer, SMS/email tests pass unchanged through the registry |
| Timeouts (if D-6) | gateway/push adapters abort at the configured timeout; payment session stays in its pre-call state |
| Secrets never exposed | API response scan (settings, provider-status, health, error bodies) for env secret values set to sentinel strings; logger test for `api_key=` masking (S-6); web build output scan for non-allowlisted env names |
| Country module | phone normalization, `toE164`, Dhaka split, delivery estimate — same fixtures as today, now against `country/bd` |
| Regression | full API suite, Playwright desktop+mobile, mutation suites, all existing guards, TypeScript, ESLint, API build, web build (Windows standalone EPERM accepted), fresh-DB migrate/status/diff |

## 21. Architecture guard strategy

New guards (static, in the existing `*.guard.test.ts` style):

1. **No store identity literals in runtime code:** `asif[ _-]?zone|asifzone` forbidden in `apps/*/src`, `apps/web/{app,components,lib,hooks}`, `packages/*/src` (tests/e2e/docs excluded).
2. **Providers only via the registry:** files under `apps/api/src/providers/**` are imported only by `providers/registry.ts` (and their own tests); SDK packages (`resend`, `web-push`, `@anthropic-ai/sdk` excepted for `modules/ai`) imported only under `providers/**`.
3. **Provider env read only in config:** `env.sslcommerz|eps|bulkSmsBd|resend|steadfast|meta|webPush` referenced only in `config/env.ts` and `providers/**`.
4. **Country rules in one place:** BD phone regex, `880` conversion, `isInsideDhaka`, BD division list appear only in `packages/shared/src/country/bd.ts`.
5. **Web public-env allowlist:** only the listed `NEXT_PUBLIC_*` names may appear in `apps/web`.
6. **No credential columns:** schema has no column matching `apiKey|secret|password(?!Hash)|accessToken` outside hash fields.
7. Existing guards stay authoritative (configuration SSOT, authorization, outbox, ledger, inventory, historical snapshots).

## 22. Mutation testing strategy

Each mutation must make at least one test fail:

| Mutation | Killed by |
|---|---|
| Reintroduce `"Asif Zone"` literal in footer/metadata | guard 1 + second-store Playwright |
| `payment.service` imports `providers/payment/eps` directly | guard 2 |
| Registry returns a real provider when `*_PROVIDER=none` | registry unit test |
| `none` SMS implementation returns success | registry unit test (must throw `NotConfigured`) |
| Registry skips credential validation for a selected provider | startup validation test |
| Settings/provider-status response includes a credential | secret-exposure test |
| Logger stops masking `api_key=` | logger test (S-6) |
| BD phone regex duplicated outside the country module | guard 4 |
| SSLCommerz/EPS adapter without timeout (if D-6) | timeout test |
| Outbox consumer calls provider without consumer dedupe | existing Phase 8 mutation tests |
| Courier adapter bypasses Phase 9 claim | existing Phase 9 mutation tests |

## 23. Rollback strategy

- Code: redeploy the previous commit. Safe because the only schema change is nullable columns (old code ignores
  them) and env additions default to today's behaviour.
- Data: no data-writing migration in Phase 12, so no restore is needed for rollback (unlike Phase 4). The pre-deploy
  backup from `docker/deploy.sh` is still taken.
- Config: an env file that selects a provider without credentials fails **at startup** (readiness never turns
  green → `deploy.sh` fails before nginx switch), so a bad config cannot silently reach traffic.

## 24. Risks

| Risk | Mitigation |
|---|---|
| Mechanical provider move breaks a subtle behaviour (EPS token cache, SSLCommerz IPN, Steadfast 429 retry, Phase 9 claim) | move files verbatim first (W4), behaviour tests unchanged, re-exports, then switch callers |
| Footer/terms lose Asif Zone address/jurisdiction text until the owner fills the new fields | acceptance requires the owner to enter them; release note |
| Startup validation refuses to boot if production env lacks a credential that is "selected" by default | defaults derive from credential presence; explicit values are opt-in |
| Timeouts (D-6) too short for a slow but succeeding gateway | conservative values (≥ 20 s like SMS/Steadfast), unknown-outcome handling unchanged |
| Scope creep into multi-country/theming | §2 non-goals + guards scoped to isolation only |
| Phase 11 live gate still open | Phase 12 deploy blocked until Phase 11 verification passes (acceptance criterion) |

## 25. Decisions required

| ID | Decision | Recommendation |
|---|---|---|
| D-1 | Identity: extend `StoreSetting` vs new `StoreProfile` table | Extend `StoreSetting` (Phase 7 owner) |
| D-2 | Identity field list (legal name, address ×5, jurisdiction, support hours) | All except support hours unless wanted |
| D-3 | Domain/public URLs stay env-only | Yes |
| D-4 | Read-only provider-status endpoint for admin (booleans) | Yes, `settings.manage` |
| D-4b | Explicit `*_PROVIDER` env + startup validation vs auto-detect | Explicit with credential-derived defaults |
| D-5 | One web build per store (`NEXT_PUBLIC_*` at build time) vs runtime config | One build per store, same commit |
| D-5b | Provider credentials remain env (never DB) | Yes |
| D-6 | Add timeouts to SSLCommerz, EPS, Web Push in Phase 12 | Yes (P-1..P-3) |
| D-7 | Footer wallet badges from `PaymentMethodOption`; behaviour when empty | Show nothing when empty |
| D-8 | Neutral `CatalogSetting.skuPrefix` default for new databases | Yes (`"SKU"`) |
| D-9 | Neutral fallback icon artwork | Yes |
| D-10 | Policy pages: parameterize identity tokens only (CMS deferred) | Yes |
| D-11 | Absolute upload URLs (domain-bound data) | DEFERRED (only matters for a domain move) |
| D-12 | Same-VPS two stores (edge proxy, no host ports in store stack) | DEFERRED; one store per VPS |
| D-13 | OTP SMS includes `{storeName}` | Yes (wording only) |
| D-14 | Retire one-off Asif Zone migration tooling (`migrate-to-new-vps.sh`, `zero-downtime-migrate.sh`, `migrate-vps.yml`, `deploy_vps.py`, `inspect_vps.py`) | Move to `docs/history/` or delete |
| D-15 | Canonical production deploy path (CI on `main` via self-hosted runner vs SSH + `docker/deploy.sh`) and making `main` the source of truth (production runs `claude/charming-gauss-e26lar`, `main` lacks it) | `main` = production; `docker/deploy.sh` as the single deploy entry |

## 26. Explicitly deferred work

Multi-tenancy / shared DB; multi-country, country packs, localization, per-order currency, multi-currency accounting;
dedicated worker split; Redis rate limiting; object storage and upload-URL relativization (D-11); Kafka/event
sourcing; daily facts; custom roles; courier unknown-outcome auto-recovery and courier cancel/lookup-by-invoice
(provider capability unverified); gateway refund APIs (not implemented by either gateway integration); CMS-managed
policy pages; theming/design-system split of storefront vs admin; same-VPS multi-store edge proxy (D-12); removal of
the `StoreSetting.shippingFee*` compatibility mirror.

## 27. Ordered implementation plan (work packages inside Phase 12)

| WP | Content | Depends on |
|---|---|---|
| **W0** | Decisions D-1…D-15 recorded in `docs/BUSINESS_DECISIONS.md`; `main` reconciled with production (D-15) | owner |
| **W1** | Country module `packages/shared/src/country/bd.ts` (B-1..B-4, B-6 helpers) with compatibility re-exports; guard 4 | W0 |
| **W2** | `providers/capabilities.ts` + `registry.ts` + `none/*`; env selection vars with derived defaults + startup validation; guard 3; registry tests | W0 |
| **W3** | Identity fields migration (§17) + settings schema/service/response + admin settings form fields | W0 |
| **W4** | Move SMS, email, push, Meta, Steadfast, SSLCommerz, EPS implementations under `providers/**` verbatim; old paths re-export; switch `payment.service` (remove duplicated ternary), `customer.service`, `order.service`, `campaign.service`, outbox consumers, stock-alert, wishlist, auth to the registry; guard 2; timeouts if D-6; S-6 masking | W2 |
| **W5** | Presentation re-pointing: footer address/badges, terms jurisdiction, contact, JSON-LD, gateway payload city/country, OTP text (D-13), placeholders, neutral icons (D-9), SKU default (D-8), e2e/test fixtures (I-10, I-11); guard 1; provider-status endpoint + admin hiding (D-4) | W3, W4 |
| **W6** | Deployment: `POSTGRES_DB`/`COMPOSE_PROJECT_NAME` parameterization, nginx template, backup scripts, per-store env template `deploy/store.env.example`, per-store runbook, retire legacy tooling (D-14); remove transition re-exports; guard 5, 6 | W4, W5 |
| **W7** | Second-store proof: full suite + Playwright against a second seeded identity with different provider selection; mutation run; sign-off doc `docs/PHASE_12_SIGNOFF.md` | W1–W6 |

## 28. Acceptance criteria

1. Guard 1 passes: no "Asif Zone"/`asifzone` literal in runtime code; rendered storefront HTML for a second seeded
   store contains none.
2. A second store runs from the **same commit** with only a different `.env`, nginx inputs and admin-entered identity;
   documented runbook exercised in CI/local (Playwright second-store smoke green).
3. Every provider is reached only through the registry (guards 2, 3); `*_PROVIDER=none` disables a capability
   explicitly; a selected provider without credentials refuses to boot in production.
4. Capability matrix §8 is implemented exactly — no invented capabilities, no faked success.
5. No credential appears in API responses, logs (incl. `api_key=` URLs), web bundle or DB (guards 5, 6 + tests).
6. Bangladesh rules live only in `packages/shared/src/country/bd.ts` (guard 4); BD behaviour byte-for-byte unchanged
   (existing phone/shipping/delivery tests pass unchanged).
7. One additive migration; fresh DB + `migrate status` + `migrate diff` clean; no production row written by migration.
8. All existing suites green with `LIVE_PROVIDERS=off`: API, Playwright, mutation, guards, TypeScript, ESLint, builds.
9. SSOT invariants untouched: pricing/quote, payment ledger, refunds, inventory, metrics, authorization, outbox,
   historical snapshots (their existing guards + mutation tests pass unchanged).
10. Asif Zone production `.env` deploys with identical behaviour; owner has filled legal name/address/jurisdiction
    before the footer/terms change ships.
11. Phase 11 production verification gate **PASSED** before any Phase 12 production deploy.

---

### Files inspected for this contract

`apps/api/prisma/schema.prisma`; `apps/api/src/config/env.ts`; `apps/api/src/app.ts`; `apps/api/src/server.ts`;
`apps/api/src/lib/{sms,mailer,steadfast,push,cookies,email-template,order-number,order-sms,csv,seed-credentials,provider-guard}.ts`;
`apps/api/src/lib/meta/{capi,purchase}.ts`; `apps/api/src/lib/observability/logger.ts`;
`apps/api/src/modules/payments/{payment.service,payment.routes,sslcommerz.service,eps.service}.ts`;
`apps/api/src/modules/{courier,customers,orders,campaigns,stock-alerts,wishlist,auth,ai,uploads,storage,settings,sms-settings,catalog}/*`;
`apps/api/src/domain/{config,pricing,outbox,storefront}/*`; `apps/api/src/jobs/*`; `apps/api/prisma/seed.ts`;
`apps/web/app/layout.tsx`; `apps/web/app/(storefront)/{contact,faq,shipping-returns,terms,privacy-policy}/page.tsx`;
`apps/web/app/admin/**`; `apps/web/components/{storefront/footer,storefront/header,orders/shipping-label-square,admin/product-form,admin/product-wizard/steps}.tsx`;
`apps/web/lib/{env,seo,structured-data,format,fuzzy-search}.ts`; `apps/web/lib/api/storefront.ts`; `apps/web/e2e/*.spec.ts`;
`apps/web/Dockerfile`; `apps/api/Dockerfile`;
`packages/shared/src/{schemas/common,schemas/order,schemas/settings,delivery,engines/shipping,engines/money,format,sku,sections,sms-templates,customer-sms-templates,permissions}.ts`;
`packages/ui-tokens/src/*`; `docker/{docker-compose.yml,deploy.sh,backup.sh,gdrive-backup.sh,gdrive-restore.sh,migrate-to-new-vps.sh,zero-downtime-migrate.sh}`;
`docker/nginx/nginx.conf`; `.github/workflows/{ci,migrate-vps,validate-nginx}.yml`; `deploy_vps.py`; `inspect_vps.py`;
`*.env.example`; `docs/PHASE_7_SIGNOFF.md`; `docs/PHASE_11_IMPLEMENTATION_CONTRACT.md`.
