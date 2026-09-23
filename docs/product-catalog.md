# Product catalog: types, templates and attributes

Product types are **data**, not code. An owner can add "Cap", "Kufi" or "Sandal" in the admin (Catalog setup)
and products of that type immediately get the right fields, size guide and variant options — no deploy.

## The model

```
Product ──▶ ProductTypeDef ──▶ ProductTemplate ──▶ TemplateAttribute ──▶ AttributeDefinition
 (typeId)     "Cap"             fields, variant       required / order /     "Embroidery Type"
                                dimensions,           spec group             SELECT + options
                                size guide preset
```

| Table | What it is |
|---|---|
| `ProductTypeDef` | A kind of product. Identity and grouping only; points at a template. Built-in types (`isSystem`) can be edited/archived, never deleted. |
| `ProductTemplate` | What a type collects: attributes, up to two variant dimensions (size-like / colour-like), size guide behaviour. Several types can share one. |
| `AttributeDefinition` (+ options) | A reusable field: text, long text, number, measurement, yes/no, select, multi-select, date, URL, rich text. `key` and `dataType` are immutable. |
| `SpecGroup` | A titled block on the product page ("Watch Details"). Template attributes choose their group. |
| `SizeGuidePreset` | A reusable chart with its own columns and rows. A template points at one; a product can override with its own table. |
| `CareGuidePreset` | Reusable care instructions (an ordered list of steps). A template sets a default; a product can pick another or write its own. |
| `Material` / `ProductMaterial` | Catalog materials, and a product's composition: catalog or custom lines with optional percentages (validated to total ≤ 100%). |
| `ProductAttributeValue` | One product's value for one attribute, in a **typed column** (so it can be filtered/validated), not a JSON blob. |

`Attribute` / `AttributeValue` (admin: *Variant options*) are a different, older system — Color/Fabric options used to
generate variant combinations. They are untouched.

## How a product is validated and stored

- `POST/PATCH /api/products` resolve the type (`typeId`, else the legacy `productType` enum), then run
  `validateProductAgainstConfig` (in `packages/shared`) against that type's template. The admin form runs the *same function* with
  the config it fetched from `GET /api/catalog/types`, so client and server agree.
- Values for defined attributes go to `ProductAttributeValue`. `Product.attributes` (JSON) now only holds what has no definition:
  the product's own `sizeGuide` override and any legacy key nobody defined. An unknown key is rejected on write.
- Switching a product's type **hides** values the new type doesn't have; it never deletes them. Switching back restores them.
- Detail reads (`GET /api/products/:id`, `/slug/:slug`) return `attributes` as one flat map plus a server-resolved `resolved` view
  (spec groups, size guide, variant dimensions), so the storefront doesn't need the type config.

## Product lifecycle, completeness and history

`Product.status` is `DRAFT → READY → PUBLISHED → UNPUBLISHED`. Only `PUBLISHED` is on the storefront. `Product.isActive` is kept equal to
`status === PUBLISHED` by the product service (the only writer), so every existing `isActive` query still works; a request that only sends the
old `isActive` flag maps onto status. **A new product is a `DRAFT`** unless the caller says otherwise.

**Publish gate.** Moving to `READY` or `PUBLISHED` runs `computeCompleteness` (shared, so the editor's live meter uses the *same* function) on the
saved state inside the write's transaction; if a required check is missing the whole save is rolled back and the 400 names what's missing.
Always required: name + category, price, at least one variant (SKU + the type's options), at least one image, and the template's required
attributes. A template can require more (`requiredChecks`: description, SEO description, size guide, material, care, inventory). Saving an
already-live product never re-checks it. Bulk status returns `{ updated, unchanged, blocked[] }` instead of failing the batch.

**SEO.** `seoTitle`, `seoDescription`, `focusKeyword`, `ogTitle`, `ogDescription`, `ogImageUrl`, `canonicalUrl` (http(s) only). Blank means "use the
automatic default" — defaults are shown as placeholders and never written into the fields. The storefront emits the canonical/OG overrides;
the focus keyword is admin-only.

**History.** Saves record specific events — `product.created`, `price_changed`, `stock_changed`, `published`, `unpublished`,
`size_guide_changed`, `seo_updated`, `care_updated`, `materials_updated`, `attributes_updated`, `variants_changed`, `description_updated`,
`details_updated` — each with the fields that changed (from → to), computed by a pure diff (`product-audit.ts`). They live in `AuditLog`
(`entityType: "products"`); those routes opt out of the generic per-request audit row. `GET /api/products/:id/history` serves them.

## Variants, media and SKUs

- **Variant galleries.** A variant has its own ordered gallery (`VariantImage`); its first image is the variant's primary `imageId`.
  On write, `imageIds` is authoritative; an older client that only sends `imageId` means "exactly this one image". Every image must belong to the
  product. The storefront picks what to show with `pickGalleryImages` (shared, unit-tested): the selected variant's images, else a same-colour
  sibling's, then the product's shared images (assigned to no variant), else everything.
- **Variant status and price.** `ProductVariant.isActive = false` hides the variant from every public read and refuses it at checkout; it keeps its
  order and stock history. `compareAtPrice` must exceed the variant's `price`. The product page shows the selected variant's own price (which is what
  the cart charges) and compare-at price; a running flash sale still wins.
- **Image metadata.** Uploads record the stored image's pixel size; alt text and caption are edited independently. The caption shows on the storefront.
- **SKU generator.** Catalog setup → SKUs: a prefix and a pattern of `{PREFIX} {TYPE} {COLOR} {SIZE} {SEQ:n}` (must contain `{SEQ}`). `{TYPE}` is the
  type's SKU code (falls back to the first three letters of its name). Counters are atomic per type and never reused; a generated SKU is also checked
  against saved variants and the other rows of the open form. Any admin can generate; only the owner changes the pattern. Existing SKUs are never changed.

## Page sections, FAQ, curated lists and preview

- **Sections are code; their settings are data.** `SECTION_REGISTRY` (`packages/shared/src/sections.ts`) lists every section the product page can render
  (description, highlights, specifications, material, care, shipping, returns, warranty, what's included, FAQ, video, size-guide link, reviews and the
  recommendation lists). An admin never adds a section without code, but controls each one's visibility, order, title and — for the text ones — wording.
- **Three levels, resolved field by field:** product → template → store (`GlobalSection`) → the registry default. A template can retitle "Care" and
  inherit everything else. With no overrides the page is exactly what it was before sections existed (the default order is the registry order, and the
  default Shipping & Returns text is the old hard-coded sentence). All override columns are nullable; a row that overrides nothing is not stored.
- **Where to edit:** store level in Catalog setup → Page sections (owner-only writes); template level in the template editor; product level in the
  product form's *Page content* tab, which shows what each blank field inherits and from where. Moving a section pins the whole order at that level.
- **Per-product content:** highlights and "what's included" (one item per line) and the video link live on the product's own section override;
  FAQ (`ProductFaq`, max 30) has its own editor. Text is sanitized on the server (DOMPurify) before it is rendered. Video links are limited to
  YouTube / Vimeo or a direct https `.mp4`/`.webm` (`toVideoEmbed`), so an admin cannot embed an arbitrary page.
- **Curated lists.** `ProductRelation` (RELATED, CROSS_SELL, UPSELL, FREQUENTLY_BOUGHT, RECOMMENDED; max 12 each, never itself). A hand-picked list
  replaces the automatic one; an empty list falls back to the algorithm that always fed the section (`GET /api/products/:id/rail/:key`). Only
  published, active products are served; if every pick has since been unpublished the automatic list is used.
- **Structured data.** A product with FAQ entries and the FAQ section on emits `FAQPage` JSON-LD next to the existing `Product` JSON-LD.
- **Preview.** `/preview/:id` (admin session required) renders the same `ProductPageView` component as the live page from the saved product in any status,
  with a banner, no view tracking and no structured data. `GET /api/products/:id/preview` is `requireAdmin`. The live route still 404s a draft.
- **Migration** `20260921180000_add_page_sections_faq_relations` is additive (five tables, one enum, a CHECK that a product isn't related to itself).

## Duplicating, importing and exporting

- **Duplicate** (`POST /api/products/:id/duplicate`, the *Duplicate* button in the list and the editor). The copy goes through `createProduct`, so it is
  validated by exactly the rules a hand-made product is. It is always a **draft**. Always copied: category, type, prices, descriptions, brand, attributes and
  every variant's options and prices. Never copied: SKUs (each variant gets a fresh one from the SKU generator), barcodes, the slug, the canonical URL,
  reviews, orders, wishlists, flash-sale and bundle membership, view counts and history. Optional (defaults in brackets, `DUPLICATE_COPY_OPTIONS`):
  stock quantities (off, so inventory isn't counted twice), images (on), materials and care (on), page-section settings (on), FAQ (on), hand-picked lists (off),
  SEO text (off: identical text on two pages competes in search). An archived material or care guide is carried over as plain text, with a warning.
- **Images are copied as files**, not shared, so deleting one from either product can never remove the other's photo. As a second line of defence, deleting an image
  (or a product) removes the files only when no other image row still uses the same URL. External image URLs (not ours) are shared as they are.
  If a source image's files are missing on disk it is skipped and reported.
- **Export** (`GET /api/products/export/full[?typeId=]`, any admin): one row per variant, `slug` on every row, the product's own columns on its first row.
  `GET /api/products/import/template[?typeId=]` is just the header (with that type's `attr:<key>` columns). Files start with a UTF-8 byte-order mark so Excel reads
  Bengali and other non-English text correctly. The older summary export (`/export/csv`) is unchanged apart from the guard below.
- **Formula-injection guard.** A text cell that starts with `=`, `+`, `-`, `@`, tab or CR is written with a leading apostrophe (spreadsheets hide it), so a product
  named `=HYPERLINK(...)` can't run on whoever opens the file; the import removes the apostrophe again, so an export re-imports as "no change". Numbers and
  plain number-like text (a phone number such as `+8801711223344`) are left alone. The same guard now covers the order and analytics CSV exports, whose cells hold
  customer-typed names and addresses.
- **Import** (`POST /api/products/import/validate` then `/import/commit`, **owner only**: it can change prices across the whole catalog). Checking writes nothing and
  returns a report with the CSV line and column of every problem, warnings, and what would change for each product. Rules:
  - Rows are grouped by `slug` (or by the name's slug if there is none). An existing slug is **updated**, otherwise the product is **created**.
  - On update a blank cell means "leave it as it is", the variants missing from the file stay (nothing is deleted), the slug never changes (even on a rename),
    and what a CSV can't carry (images, FAQ, page sections, the size guide, hand-picked lists) is kept. A product that already matches the file is skipped.
  - New products are always created as **drafts**; `status` is informational and an import never publishes. An import can't change a product's type.
  - Values are parsed strictly (plain decimals, yes/no, `YYYY-MM-DD`, `a|b` for multiple choices, `Cotton:80|Polyester:20` for materials) and validated with the same
    schemas and per-type rules as the editor. A blank `variant_sku` on a new variant gets a SKU from the store's pattern when the file is written.
  - Commit refuses the whole file if it has any error (HTTP 422 with the report) unless `skipInvalid` is set, which imports the products that pass. File-level
    problems (no header, unclosed quote, over the limits) can never be skipped. Each product is its own write, through `createProduct`/`updateProduct`, so one
    failure affects only that product; those are listed in the result. Limits: 1.5 MB, 2000 rows, 500 products.
  - Stock changes are recorded in the stock history as "Changed by CSV import"; a lower price notifies wishlisted customers, exactly as editing does. One
    `products.imported` audit entry is written per commit, and each product's own history shows the usual events.
- **History labels.** The product history now words the section, FAQ, related-list and duplication events instead of showing raw event names, and
  describes a section override ("hidden, position 3") instead of printing JSON.
- **Permanent delete is owner-only** (the route and the button).

## Permissions

Any admin can read the catalog setup (the product editor needs it). All catalog **writes are OWNER-only**, including the store-wide page-section defaults.
STAFF can still set a product's own sections, FAQ and picks, because those are part of editing the product, and can duplicate products and export.
Importing a CSV and permanently deleting a product are owner-only.

## Legacy compatibility

`Product.productType` (Prisma enum) and `Product.attributes` are kept. `productType` mirrors the type's `legacyType`
(`CUSTOM` for admin-created types). A product with no `typeId` (written by an older release or a direct insert) resolves its
type by the enum key, and its JSON attribute values are still shown until it is next saved.
`PRODUCT_TYPE_CONFIGS` in `packages/shared` is now only the source the seed migration was rendered from, plus a last-resort fallback.

## Starter presets

`pnpm --filter api db:seed:presets` (`prisma/seed-presets.ts`) is an **optional**, idempotent script: nothing runs it automatically. It uses the same service functions the admin screens use and only ever adds: four care guides (Cotton, Leather, Shoe, Watch), nine materials,
a Cap size guide, the attribute definitions the brief's templates need (collar, sleeve, pattern, closure type, adjustable, dial size, case/strap material, glass, shoe type, sole material),
the **Panjabi** and **Cap** types with their templates, and the extra optional fields plus a default care guide on the existing **Watch** and **Shoes** templates. Running it twice changes nothing.

## What a customer may read

Prisma's `include` returns every scalar of a relation, so a public read written as `variants: true` or `include: { product }` also returns cost prices and tax rate. Anything a customer or anonymous visitor can reach
(the storefront product reads, the flash-sale feed, the wishlist) must select its columns from `product-public-select.ts` (`PUBLIC_PRODUCT_SCALARS`, `PUBLIC_VARIANT_FIELDS`) and add a column there only when a storefront screen renders it.
`product-security.integration.test.ts` checks that every product route is either on an explicit public list or behind an admin session, that catalog writes are owner-only, that extra request fields are ignored, and that these
public reads carry no cost.

## Running tests against their own database

`pnpm test` (and every integration test file) creates and deletes real rows in whatever `DATABASE_URL` is active. Against a shared dev
database, a bug in a test's own cleanup can be destructive: `deleteMany({ where: { categoryId } })` with an `undefined` id (a failed
`beforeAll`) is read by Prisma as "no filter" and deletes every row of the table — this happened once during this program and took a
dev database's products, categories, types and templates with it.

Two independent defences:

1. **`src/test-guard.ts`**, installed for every test file via `vitest.config.ts`'s `setupFiles`, refuses a `deleteMany`/`updateMany`
   whose filter is effectively empty, so a broken setup fails loudly at cleanup instead of taking the data with it.
2. **A dedicated test database.** If `apps/api/.env.test` exists (git-ignored, like `.env`; see `.env.test.example`), `vitest.config.ts`
   points every test run at the database it names instead of whatever `DATABASE_URL` a developer's own `.env` or shell already has —
   `pnpm dev` and everything else are unaffected. One-time setup: create a database, `cp .env.test.example .env.test`, then
   `pnpm run db:test:migrate` and `pnpm run db:test:seed` (a few pre-existing tests assume a seeded admin/category exist, matching
   CI's own job order of migrate → seed → test against its own disposable Postgres container). With no `.env.test`, tests fall back to
   the ambient `DATABASE_URL` exactly as before this existed — CI is unaffected either way, since it sets `DATABASE_URL` directly on
   the job and has no `.env.test` file to read.

## Known limits

- The storefront caches product pages for up to **60 seconds** (`REVALIDATE_SECONDS` in `apps/web/lib/api/storefront.ts`), so an unpublished product
  can stay visible for that long. The API stops serving it immediately. (This predates the status workflow; on-demand revalidation would remove it.)
- Variant galleries are set per variant, not per colour: give each variant of a colour the same images (the picker makes that quick). The storefront
  already falls back to a same-colour sibling's gallery when the chosen size has none.
- A template supports at most two variant dimensions (size-like and colour-like), because variants are still unique on `(productId, size, color)`.
- **Variants in an update.** A product PATCH that includes `variants` sends the *whole* list: a variant left out is deleted (or, if it has order history, zeroed).
  Inside the list a variant is judged as it will be saved: an existing variant (`id`) may leave out `sku`, `stock`, its sizes/colour and `attributeValueIds`, and keeps
  the stored values; `attributeValueIds: []` clears its option links; a new variant needs a `sku`. (Before this release those two fields defaulted to 0 and `[]`, so an
  omitted stock reset to zero. The product's own fields have the same rule: a partial update changes only what it sends.)
- **CSV import cannot clear a value or delete anything.** A blank cell leaves the stored value as it is; to remove a value or a variant use the editor. Images are not
  part of the file. Text is trimmed at both ends.
- **Order and analytics exports** now share the CSV guard, but only the shared writer is unit-tested; there is no order-export integration test.

## Deploying

- The migration is additive. `20260921120000_add_custom_product_type_enum` is separate because Postgres can't use a new enum value in
  the transaction that adds it.
- CI's deploy job runs `docker compose up -d --build` **before** `prisma migrate deploy`, so for a few seconds the new API code runs
  against the old schema. Product detail reads will 500 in that window; nothing is lost.
- P4 adds `20260921180000_add_page_sections_faq_relations`: additive; nothing to backfill (no override rows means the old page).
- P3 adds `20260921160000_add_variant_galleries_media_sku`: additive; each variant's existing image is copied into its gallery, built-in types get SKU codes.
- P2 adds `20260921140000_add_product_status_seo_care_materials`: additive; inactive products backfill to `UNPUBLISHED`, everything else to
  `PUBLISHED` (the column default). `ProductMaterial` has CHECK constraints (a name is required; percentage in (0, 100]) that Prisma doesn't model.
- The first catalog migration also seeds the 8 built-in types and backfills `typeId` and `ProductAttributeValue` from the JSON blob. It only inserts;
  it never changes or deletes existing rows.

## Adding a product type (no code)

1. **Catalog setup → Attributes**: add any fields that don't exist yet (Material, Fit, Embroidery Type…).
2. **Size guides**: add a chart if the type needs its own.
3. **Templates**: pick variant options (size and/or colour, with labels), the size guide, and the attributes in display order.
4. **Product types**: create the type and point it at the template. It shows up in *Add product* right away.
