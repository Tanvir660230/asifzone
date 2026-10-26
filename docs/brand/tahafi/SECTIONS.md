# Tahafi homepage: section map

The owner builds this in Admin → Homepage (Storefront Studio), using existing section types only. The sample store (`apps/api/scripts/sample-store/tahafi.fixture.ts`) loads exactly this order.

| # | Section type | Content | Image |
|---|---|---|---|
| 1 | `HERO` | Headline (one sentence about a real piece), one supporting line, primary and secondary buttons. **Small line = the hang-tag:** `Name \| detail \| price` | portrait photo, 4:5, at least 1600×2000 |
| 2 | `TRUST_STRIP` | Three real policies: delivery, size swap, cash on delivery | — |
| 3 | `PRODUCT_CAROUSEL` | "New this week", source `new` | product photos, 4:5 |
| 4 | `CATEGORY_GRID` | "Shop by piece" | category photo per category, 4:5 |
| 5 | `IMAGE_GALLERY` (mosaic) | "Worn this week": 3–4 outfit photos, each linking to its product | portrait outfit photos |
| 6 | `PRODUCT_CAROUSEL` | "Most ordered", source `featured` | — |
| 7 | `BRAND_STORY` | One short paragraph that can be checked as true | the hang-tag or a fabric close-up |

Leave out `VALUES_GRID` (it repeats the trust strip) and `NEWSLETTER` (the footer already has it). Turn on `TESTIMONIALS` only once real reviews exist.
