# `tahafi` preset

Tahafi's own storefront in the light-glass look the owner chose (2026-10-31, option A of
https://claude.ai/artifact/5bbb2i9bNJXFoLzTmZTxHD): the feel of a new iPhone — a soft grey page, white cards with soft
depth, glass for what floats, glossy ink actions, the logo's olive as the one accent, Geist throughout.

Colour modes: light (option A) and dark (option B), following the shopper's device unless they choose
(`mode-toggle.tsx` in the header: Auto / Light / Dark, remembered in the `color-mode` cookie, applied before the first paint
by the root layout's `<html data-mode>`). The dark palette is `themeDefinitions.tahafi.dark` in ui-tokens; it reaches
storefront pages only, never the admin. Photo cards keep the light colours in either mode (`data-surface="storefront"`).

Chrome (`store-chrome.tsx` switches):
- `header.tsx` + `header-actions.tsx`: on phones, round glass buttons float over the page (light/dark, the logo in a
  capsule, the account) and the bar turns to glass once the page scrolls (`.ui-header-float`); pages inside a tab get
  Back and Search from PhoneNavBar. Wide screens: one glass bar — logo, the pieces as soft pills, search, light/dark,
  account, bag with its olive count. `menu.tsx`: the Shop sheet — search, the pieces as photo tiles two to a row, the help pages on a white card.
- `dock.tsx`: the phone tab bar — a floating glass capsule (Home, Shop, Search, Saved) and the bag apart as a glass
  circle. `--dock-tab-bar` (4.75rem) is its height plus the gap below it, so panels stop above it.
- The footer is the classic one; the theme renders every band light.

Homepage (`home/home-section.tsx` switches):
- `hero.tsx`: a Today-style card — on phones edge to edge from the top of the screen, under the floating header; on
  wide screens one large rounded card; the headline on its lower edge, the featured
  piece (the hero's small line, split at "|") on a glass bar with the way to order it.
- `sections.tsx`: `TahafiPromiseLine` (TRUST_STRIP on one white card, icons on tinted tiles), `TahafiCategoryIndex`
  (chips with round photos on phones, rounded photo cards with a glass label on wide screens), `TahafiLookbook`
  (IMAGE_GALLERY as rounded photo cards with the caption on glass).

Elsewhere:
- `product-card.tsx`: a white card, the photo square, the name and a firm price, a tag only for a live discount, a
  round glass "+".
- `info-card.tsx`: the product page's delivery dates and promises on one white card (`product-showcase.tsx`, which on
  phones also runs the photograph edge to edge and raises the details over it on a sheet).
- `order-tag.tsx`: the placed order on one success card at the top of the confirmation page.
- `loader.tsx` (the logo's two diamonds taking turns), `styles.ts`.

Sections not listed render the classic components, styled by the `tahafi` tokens. Brand rules:
docs/brand/tahafi/THEME_BLUEPRINT.md.
