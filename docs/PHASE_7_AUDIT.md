# Phase 7 Audit: Commerce Settings & Configuration SSOT

**Status:** audit and design, 2026-09-30, branch `phase-7/commerce-settings` (from Phase 6 `b5dae97`).

**Goal:** one configuration concept → one canonical owner → one reliable resolution path → no historical
reinterpretation → a reusable Commerce OS.

**Method:**
- read the whole configuration surface: Prisma schema and migrations, the settings, pricing-config, payments, metrics,
  storefront and web code;
- search every `"BDT"`, `৳`, `"en-BD"`, `"Asia/Dhaka"` and date-formatting call;
- search every direct read of `StoreSetting`, `TaxSetting`, `ShippingZone` and `ShippingRate`;
- check the environment-based business configuration.

---

## 1. Current configuration inventory

| Concept | Current owner | Writer | Readers | Cache | Fallback | Historical impact | Proposed canonical owner | Phase |
|---|---|---|---|---|---|---|---|---|
| **Store currency** | `StoreSetting.currency` (NOT NULL, DB default `BDT`) | `settings.service.updateSettings` (the only `StoreSetting` writer); locked once orders exist (Phase 6) | 7 call sites each read `(await getSettings()).currency \|\| "BDT"` (pricing, ledger, read model, order ×4) plus metrics `storeContext`; **not read** by the SSLCommerz init (hard-coded `"BDT"`), Meta CAPI/Pixel (`META_CURRENCY = "BDT"`), web `formatPrice` (hard-coded `৳`), emails (`৳`), SEO structured data (`"BDT"`), admin coupon preview (`"BDT"`) | API: Redis `settings:singleton` 300 s, deleted on update. Web: Next fetch cache 300 s, **not** revalidated on update | 8× `\|\| "BDT"` duplicating the schema default | **High.** Every money snapshot means "store currency" (Phase 6 lock). The writer accepts **any string ≤ 8 chars**, but the money engine knows only 6 codes and silently treats others as 2-decimal (a 0- or 3-decimal currency would be mis-scaled; `Intl` can't format a non-ISO code) | `StoreSetting.currency` (unchanged), resolved through **one** commerce-settings reader; the writer accepts only engine-supported ISO codes | **7** |
| **Store timezone** | `StoreSetting.timezone` (NOT NULL, DB default `Asia/Dhaka`, Phase 5) | `updateSettings` (IANA-validated) | metrics `storeContext` (+ `DEFAULT_STORE_TIMEZONE` fallback constant), analytics windows via `resolveStoreRange`; **not read** by the order-note formatter (`order.service` hard-codes `Asia/Dhaka`), the admin order timeline (hard-codes `Asia/Dhaka`), ~25 web timestamp displays (browser-local), or the admin dashboard's "today" label (browser-local) | as currency | `DEFAULT_STORE_TIMEZONE` duplicates the schema default | None on data (facts are UTC instants; changing it re-buckets reports deterministically). **Runtime inconsistency:** an order shows a different date in the admin list (browser time) than the day reports put it in (store time) | `StoreSetting.timezone`, same reader; every business-date display resolves through it | **7** |
| Tax | `TaxSetting` (Phase 2) | `pricing-config.applySettingsToPricingConfig`, called only from `updateSettings` in the same transaction | quote pipeline (`loadTaxConfig`), tax report | none (read per quote) | row created lazily with schema defaults | snapshots on the order (Phase 2) | `TaxSetting` (unchanged) | — |
| Tax mirrors | `StoreSetting.taxEnabled/defaultTaxRate` | same transaction (dual-write) | admin settings form (display), drift check | settings cache | — | none | compatibility projection, drift-checked (`pricingConfigDrift`); contract C3 later | — |
| Shipping | `ShippingZone` / `ShippingZoneMatch` / `ShippingRate` (Phase 2) | pricing-config only | quote pipeline, courier-loss zone | none | — | snapshot on the order (`shippingFee`, `shippingZoneKey`) | unchanged | — |
| Shipping mirrors | `StoreSetting.shippingFeeDhaka/OutsideDhaka` | same transaction (dual-write) | admin form, SEO structured data, drift check | settings cache | web outage placeholder | none | compatibility projection (Phase 2) | — |
| Courier return fee | `StoreSetting.courierReturnFee*` | `updateSettings` | courier-loss estimate | settings cache | — | `CourierLossEvent` stores the amount | unchanged | — |
| Payment switches | `StoreSetting.codEnabled/onlinePaymentEnabled/epsPaymentEnabled` | `updateSettings` | checkout, payment-methods | settings cache | — | none | unchanged | — |
| Payment credentials | env (`SSLCOMMERZ_*`, `EPS_*`) | deploy | gateway services | — | — | none | env (secrets, not business config); `ProviderConfig` is TARGET M11 | Phase 10+ |
| Order / loyalty | `StoreSetting.rewardPointsPerCurrency` | `updateSettings` | loyalty (D8) | settings cache | — | points ledger stores awarded points | unchanged | — |
| Inventory | per product `trackInventory`, `lowStockThreshold` (catalog data) | product service | availability (D5) | — | — | stock ledger | unchanged (catalog, not store config) | — |
| Catalog | `CatalogSetting` (SKU pattern …) | catalog service | product builder | — | — | none | unchanged | — |
| Notifications | `SmsNotificationSetting` | sms-settings service | notifications | `sms-settings:singleton` | — | none | unchanged | — |
| **Business identity** | `StoreSetting.storeName/tagline/logo*/favicon` | `updateSettings` | web layout, header, SEO, SMS `{storeName}`; **not read** by the email layout (hard-codes `ASIF ZONE`, a tagline and `© Asif Zone`) | settings cache | web outage placeholder `"Store"` | none | `StoreSetting` (unchanged), the email layout reads it | **7** |
| Contact | `StoreSetting.contactEmail/contactPhone/whatsapp*/call*` | `updateSettings` | storefront | settings cache | — | none | unchanged | — |
| Locale / number format | **not a configurable concept.** `"en-BD"` is hard-coded in ~10 formatters | — | web and server formatters | — | — | none | stays a system constant, now declared once (TARGET's `CommerceSettings.locale` is future work) | later |
| Currency display (symbol) | **derived nowhere.** `৳` is hard-coded in the web `formatPrice`, chart axes, admin labels, emails, the coupon-engine message | — | display | — | — | none | derived from the store currency with `Intl` (`narrowSymbol`) — no new setting | **7** |
| Timezone display | see Store timezone | — | — | — | — | — | the store timezone | **7** |

**No partial `CommerceSettings` table exists.** Every concept above already has exactly one storage owner.

## 2. Duplicate truth audit

| # | Finding | Kind | Verdict |
|---|---|---|---|
| D-1 | 8× `\|\| "BDT"` and `DEFAULT_STORE_TIMEZONE` re-declare the schema defaults at each reader. They're dead today (NOT NULL + validated writer), but they are 9 extra "owners" of the default and 8 independent read paths | fallback chain / duplicate reader | **must fix** |
| D-2 | SSLCommerz is told `currency: "BDT"` whatever the store currency is | hard-code in a money path | **must fix**: a non-BDT store would be charged in the wrong currency |
| D-3 | Meta purchase events (server CAPI + browser Pixel) report `META_CURRENCY = "BDT"` | hard-code | **must fix** |
| D-4 | Web `formatPrice` (173 uses) and ~15 other displays print `৳` / `en-BD`; admin labels say "(BDT)"; SEO and the coupon preview use `"BDT"` | display disagreeing with backend config | **must fix** (prevents configuration-only setup) |
| D-5 | Email layout hard-codes `ASIF ZONE`, tagline and copyright, while `StoreSetting.storeName/tagline` are the identity owner | duplicate identity truth | **must fix** |
| D-6 | Order-note formatter and admin order timeline hard-code `Asia/Dhaka`; ~25 web timestamp displays and the dashboard "today" label use the **browser's** timezone | hard-code / browser time as business date | **must fix** |
| D-7 | Web storefront caches `/api/settings` for 300 s and a settings save doesn't revalidate it (product saves do) | stale cache survives an update | **must fix** |
| D-8 | Currency writer accepts any string; money engine silently assumes 2 decimals for unknown codes | inconsistent runtime behaviour | **must fix** |
| D-9 | `StoreSetting` tax/shipping mirrors | Phase 2 compatibility projection, single writer, drift-checked | **not needed** |
| D-10 | `shared/tax.ts` `taxIncludedIn/amountExcludingTax(..., currency = "BDT")` | dead code (no callers; the metrics guard already forbids it) | remove with D-1 |
| D-11 | Web `DEFAULT_STORE_SETTINGS` (currency `BDT`, fees 60/120, name "Store") | outage placeholder when the API is unreachable (build, outage) | **not needed**: documented placeholder, not a reader of truth |

Direct DB access: `StoreSetting` is read and written only in `settings.service`. `TaxSetting` and `ShippingRate` are
written only in `pricing-config`. **No reader bypasses the owning service.**

## 3. Historical safety audit

| Question | Finding |
|---|---|
| Can changing currency reinterpret historical amounts? | Blocked once any order exists (Phase 6 `CURRENCY_LOCKED`). The remaining gap is D-8: before the first order an unsupported code could be saved. Phase 7 restricts the writer to engine-supported ISO codes. |
| Can changing timezone rewrite historical timestamps? | No. Every timestamp is stored in UTC. Timezone only interprets instants into business days (Phase 5 `resolveBusinessRange`, `utcInstant`), so a change re-buckets reports deterministically and writes nothing. |
| Phase 6 snapshots | Untouched. Phase 7 doesn't write order lines. |
| Order / payment / refund snapshots | Untouched. Phase 7 changes no money writer, only where the currency is **read** from. The ledger's currency is the same store currency, resolved through one path. |
| Metrics reproducibility | Unchanged definitions. The timezone comes from the same owner through one resolver. |

## 4. Commerce OS reusability audit

Source-level store assumptions that remain:

| Assumption | Where | Configuration-only today? | Phase |
|---|---|---|---|
| Currency display `৳`, `"BDT"` | web, emails, gateway, Meta (D-2..D-4) | **no** → fixed in Phase 7 | 7 |
| Brand name in emails | email layout (D-5) | **no** → fixed in Phase 7 | 7 |
| Hard-coded timezone | 2 formatters (D-6) | **no** → fixed in Phase 7 | 7 |
| Number locale `en-BD` | formatters | no — locale isn't a supported concept; declared once as a system constant | later (TARGET §7 `CommerceSettings.locale`) |
| Transactional SMS copy in Bengali (`shared/sms-templates.ts`, admin alert) incl. `৳` | code | no — locale **content** | later (`ContentBlock`/locale, TARGET §7) |
| Bangladesh geography (divisions/districts lists, `dhaka-district` legacy zone keys, "Dhaka" labels, phone rules) | shared lists, pricing-config, settings form | no | later (country pack, `GeoRegion`, installer) |
| Bangladesh-only providers (EPS, bKash, Steadfast, SMS gateway) | provider services + env | no | later (`ProviderConfig`, TARGET M11 / Phase 10) |
| Per-order currency | Orders store none; the lock makes the store currency the recorded currency | n/a for one store | future migration (only needed for multi-currency or moving history between stores) |

A new store can be configured for a currency supported by the money engine, and for any IANA timezone and identity,
without code changes once Phase 7 lands. Geography, locale content and providers still need code or a country pack.
Those are installer/country-pack work (TARGET §9), not Phase 7.

## 5. Performance / cache audit

**API:**
- `getSettings()` serves the settings row from Redis for 300 s, falling back to the DB, and the cache is deleted on
  update.
- Consumers call it per request. Checkout reads it about 4× per order (Redis GETs).
- It is cheap. No new cache layer is justified.
- Known quirk: the lazy Redis client drops the process's first command (Phase 5 note). It is harmless for reads.
  Invalidation happens after other traffic in a live process.

**Web:**
- Server components read `/api/settings` through the Next fetch cache (300 s). There is **no revalidation on
  update** (D-7). The existing `/api/revalidate` tag route fixes that with one tag.
- Client components have no settings at all. That is why `formatPrice` hard-codes `৳`.

---

# Proposed Phase 7 Boundary

### MUST FIX NOW
1. **One resolution path for currency and timezone (D-1).**
   - Add `domain/config/commerce-settings.ts`: `getCommerceSettings()`, `getCurrency()`, `getTimezone()`, built on the
     settings cache.
   - Every consumer uses it, including metrics `storeContext`.
   - Remove the 8 `|| "BDT"` fallbacks, `DEFAULT_STORE_TIMEZONE` and the dead `tax.ts` helpers.
   - The **only** system defaults are the schema column defaults. Storage stays in `StoreSetting`, and the writer
     stays `updateSettings`.
2. **Currency validity (D-8).** The writer accepts only ISO codes the money engine supports
   (`SUPPORTED_CURRENCIES`). The Phase 6 lock is unchanged.
3. **Money paths use the store currency (D-2, D-3).** The SSLCommerz init currency and Meta CAPI/Pixel currency come
   from the store currency. `META_CURRENCY` is removed.
4. **Display derives from configuration (D-4, D-6):**
   - One shared formatter pair (`formatMoney`, `formatDateTime`/`formatDate`) with one declared display locale.
   - The server (emails, notes) passes the store currency and timezone.
   - The web gets `{ currency, timezone }` from the settings the root layout already fetches, through a
     `StoreConfig` provider. `formatPrice` and every business-date display use it.
   - No `৳`, `"BDT"`, `"Asia/Dhaka"` or browser-local business dates remain in runtime code.
5. **Identity (D-5).** The email layout reads `storeName`/`tagline` from settings.
6. **Stale settings (D-7).** The settings fetch carries a `settings` tag. A settings save revalidates it.
7. **Guards.**
   - No `"BDT"` / `'Asia/Dhaka'` / `৳` literal in runtime code outside the allowlisted system tables.
   - No `getSettings().currency/.timezone` outside the commerce-settings service.
   - No `StoreSetting` access outside `settings.service`.

### SHOULD FIX LATER
- **A `CommerceSettings` table, installer, config packs, multi-tenant** (TARGET §7, §9, M10). Moving currency and
  timezone into a new table now would **add** a second copy during compatibility and fix nothing: the storage owner is
  already single.
- **Locale setting** (number format, language) and transactional-SMS copy as configurable content.
- **Country pack** (geography, phone rules, legacy zone keys).
- **`ProviderConfig`** for payment/SMS/courier providers, and currency capability per provider: EPS is BDT-only.
- **Per-order currency column**, if multi-currency or history portability is ever needed.
- Outbox (Phase 8), daily facts, role redesign (Phase 10), category hierarchy history.

### NOT NEEDED
- **Moving tax/shipping.** Phase 2 owners are correct. The mirrors are a single-writer, drift-checked compatibility
  projection, and contract C3 retires them later.
- **A new cache layer.** Settings reads are Redis-cached and cheap, and only the web invalidation was missing.
- **The web outage placeholder settings.** They are a fallback when the API is unreachable, not a reader of truth.
- **Timezone snapshots.** Facts are instants, and a timezone change re-buckets deterministically.
