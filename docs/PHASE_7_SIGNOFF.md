# Phase 7 Sign-off: Commerce Settings & Configuration SSOT

**Branch:** `phase-7/commerce-settings` (from Phase 6 `b5dae97`).
**Audit and boundary:** [PHASE_7_AUDIT.md](PHASE_7_AUDIT.md).
**Status:** ready for review, awaiting approval.

## 1. Final configuration ownership

| Concept | Storage owner | Writer (only) | Canonical reader | Cache | Consumers |
|---|---|---|---|---|---|
| Store currency | `StoreSetting.currency` | `settings.service.updateSettings`: validated (`SUPPORTED_CURRENCIES`), locked once orders exist | `domain/config/commerce-settings` `getCurrency()` / `getCommerceSettings()` | Redis `settings:singleton` (300 s, replaced on save); web Next fetch cache tag `settings` (revalidated on save) | pricing/quote, payment ledger, read model, orders (zones, loyalty, adjustments), metrics, SSLCommerz, Meta CAPI, emails, SMS vars; web via `<StoreConfig>` → `formatPrice`, Meta Pixel, SEO |
| Store timezone | `StoreSetting.timezone` | same (IANA-validated) | `getTimezone()` / `getCommerceSettings()` (metrics `storeContext` delegates to it) | same | metrics business time, analytics windows, order notes, SMS dates; web via `<StoreConfig>` → `formatStoreDate/Time/DateTime`, the "tomorrow 10:00" follow-up |
| Identity (name, tagline, logos) | `StoreSetting` | same | `getSettings()` | same | web layout/SEO, emails (layout now reads it), SMS `{storeName}` |
| Tax | `TaxSetting` (Phase 2) | `pricing-config` (via `updateSettings`, same transaction) | `loadTaxConfig` | — | quote pipeline |
| Shipping | `ShippingZone` / `ShippingRate` (Phase 2) | `pricing-config` | `loadShippingZones` | — | quote pipeline |
| Tax/shipping mirrors on `StoreSetting` | compatibility projection | dual-written in the same transaction | drift check `pricingConfigDrift` | settings cache | admin form, SEO |
| Display locale | system constant `DISPLAY_LOCALE` (`packages/shared/src/format.ts`) | code | — | — | every formatter |

**System defaults:** only the schema column defaults (`currency` `"BDT"`, `timezone` `"Asia/Dhaka"`), applied when the
row is first created. No reader re-declares a default. The web outage placeholder mirrors them and is used only when
the API is unreachable.

## 2. Currency lifecycle

1. **New store:** the row is created with the schema default. Before the first order, an admin may set any
   engine-supported ISO code (`BDT USD EUR GBP INR JPY`). Anything else is rejected with 400.
2. **First order:** from then on, a change is refused (409 `CURRENCY_LOCKED`, Phase 6). Saving the same code is
   allowed.
3. **Every money path** reads it through `getCurrency()`:
   - quote, ledger and read model;
   - gateway charge currency;
   - Meta events;
   - emails, SMS and web display.

   No amount is re-stored or re-scaled by Phase 7.

## 3. Timezone lifecycle

1. The owner may change it at any time. It is validated as IANA.
2. A save replaces the API cache and revalidates the storefront's copy, so the next read uses the new zone.
3. Facts are UTC instants and are never rewritten. Reports re-bucket deterministically into the new business days.
   Displays (web dates, order notes, SMS dates) show the store's wall clock, never the viewer's browser or server
   timezone.

## 4. Migration and compatibility

- **No schema migration.** Storage was already single-owner, and a `CommerceSettings` table would have added a second
  copy (audit, boundary).
- Test DB `clothing_brand_test`:
  - 80 migrations, `migrate status` up to date;
  - `migrate diff` (datasource → datamodel): no drift;
  - no shadow database used.
- **Compatibility:**
  - `getSettings()` is unchanged;
  - `storeContext()` keeps its signature and delegates;
  - API response shapes are unchanged;
  - the web `formatPrice(value)` signature is unchanged, with an optional `currency` added;
  - `renderEmailLayout` became async and all 7 callers await it.

## 5. Rejected / deferred

| Item | Decision |
|---|---|
| New `CommerceSettings` table / moving currency and timezone storage | Rejected for Phase 7: it would duplicate truth during compatibility. Revisit with the installer (TARGET §7/§9) |
| Locale setting (number format, language) | Deferred. One declared `DISPLAY_LOCALE` constant |
| Transactional SMS copy (Bengali, incl. `৳`) as configurable content | Deferred (content/locale). Allowlisted in the guard with the reason |
| Country pack (geography, phone rules, `dhaka-district` legacy zone keys, "Dhaka" labels) | Deferred (installer) |
| Provider currency capability (EPS is BDT-only), `ProviderConfig` | Deferred (Phase 10 / M11) |
| Per-order currency column | Future migration, only for multi-currency or history portability |
| Outbox, daily facts, RBAC, multi-tenant | Out of scope (Phases 8/10 / not needed) |

## 6. Test evidence (2026-09-30)

| Gate | Result |
|---|---|
| Unit (`lib/commerce-config.test.ts`) | 4 passed: formatting derives from the given currency/timezone; only engine-supported currencies are accepted; lock rule before/after the first order |
| Integration (`domain/config/commerce-settings.integration.test.ts`) | 9 passed. See the list below this table |
| Guard (`domain/config/configuration-ssot.guard.test.ts`) | 4 passed: no hard-coded `"BDT"`/`৳`/`Asia/Dhaka`/`"en-BD"`/fixed +6 h in runtime code (4 allowlisted files, each with a reason); currency/timezone read only via commerce-settings; one owner per settings table; no browser-local dates on the web |
| Source mutations (by hand, then restored) | 10/10 killed. See the list below this table |
| Full API suite, Redis connected / without Redis | 53 files, 708 / 708 passed |
| D8 alone (`-t D8`) with Redis | 2/2 |
| Playwright desktop + mobile | 194 passed, 2 skipped, 0 failed (98 / 98) |
| TypeScript (api, web) · ESLint (api clean; web 0 errors, 2 pre-existing `<img>` warnings) · API build | clean |
| Next.js build | compiled, type-checked, 12/12 pages; standalone copy step fails with the known Windows symlink `EPERM` (14) |
| Migration status / drift | up to date / none |

The integration tests check:
- one resolution path, with quote currency = store currency;
- SSLCommerz is charged in the store currency;
- the Meta event currency is the store currency;
- `CURRENCY_LOCKED` (service and HTTP), with order, payment, refund and metric history byte-identical before and
  after;
- an unsupported code is rejected with 400;
- a timezone change drives business days and order-note time while history stays identical;
- a stale cached copy can't survive a save, and the storefront tag is revalidated;
- the public settings endpoint equals the resolver;
- the email identity comes from settings.

The source mutations were:
- currency lock bypassed;
- currency validation removed;
- timezone falls back to a fixed zone;
- a duplicate reader (metrics bypasses the service);
- settings cache not invalidated;
- storefront not revalidated;
- gateway given a hard-coded currency;
- email brand hard-coded;
- order note in a fixed timezone;
- web `formatPrice` hard-coding the symbol.

**Incident during verification (test DB only, repaired).** The "currency lock bypassed" mutation run let two tests,
which expected a refusal, change `clothing_brand_test`'s currency (to USD, then EUR). They didn't restore it, because
they never expected success.
- I restored it to `BDT` with a guarded direct update: the script checks `current_database()`, and the lock blocks the
  app path once orders exist. I also cleared the settings cache key.
- No order, payment or refund row was touched.
- Both tests now always restore the stored currency in `finally`. A rerun of the whole mutation set left the row
  unchanged: `BDT` / `Asia/Dhaka`.

## 7. Known limitations

- **Negative amounts** now read `-৳200` (Intl) instead of `৳-200`.
- **Web dates** show the store's business date in a medium format (`30 Sept 2026`) instead of the browser's short
  locale format.
- **Pre-first-order currency change:** the web server's module-level store config updates on the next render that
  carries the new settings, at most one render after the revalidated fetch.
- **Emails** print the store name upper-cased in the header, as the hard-coded brand did.
