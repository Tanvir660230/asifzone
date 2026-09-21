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

## Permissions

Any admin can read the catalog setup (the product editor needs it). All catalog **writes are OWNER-only**.

## Legacy compatibility

`Product.productType` (Prisma enum) and `Product.attributes` are kept. `productType` mirrors the type's `legacyType`
(`CUSTOM` for admin-created types). A product with no `typeId` (written by an older release or a direct insert) resolves its
type by the enum key, and its JSON attribute values are still shown until it is next saved.
`PRODUCT_TYPE_CONFIGS` in `packages/shared` is now only the source the seed migration was rendered from, plus a last-resort fallback.

## Known limits

- The storefront caches product pages for up to **60 seconds** (`REVALIDATE_SECONDS` in `apps/web/lib/api/storefront.ts`), so an unpublished product
  can stay visible for that long. The API stops serving it immediately. (This predates the status workflow; on-demand revalidation would remove it.)
- A template supports at most two variant dimensions (size-like and colour-like), because variants are still unique on `(productId, size, color)`.

## Deploying

- The migration is additive. `20260921120000_add_custom_product_type_enum` is separate because Postgres can't use a new enum value in
  the transaction that adds it.
- CI's deploy job runs `docker compose up -d --build` **before** `prisma migrate deploy`, so for a few seconds the new API code runs
  against the old schema. Product detail reads will 500 in that window; nothing is lost.
- P2 adds `20260921140000_add_product_status_seo_care_materials`: additive; inactive products backfill to `UNPUBLISHED`, everything else to
  `PUBLISHED` (the column default). `ProductMaterial` has CHECK constraints (a name is required; percentage in (0, 100]) that Prisma doesn't model.
- The first catalog migration also seeds the 8 built-in types and backfills `typeId` and `ProductAttributeValue` from the JSON blob. It only inserts;
  it never changes or deletes existing rows.

## Adding a product type (no code)

1. **Catalog setup → Attributes**: add any fields that don't exist yet (Material, Fit, Embroidery Type…).
2. **Size guides**: add a chart if the type needs its own.
3. **Templates**: pick variant options (size and/or colour, with labels), the size guide, and the attributes in display order.
4. **Product types**: create the type and point it at the template. It shows up in *Add product* right away.
