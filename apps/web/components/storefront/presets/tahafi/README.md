# `tahafi` preset

Tahafi's own storefront in the light-glass look the owner chose (2026-10-31, option A of
https://claude.ai/artifact/5bbb2i9bNJXFoLzTmZTxHD): the feel of a new iPhone — a soft grey page, white cards with soft
depth, glass for what floats, glossy ink actions, the logo's olive as the one accent, Geist throughout.

Chrome (`store-chrome.tsx` switches):
- `header.tsx` + `header-actions.tsx`: a bar of light glass — on wide screens the logo, the pieces of clothing as soft
  pills, a search field, the account and the bag with its olive count; on phones Search, the logo and Account (pages inside
  a tab get Back and Search from PhoneNavBar). The menu sheet is the mihrab preset's `MihrabMenu`.
- `dock.tsx`: the phone tab bar — a floating glass capsule (Home, Shop, Search, Saved) and the bag apart as a glass
  circle. `--dock-tab-bar` (4.75rem) is its height plus the gap below it, so panels stop above it.
- The footer is the classic one; the theme renders every band light.

Homepage (`home/home-section.tsx` switches):
- `hero.tsx`: a Today-style card — the photograph in one large rounded card, the headline on its lower edge, the featured
  piece (the hero's small line, split at "|") on a glass bar with the way to order it.
- `sections.tsx`: `TahafiPromiseLine` (TRUST_STRIP on one white card, icons on tinted tiles), `TahafiCategoryIndex`
  (chips with round photos on phones, rounded photo cards with a glass label on wide screens), `TahafiLookbook`
  (IMAGE_GALLERY as rounded photo cards with the caption on glass).

Elsewhere:
- `product-card.tsx`: a white card, the photo square, the name and a firm price, colour dots, a round glass "+".
- `info-card.tsx`: the product page's delivery dates and promises on one white card (`product-showcase.tsx`).
- `order-tag.tsx`: the placed order on one success card at the top of the confirmation page.
- `loader.tsx` (the logo's two diamonds taking turns), `styles.ts`.

Sections not listed render the classic components, styled by the `tahafi` tokens. Brand rules:
docs/brand/tahafi/THEME_BLUEPRINT.md.
