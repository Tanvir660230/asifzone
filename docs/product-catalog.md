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

## Permissions

Any admin can read the catalog setup (the product editor needs it). All catalog **writes are OWNER-only**.

## Legacy compatibility

`Product.productType` (Prisma enum) and `Product.attributes` are kept. `productType` mirrors the type's `legacyType`
(`CUSTOM` for admin-created types). A product with no `typeId` (written by an older release or a direct insert) resolves its
type by the enum key, and its JSON attribute values are still shown until it is next saved.
`PRODUCT_TYPE_CONFIGS` in `packages/shared` is now only the source the seed migration was rendered from, plus a last-resort fallback.

## Deploying

- The migration is additive. `20260921120000_add_custom_product_type_enum` is separate because Postgres can't use a new enum value in
  the transaction that adds it.
- CI's deploy job runs `docker compose up -d --build` **before** `prisma migrate deploy`, so for a few seconds the new API code runs
  against the old schema. Product detail reads will 500 in that window; nothing is lost.
- The migration also seeds the 8 built-in types and backfills `typeId` and `ProductAttributeValue` from the JSON blob. It only inserts;
  it never changes or deletes existing rows.

## Adding a product type (no code)

1. **Catalog setup → Attributes**: add any fields that don't exist yet (Material, Fit, Embroidery Type…).
2. **Size guides**: add a chart if the type needs its own.
3. **Templates**: pick variant options (size and/or colour, with labels), the size guide, and the attributes in display order.
4. **Product types**: create the type and point it at the template. It shows up in *Add product* right away.
