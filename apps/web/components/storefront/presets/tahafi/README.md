# `tahafi` preset

Tahafi's own storefront, every piece drawn from the logo's mark (twin diamonds over a curved bar). Mockup the owner
approved (2026-10-31): https://claude.ai/artifact/5bbb2i9bNJXFoLzTmZTxHD.

Chrome (`store-chrome.tsx` switches):
- `header.tsx` + `header-actions.tsx`: an ink bar — pieces of clothing left, logo centred, words right (Search, Track order,
  Account, Bag (n)); phones show the logo and Account, pages inside a tab get Back and Search (PhoneNavBar, drawn cream
  through `--color-fg`). The menu sheet is the mihrab preset's `MihrabMenu`.
- `dock.tsx`: the phone tab bar — a floating ink capsule (Home, Shop, Search, Saved) and the bag on its own in olive with
  its count. `--dock-tab-bar` (4rem) is its height plus the gap below it, so panels stop above it.
- `footer.tsx`: the classic footer's content with `crown` (the canopy) and `signature` (the logo full width).

Homepage (`home/home-section.tsx` switches):
- `hero.tsx`: the photograph edge to edge under the canopy, the diamonds settling into the dip and the hang-tag swinging
  once (`.ui-diamonds-settle` / `.ui-tag-sway`, still with reduced motion); headline over a scrim.
- `sections.tsx`: `TahafiPromiseLine` (TRUST_STRIP as words), `TahafiCategoryIndex` (CATEGORY_GRID as a serif index;
  the photo beside it follows the pointer, `category-index-photo.tsx`), `TahafiLookbook` (IMAGE_GALLERY as an ink band
  with "Shop this look").

Elsewhere:
- `product-card.tsx` (`product-card.tsx` switch): unframed photo, square tag flush left, serif name beside the price,
  colour diamonds, round "+" quick add.
- `tag-card.tsx`: a card cut like the hang-tag — the product page's delivery dates and promises (`product-showcase.tsx`).
- `order-tag.tsx`: the order on a large hang-tag at the top of the confirmation page.
- `hang-tag.tsx`, `twin-diamonds.tsx`, `canopy.tsx`, `loader.tsx`, `styles.ts`: the shared marks.

Sections not listed render the classic components, styled by the `tahafi` tokens. Brand rules:
docs/brand/tahafi/THEME_BLUEPRINT.md.
