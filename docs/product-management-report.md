# Product management system — final report

Scope: turn the product system into a configurable, production-grade catalog (types, templates, attributes, presets, sections, variants, media, completeness, preview, duplication, CSV import/export, SKU generation, SEO, FAQ, related lists, audit history) without breaking existing products. Delivered as seven stacked pull requests (#4–#10); this report is the last of them. How the system works is in [product-catalog.md](product-catalog.md).

## 1. What existed before

- A fixed Prisma enum `ProductType` with 8 values. What each type collected (fields, variant options, size chart) lived in code (`PRODUCT_TYPE_CONFIGS`) and was validated by a hard-coded zod refinement, so a new type needed a deploy.
- Product details in a free JSON column (`attributes`), with the size guide stored inside it.
- Variants with `size` / `color`, one optional `imageId`, a SKU typed by hand; a single `isActive` flag instead of a lifecycle.
- One hard-coded product page: an accordion with fixed rows, a fixed "Shipping & Returns" sentence, fixed recommendation rails, a fixed trust strip.
- One flat summary CSV export per module (products, orders, analytics), with no protection against spreadsheet formulas.
- A generic per-request audit middleware, which recorded that a product was updated but not what changed.
- An older "Attributes" screen that actually defines variant options (colour swatches etc.).

## 2. What changed

| PR | Phase | Result |
|---|---|---|
| #4 | P0 | One product-type registry and shared variant-label helpers (a refactor, no behaviour change) |
| #5 | P1 | Types, templates, attributes, spec groups and size-guide presets as **data**, with Catalog setup admin; old data backfilled |
| #6 | P2 | Draft → Ready → Published → Unpublished workflow with a completeness gate; SEO/OG/canonical; care guides; materials with percentages; audit diffs and history |
| #7 | P3 | Per-variant galleries, image alt/caption/size, variant status and compare-at price, configurable SKU generator |
| #8 | P4 | Configurable page sections (store → template → product), FAQ, video, hand-picked related lists, draft preview through the real page |
| #9 | P5 | Duplicate a product, CSV export/import with a no-write check, history polish, owner-only permanent delete |
| #10 | P6 | Starter presets script, variant partial-update fix, security review with fixes and tests, an admin-only "sold in the last 7 days" panel on the product page, a guard that stops test cleanup from deleting whole tables, acceptance tests, this report |

**Against the brief's 20 features**

| # | Feature | Status |
|---|---|---|
| 1–3 | Product types, dynamic attributes, templates | Done. Types/templates/attributes are rows; an admin adds a type with no code change. Panjabi, Cap, Watch and Shoes are available through `db:seed:presets` |
| 4 | Size guide presets | Done: create, edit, duplicate, archive, live preview, assign to a type, per-product override, add/remove rows and columns, custom headings, unit, notes. **Gap:** a preset can't be assigned straight to one product as a live link; a product either follows its type's preset or carries its own edited table |
| 5 | Care guide presets | Done: create, edit, duplicate, archive, assign to a type or a product, product-level override |
| 6 | Materials | Done: reusable materials, several per product, percentages (validated ≤ 100%), custom product-specific names |
| 7 | Specification builder | Done: spec groups, reuse across templates, reorder, per-product values. **Gap:** a spec can only be added through an attribute definition on a template, not as an ad-hoc key/value on one product |
| 8 | Product page sections | Done: enable/disable/reorder/retitle/reword at store, template and product level, resolved field by field. **Gap:** the trust strip under the price is still hard-coded, not a section |
| 9 | Variant system | Done for size-like + colour-like dimensions with SKU, price, compare-at, stock, barcode, weight, status. **Limit:** at most two dimensions per template |
| 10 | Variant images | Done per variant (not per colour): choose the gallery, first image is primary, storefront switches with the selection |
| 11 | Media | Done: multiple, drag and drop, reorder, primary, variant assignment, alt, caption, stored size, thumb/card/full WebP. Duplicating a product **copies the files** (see section 11) |
| 12 | Completeness | Done: live score, required-before-publish checks configurable per type, enforced by the API inside the write transaction |
| 13 | Preview | Done: `/preview/:id` renders the same page component as the live page, any status |
| 14 | Duplication | Done with options. **Deviation:** description, specifications, size guide and price are always copied; the optional ones are stock, images, materials and care, sections, FAQ, related lists and SEO |
| 15 | Bulk import/export | CSV only (agreed), with a no-write check and per-line errors. Owner-only import |
| 16 | SKU generation | Done: configurable pattern, atomic per-type counters, uniqueness checked against the database and the open form |
| 17 | SEO | Done: title, meta description, slug, focus keyword, OG title/description/image, canonical, SERP preview with defaults shown but never written over custom values |
| 18 | FAQ | Done: add, edit, delete, reorder; `FAQPage` structured data |
| 19 | Related / cross-sell / upsell | Done: five hand-pickable lists with the existing automatic list as fallback |
| 20 | Audit history | Done: specific events with who, when and from → to |

## 3. Database changes

Five additive migrations (an earlier `20260921100000_add_product_type_and_attributes` already existed on `main`):

| Migration | Adds |
|---|---|
| `120000_add_custom_product_type_enum` | `CUSTOM` value on `ProductType` (separate migration: Postgres can't use a new enum value in the transaction that adds it) |
| `120100_add_catalog_config_and_backfill` | `ProductTypeDef`, `ProductTemplate`, `AttributeDefinition` (+ options), `TemplateAttribute`, `SpecGroup`, `SizeGuidePreset`, `ProductAttributeValue`, `Product.typeId`; seeds the 8 built-in types with their templates (23 attribute definitions, 29 template fields, 7 spec groups, 2 size guides); backfills `typeId` and typed values from the JSON column |
| `140000_add_product_status_seo_care_materials` | `ProductStatus` + `Product.status`, OG/canonical/focus-keyword columns, care override, `CareGuidePreset`, `Material`, `ProductMaterial`, template care and required checks; existing products backfill to `PUBLISHED` (inactive ones to `UNPUBLISHED`) |
| `160000_add_variant_galleries_media_sku` | `VariantImage`, image caption and pixel size, variant `isActive` and `compareAtPrice`, `SkuCounter`, `CatalogSetting`, SKU codes on the built-in types; each variant's existing image is copied into its gallery |
| `180000_add_page_sections_faq_relations` | `GlobalSection`, `TemplateSection`, `ProductSection`, `ProductFaq`, `ProductRelation` (+ enum and a CHECK that a product isn't related to itself) |

The legacy `Product.productType` enum and `attributes` JSON are kept as fallbacks, so old rows and old API clients still work. P5 and P6 add no migration.

## 4. API / service changes

- **Catalog** (`/api/catalog/*`): types, templates, attributes, spec groups, size guides, care guides, materials, SKU settings and generator, global page sections. Reads for any admin; writes owner-only.
- **Products**: status workflow with the completeness gate run inside the write transaction (a refusal rolls the whole save back); specific audit events; history endpoint; bulk status with per-product results; `rail/:key` for curated-or-automatic lists; `preview`; `duplicate`; export/template/import check/import.
- **Rules that were tightened**: variants can't be given another product's image; an inactive variant is refused at checkout; permanent delete is owner-only; image files are removed only when nothing else references them.
- **Fixed on the way** (all pre-existing on `main`, all with regression tests, see section 11 for the security ones):
  - a partial product PATCH reset description, brand tier, low-stock threshold, "featured", sort order, "track inventory" (and `isActive`, republishing it);
  - a variant listed in an update without `stock` or `attributeValueIds` had them reset;
  - public product reads, the public flash-sale feed and a customer's wishlist exposed cost prices and tax rate;
  - a client could choose a new variant's primary key on create;
  - admin-written text containing `</script>` (a FAQ answer, a product description, a category name) closed the page's structured-data `<script>` early and put the rest of the text into the live storefront as HTML: a stored script-injection risk. All eight structured-data scripts now go through one escaping helper (`jsonLdString`).
- **New:** `GET /api/products/:id/sales-summary` (any admin): units sold in the last 7 days, the number of orders, and a per-variant breakdown, using the same rule as the customer-facing "N sold in the last 7 days" line so the two always agree.

## 5. Admin UI changes

- **Catalog setup**: Product types, Templates (fields, variant options, size guide, care guide, required checks, page sections), Attributes, Spec groups, Size guides (with live preview), Care guides, Materials, SKUs, Page sections. The old "Attributes" screen is relabelled **Variant options**.
- **Product editor**: tabs (Basic, Pricing & Inventory, Variants, Care & Material, Page content, SEO, History) instead of one long form; a status panel with the live completeness score and exactly what blocks publishing; type-driven fields; size-guide editor with per-product override; variant editor with per-variant gallery picker, SKU generator, status and prices; image uploader with alt text, caption and stored size; SEO tab with SERP preview; FAQ and related-product editors; section editor showing what each blank field inherits; history tab.
- **Product list**: status and type filters, bulk status changes, Duplicate, Import / export.
- **Import / export page**: export, empty template per type, file check with a line-by-line report, "skip products with errors".

## 6. Storefront changes

- One `ProductPageView` renders the live page and the admin preview. Its accordion, order and wording come from the resolved sections; with no overrides it renders exactly what it did before (checked by unit tests and by the acceptance run on existing products).
- Specification groups, size guide (type default or product override), care, material composition, FAQ and video come from data.
- Selecting a colour switches the gallery; selecting a full colour + size combination shows that variant's own price and compare-at price; the cart charges the same price.
- Hand-picked related lists replace the automatic ones, falling back to them when empty.
- **Admin-only sales panel:** while an admin is logged in, the product page (and the preview) shows "Admin only: sold in the last 7 days: N units in M orders" with a per-variant breakdown, even at 0. It renders nothing for anyone else. The admin area marks the browser (a small non-secret cookie, set while a session is verified and cleared on logout) so ordinary customers' browsers never make the request; the API refuses anyone without a valid admin session, so a forged marker only produces a 401. Separately, customers already see "N sold in the last 7 days" whenever N is above zero; that line is unchanged.
- `<title>`, meta description, canonical and Open Graph tags come from the SEO fields; `Product` and `FAQPage` structured data.

## 7. New reusable systems

- `packages/shared`: `computeCompleteness`, section registry and resolver, SKU pattern renderer, gallery picker, per-type validation (`validateProductAgainstConfig`), duplicate and import contracts.
- API: SKU generator with atomic counters, audit diff (`diffProduct`), sections service, `lib/csv.ts` (reader, writer, formula guard), CSV cell parsers, `product-public-select.ts` (the only place that lists what a customer may read of a product), image file copy.
- `pnpm --filter api db:seed:presets`: optional starter data (see section 14).

## 8. Migration details

- All five migrations are additive: nothing existing is dropped, renamed or rewritten, except that `140000` and `160000` set new columns on existing rows (status, gallery rows) and `120100` fills the new typed-value table from the JSON column.
- Verified on scratch databases: every migration applies from empty; `prisma migrate diff` against `schema.prisma` reports no drift (the CI check); the seed runs; on a copy carrying legacy-shaped rows the backfills produced the expected typed values, statuses and galleries. The real dev catalog (7 products) exports and re-checks with 0 errors.
- **Not verified:** the migrations have not been run on production data (I cannot read it).
- **Deploy order:** CI deploys with `docker compose up -d --build` **before** `prisma migrate deploy`, so for a few seconds new API code runs against the old schema and product detail reads fail. Nothing is lost. If that window matters, run `migrate deploy` first.

## 9. Tests performed

- **Unit and integration (vitest, real Postgres)**: catalog CRUD and validation, presenter, completeness, SKU renderer and concurrency, gallery picker, audit diff, sections resolver, status workflow and publish gate, media and variant rules, page sections / FAQ / related lists / preview, duplicate, CSV reader/writer/parsers, import/export, and security (below).
- **Browser (Playwright, desktop and mobile)**: catalog setup, product workflow, variants and media, page sections, duplicate and CSV, existing-product regression (every product renders, a real checkout decrements stock), customer accounts, and the acceptance run below.
- **Acceptance run against the brief's ten tests** (`e2e/product-system-acceptance.spec.ts`, driven through the real admin UI and storefront):

| Brief test | How it was covered |
|---|---|
| 1 Create products: Panjabi, Cap, Shoe, Watch | Each created in the admin; the editor was checked to show exactly that type's fields and no other type's |
| 2 Size guides | Cap guide created, edited, duplicated, archived, assigned to the Cap type, overridden on one product; Apparel, Cap, Shoe rendered on the storefront; none for the watch |
| 3 Care presets | Two presets created; one assigned to a product, a product-specific override, another preset on a watch; each rendered, none leaking between products |
| 4 Attributes | Custom select attribute created, added to the Panjabi type, used by a product, rendered under Specifications |
| 5 Variants (Colour × Size) | 4 variants with generated SKUs, stock, a price override, images per colour; selection, price and gallery switching; cart; checkout (COD); order created; exactly that variant's stock reduced by one |
| 6 Existing products | `storefront-existing-products.spec.ts`: every product page renders, every product resolves a type, a real order decrements stock |
| 7 Product page | Enabled sections render, disabled ones don't, order follows the product's settings, defaults unchanged elsewhere |
| 8 SEO | Title, description, chosen slug, canonical, OG title/description/image, `Product` and `FAQPage` JSON-LD on the page |
| 9 Duplication | Data copied, every SKU new, stock 0, slug new, draft, original untouched |
| 10 Publishing | Draft → Ready → Published → Unpublished (gone from the API at once) → Published |

- **Test-safety guard:** every test file now runs behind a guard that refuses a `deleteMany` / `updateMany` whose filter is effectively empty (see section 11 for why).
- **Security review** (automated where possible): every product route is either on an explicit public list or requires an admin session (checked from the route files, so a new unguarded route fails the test); every catalog write is owner-only except SKU generation; sampled admin routes answer 401 without a session; staff are refused on import, permanent delete and every catalog write; extra fields on create/update are ignored; public reads carry no cost or admin content; script and event-handler payloads in admin-written text don't execute in the browser (sanitised server-side); the video field accepts only YouTube, Vimeo or a direct https media file.
- **Performance**, measured on a scratch database with 500 products (3 variants, 2 images each): admin list page 4 ms and storefront list 4 ms (2–3 queries); one product page's data 5 ms (3 queries); full CSV export 35 ms (1 query); checking a 500-product import file 450–800 ms. That last one is the only N+1 (about 2 reads per existing product, capped at 500 products), accepted for an admin-only bulk action.
- **Final QA commands**: `tsc --noEmit` (api, shared, web), eslint (api, web), `npm run build` (api), `next build`, fresh-database `migrate deploy` + drift check + seed, seed-presets twice on a scratch database.

## 10. Test results

| Check | Result |
|---|---|
| API unit + integration tests (23 files, real Postgres) | **277 of 277 passed**, two consecutive full runs, with the test-safety guard active |
| `tsc --noEmit` (api, shared, web) | clean |
| ESLint | api clean; web 0 errors (the same 2 old `<img>` warnings) |
| `npm run build` (api) | passes |
| `next build` | compiles, type-checks and generates all 11 static pages; then fails at standalone tracing with the Windows-only `EPERM: symlink`. **Not verified here** |
| Fresh database: `migrate deploy`, drift check, seed | all pass, no drift |
| Starter presets on a scratch database | first run adds 31 rows, second run adds nothing; resulting fields checked against the brief's Panjabi, Cap, Watch and Shoe lists |
| Browser suite, desktop + mobile, all specs (128 tests) | **126 passed, 2 failed, 0 skipped.** Both failures are `customer-accounts` (desktop and mobile), which fails in this environment because the dev `.env` holds a live Resend key that rejects example.com addresses; it fails before reaching anything this work touched |
| Acceptance spec (brief's Tests 1-5 and 7-10, plus security and sales-panel checks) | 19 tests x 2 projects, all passed |
| Real dev catalog round trip through CSV export and the import check | 7 products, 0 errors, 7 unchanged |
| Performance (500 products, scratch DB) | see section 9 |

Two problems were found on the way that earlier passing tests had not caught, and both were fixed: (1) the existing-products regression run failed on a hydration mismatch, which turned out to be the structured-data script-injection bug described in section 4, exposed by a test payload on a page the preview view does not render; the acceptance spec now checks the live page and was shown to fail without the fix. (2) The wishlist and flash-sale cost leaks were found by writing the security tests, and each test was confirmed to fail against the old code.

## 11. Remaining issues

**An incident during this work, and what it changed.** While running the API tests at the end, the local dev database lost its products, categories, product types and templates. The test suites run against the developer's own database and clean up with `deleteMany({ where: { categoryId } })`; if a test's setup fails halfway, that variable is `undefined`, Prisma treats an `undefined` filter as "no filter", and the cleanup deletes every row. I could not reproduce the exact triggering failure, so this is the mechanism that fits the evidence. I restored the seeded rows (an insert-only copy from a freshly migrated database) and verified the result matches a fresh seed. Old ids were not recoverable, and every order in that database had been created by the browser tests and was removed in cleanup. **Fix:** a guard, active for every test file, that refuses an unfiltered `deleteMany`/`updateMany` (one test cleanup that relied on that was given an explicit filter). **Recommendation, not done:** run the tests against a separate test database so they can never touch development data; that needs a second database and CI wiring, so it is left to the owner.

**Things that are not verified**
- `next build` compiles, type-checks and generates all pages here, then fails at standalone tracing with a Windows-only `EPERM: symlink`. CI/Docker should confirm.
- Migrations have not run against production data.
- The `customer-accounts` browser spec fails in this environment for a reason outside this work: the dev `.env` holds a live Resend key that rejects example.com addresses.

**Deviations and limits worth knowing**
- **Duplicating a product copies its image files**, so the copy owns its photos (deleting from one can't affect the other). The brief says not to duplicate media unnecessarily; the trade-off is disk space. Sharing files is now safe because deleting an image checks for other references, so this can be switched.
- Duplicate does not offer "copy price / description / specifications / size guide" as options; they are always copied.
- Size guide presets can't be assigned directly to one product (see section 2); product-level override works.
- At most two variant dimensions per template; galleries are per variant, not per colour.
- Specifications can't be added ad hoc on a single product.
- CSV only (no Excel). An import can't clear a value, delete a variant, or carry images; it never publishes and can't change a product's type. Import is owner-only (a decision; easy to open to staff).
- The completeness score isn't stored, so the product list can't sort by it.
- Storefront pages are cached for up to 60 seconds, so unpublishing (or a section change) shows late on the public page; the API stops serving at once.
- The trust strip under the price is still hard-coded.
- No integration test for the order-export formula guard; the shared writer is unit-tested.
- The import check reads each existing product (about 2 queries each), fine at the 500-product cap.

**Security findings, all fixed in this work (all pre-existing on `main`)**
- Public product reads and the anonymous flash-sale feed returned each variant's `costPrice`; a logged-in customer's wishlist returned the whole product row (`costPrice`, `taxRate`) and variant costs. Fixed with one shared list of public fields, with tests that fail on the old code.
- A client could pick a new variant's primary key when creating a product. Fixed.
- Two partial-update data-loss bugs (product fields and variant fields). Fixed.
- CSV formula injection in product, order and analytics exports. Fixed.

## 12. Potential future improvements

Run the tests against their own database (see section 11); on-demand storefront revalidation instead of the 60-second cache; store the completeness score; per-colour galleries; a live-linked size-guide preset per product; ad-hoc specifications; Excel import; batching the import check's reads; turning the trust strip into a section; a content-hash dedupe of uploaded images; letting staff import (with an approval step); reviewing other customer-facing endpoints that use `include` for the same cost-price exposure (the ones found are fixed; the rest were not audited beyond product, wishlist and flash-sale reads).

## 13. Files changed

140 files changed against `main` (about 16,650 lines added, 870 removed) across the seven pull requests; the last one (P6) is 35 files. By area:

- `apps/api/prisma/`: five migrations, `schema.prisma`, `seed-presets.ts` (new, opt-in).
- `apps/api/src/modules/catalog/`: the catalog service, routes, presenter, sections and SKU services and their tests.
- `apps/api/src/modules/products/`: the product service (workflow, gate, history, sections, duplicate, CSV, public select, sales summary) and its integration tests.
- `apps/api/src/lib/`: `csv.ts` and tests; `apps/api/src/test-guard.ts` and `test-setup.ts` (the test-safety guard).
- `packages/shared/src/`: schemas (catalog, product, product-tools), completeness, sections, SKU, gallery, JSON-LD helper.
- `apps/web/app/admin/(shell)/`: Catalog setup pages, products list, editor, import/export page.
- `apps/web/components/`: admin editors (product form, variant editor, section editor, status panel, history, duplicate dialog), storefront `ProductPageView` and the admin sales panel.
- `apps/web/e2e/`: specs for catalog, workflow, variants and media, page sections, duplicate and CSV, existing products, acceptance.
- `docs/`: `product-catalog.md`, this report.

The exact list is `git diff --stat main...HEAD`.

## 14. Commands that must be run

1. Merge PRs #4 → #10 in order (each is based on the previous one). CI only runs on PRs whose base is `main`, so #4 is checked first.
2. Deploy runs `prisma migrate deploy` (five new migrations). To avoid the brief old-schema window, run it before starting the new containers.
3. `pnpm install` is not needed (no dependency changes). `packages/shared` is consumed compiled: `pnpm --filter @clothing-brand/shared build` if you build it yourself.
4. Optional starter data (Panjabi and Cap types, Cotton/Leather/Shoe/Watch care guides, nine materials, a Cap size guide, and the extra Watch and Shoes fields): `pnpm --filter api db:seed:presets`. It only adds, never edits or removes, and can be run twice safely. Nothing runs it automatically.
5. To re-run the checks: `pnpm --filter api test`, `npx playwright test` in `apps/web` (needs a running stack and `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` for an owner account; the acceptance spec also needs the starter presets).

## 15. Environment variables / configuration

None added or changed. The existing `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `E2E_BASE_URL` and `E2E_API_URL` are used by the browser tests. The API's vitest config blanks `RESEND_API_KEY` so tests never call a real mail provider. In the admin, the SKU pattern and prefix (Catalog setup → SKUs) and the store-wide page-section defaults are stored settings that can be changed at any time.
