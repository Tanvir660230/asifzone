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

## Permissions

Any admin can read the catalog setup (the product editor needs it). All catalog **writes are OWNER-only**, including the store-wide page-section defaults.
STAFF can still set a product's own sections, FAQ and picks, because those are part of editing the product.

## Legacy compatibility

`Product.productType` (Prisma enum) and `Product.attributes` are kept. `productType` mirrors the type's `legacyType`
(`CUSTOM` for admin-created types). A product with no `typeId` (written by an older release or a direct insert) resolves its
type by the enum key, and its JSON attribute values are still shown until it is next saved.
`PRODUCT_TYPE_CONFIGS` in `packages/shared` is now only the source the seed migration was rendered from, plus a last-resort fallback.

## Known limits

- The storefront caches product pages for up to **60 seconds** (`REVALIDATE_SECONDS` in `apps/web/lib/api/storefront.ts`), so an unpublished product
  can stay visible for that long. The API stops serving it immediately. (This predates the status workflow; on-demand revalidation would remove it.)
- Variant galleries are set per variant, not per colour: give each variant of a colour the same images (the picker makes that quick). The storefront
  already falls back to a same-colour sibling's gallery when the chosen size has none.
- A template supports at most two variant dimensions (size-like and colour-like), because variants are still unique on `(productId, size, color)`.

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
