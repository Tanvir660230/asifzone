# Variant groups and campaign landing pages

Two additions on top of the existing catalog, checkout and ad tracking. Neither adds a second inventory or a second
price: a variant (`ProductVariant`) stays the one unit that owns its SKU, stock, price, photos and history.

## What already existed (audit, 2026-11-03)

- **Parent product + variants** — `Product` → `ProductVariant` (size, colour, own SKU, stock, price / compare-at / cost,
  sold-out, free delivery, stock policy, own photo gallery via `VariantImage`). The admin product builder already
  generates the colour × size matrix, bulk-edits stock and prices, generates SKUs and previews the page.
- **"ERP"** is not a separate system: stock movements, valuation, purchasing, production, finance and order lines all
  live in the same database and key on `variantId`. Order lines also snapshot name / SKU / size / colour / price.
- **Checkout** — server quote, stale-price guard (`QUOTE_CHANGED`), idempotency key, server-side stock check.
- **Ad tracking** — `apps/web/lib/pixels` (ViewContent = product id as `product_group`; cart/checkout/purchase = variant
  ids) plus server-side Purchase to Meta CAPI and TikTok with `event_id = purchase_<orderNumber>` (docs/AD_PIXELS.md).
- **Landing pages** — every published product had an automatic, fixed `/lp/<product-slug>`.

What was missing: on the live store the caps were one product per colour/design (22 of 26 products), with no way to
fold them into one; landing pages could not be customised, and their gallery did not follow the chosen colour.

## 1. Grouping products into one parent

Admin › Products › **Group colours** (`/admin/products/group`, `catalog.manage`).

1. Choose the product to keep (its name, description, photos and address stay).
2. Choose the products to fold in. Nothing is ever grouped by name.
3. Per source: the colour name its variants carry in the group (rename "Black" to "Black A" when two designs share a
   colour) and a swatch colour.
4. Map size spellings onto the parent's (e.g. `L 22.5` → `L/22.5`), or keep them.
5. The preview lists every variant that moves (SKU, new colour/size, stock, price), notes, and blockers. Group.

What the grouping does (`apps/api/src/modules/products/product-grouping.ts`), in one locked transaction:

- **Moves** each source variant (`productId` changes). Its id, SKU, stock, stock movements, valuation, purchase and
  production lines and past order lines are untouched.
- **Pins** what the variant inherited from its old product wherever the parent would give it something else: price,
  "was" price (a source without one gets its own selling price, so no discount appears that never existed), cost, free
  delivery, sold-out, stock policy. Selling prices never change.
- Variants from an unpublished source arrive **turned off**.
- Moves the source's photos to the parent and links them to those variants (so the colour picker shows each colour's
  own photos); links the parent's own photos to its own variants the same way. Moves reviews and recomputes ratings.
- Unpublishes each source and adds 301 redirects `/product/<source>` → `/product/<parent>` and `/lp/<source>` →
  `/lp/<parent>`, so running ads keep landing.

Refused (blockers): a source in Trash, a material, filled-to-order, with a different stock-tracking or tax setting, with
a bill of materials or production orders, in a flash sale that hasn't ended, named by an active coupon, with its own
campaign landing page, or any two variants ending up with the same size + colour.

**Undo** (same page, "Groupings into …"): restores every variant field, photo, review, product status and redirect from
the grouping's snapshot (`ProductGrouping.snapshot`). Sales made while grouped stay recorded. Refused if a grouped
variant was since deleted or moved elsewhere.

Reports that group by product will show the folded-in variants' past sales under the parent — that is the point of
grouping; each order line still names its original SKU and colour.

## 2. Campaign landing pages

Admin › Marketing › **Landing pages** › Campaign pages (`promotions.manage`). Many pages may sell the same product.

- **New page**: name, address (`/lp/<slug>`), product, template — *Single product*, *Multiple colours*, *Product
  launch*, *Promotional offer*. The template is copied; editing a page never changes it.
- **Editor**: the variants to sell (by colour, with sizes; empty = all, including ones added later), the colour/size
  the page starts on, sections (drag to reorder, switch off, edit, add, remove), heading style, phone order bar,
  "call us" in the header, and the link-preview title/description/image. Autosaves; the right side shows the working
  copy exactly as it will look (phone or desktop width).
- **Sections**: hero, gallery & price, colour showcase, features, specifications, offer (words + optional countdown —
  never a price change), description, reviews, delivery & payment (from store settings), FAQ (own + standard answers),
  trust badges, order form (required), more products. Backgrounds are theme tokens only; no custom HTML or scripts.
- **Draft / Publish / Unpublish / Duplicate / Delete**. Visitors see only what was published; later edits show as
  "Unpublished changes" until *Publish changes*. Renaming a live page's address adds a redirect from the old one.
  Only an unpublished page can be deleted. A page only publishes for a published product, and disappears if the
  product is unpublished.
- **Routing**: `/lp/<slug>` shows a published campaign page at that address; otherwise the product's automatic page as
  before. A campaign address can't be a product's slug or an active redirect.

Orders from a campaign page go through the same order form and `POST /orders` as the automatic page: server prices,
stock and delivery charges, idempotency, `QUOTE_CHANGED`. Tracking is unchanged — ViewContent with the product id,
InitiateCheckout/AddPaymentInfo/Purchase with variant ids, server Purchase deduplicated by order number — so Meta sees
the same ids from every page. Ad spend attribution keeps working through the page path (`Campaign.landingPath`).

## API

| Method | Path | |
|---|---|---|
| POST | `/api/products/groupings/preview` | plan, no writes |
| POST | `/api/products/groupings` | group |
| POST | `/api/products/groupings/:id/undo` | undo |
| GET | `/api/products/:id/groupings` | groupings into a product |
| GET/POST | `/api/landing-pages` | list / create |
| GET/PUT/DELETE | `/api/landing-pages/:id` | read / save working copy (`version` guarded) / delete |
| POST | `/api/landing-pages/:id/{publish,unpublish,duplicate}` | |
| GET | `/api/landing-pages/:id/preview` | working copy, admin only (`/lp-preview/<id>`) |
| GET | `/api/landing-pages/public/:slug` | the live page, public |

Migration `20261210100000_variant_groups_landing_pages` only adds `ProductGrouping`, `LandingPage` and the
`LandingPageStatus` enum — no existing table or row changes. Rolling back the code leaves the two tables unused.
