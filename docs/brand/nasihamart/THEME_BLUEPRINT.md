# Nasihamart storefront theme — blueprint ("Mihrab")

Goal (owner, 2026-10-11): a shopper who knows Asif Zone must not, even for a second, connect Nasihamart to it. Only the
look changes; every function (catalog, search, cart, checkout, accounts, tracking, reviews, wishlist, compare, chat) is
the same code.

## 1. Why the current theme still reads as Asif Zone

The `nasihamart` theme (Phase 7) only re-valued tokens: colours, fonts, radii. Every structure is shared:

| Element | Asif Zone | Nasihamart today |
|---|---|---|
| Header | glass bar, logo left, nav centre, search pill right | identical |
| Section titles | centred serif (Playfair) | centred serif (Newsreader) |
| Category grid | 4 × 4:5 tiles | identical, caption below |
| Product card | framed square image, floating round quick-add, round wishlist | identical, square corners |
| Rails / carousels | centred heading over 4 cards | identical |
| PDP | thumbs left, square image, info right | identical |
| Footer | dark band, 4 link cards, giant centred wordmark | identical, navy |
| Mobile | menu · logo · search, bottom tab bar | identical |

Serif headings over a sans, centred, is also the generic "premium" default, so recolouring it was never going to
separate the two stores.

## 2. Direction

**Mihrab** — the store is built from the shape in its own logo: the pointed arch of a doorway or prayer niche. Tall
arches frame the photography, tall condensed type sets the headings, and the page is read left to right like a
catalogue, not centred like a fashion lookbook.

One memorable thing: **the arch**. Everything around it stays quiet: no glass, no gloss, no pills, no floating circles.

### Colour (brand palette, re-proportioned)

| Name | Hex | Role |
|---|---|---|
| Night navy | `#0B1F33` | Type, primary actions, the announcement strip |
| Ivory | `#F8F6F1` | Page |
| Sand | `#EEE7DB` | Arch backdrops, footer, quiet bands (new) |
| Stone | `#D6C1A2` | Arch outlines, rules on navy; never text on light |
| Lapis | `#123B73` | Hover, links, selected states |
| Mulberry | `#8A2E3B` | Promotions only (Asif Zone's red is gone) — 8.3:1 under white |

Asif Zone is white, black and red; Nasihamart is ivory, sand and navy with no black and no red anywhere.

### Type — one family, two widths

**Instrument Sans** (variable, `wdth` 75–100):

- Headings: condensed (`wdth` 78), weight 560, tight tracking, sentence case. Tall like the arches.
- UI, body and product data: normal width, 400/500.
- Prices: tabular figures.
- No serif in the interface at all (the wordmark in the logo artwork keeps Newsreader). Asif Zone is serif-led; Nasihamart
  is sans-led, which is the single biggest separation.
- No uppercase tracked labels; no eyebrow over every heading.

### Shape

- Photography of categories, the hero and the brand story sits inside a **pointed arch** (SVG mask, `objectBoundingBox`).
- Product images: 4:5, 6 px corners, on sand.
- Controls: 4 px corners, full-width primary actions on the PDP, text links with an underline for secondary actions.
- No shadows on content; depth comes from sand vs ivory.

## 3. Layout — the structural presets

A theme now declares a **layout preset** (`layout: "mihrab"` in `packages/ui-tokens`). Components never ask which
brand is active; a handful of chrome components ask which preset the theme chose and render that preset's composition.
Functional widgets (variant picker, add-to-cart, cart drawer, search overlay, reviews, gallery logic, checkout) are
shared code and restyle through tokens, so behaviour cannot drift. Preset components are imported statically (a server-rendered `next/dynamic`
chunk is blocked by the nonce CSP).

### Header

```
Asif Zone                                   Nasihamart (desktop)
┌──────────────────────────────────────┐    ┌──────────────────────────────────────────────┐
│ LOGO   Nav Nav Nav Nav  (search) ○○○ │    │▓ Free delivery over ৳… · Cash on delivery   ▓│ navy strip (store policy)
└──────────────────────────────────────┘    │ ⌕ Search the store      ⌂ LOGO      Account  Bag 2 │
                                            │──────────────────────────────────────────────│
                                            │   Panjabi   Kufi & Caps   Books   Prayer  …  │ second row
                                            └──────────────────────────────────────────────┘
Nasihamart (375 px):  LOGO ............ ⌕  Bag 2  ☰      — no bottom tab bar
```

### Homepage

```
┌───────────────────────────────┬──────────────────┐
│ Thoughtfully chosen.          │    ╭──────╮      │ hero: left-aligned condensed headline,
│ Meaningfully yours.           │   ╱        ╲     │ arch-masked image with a stone arch
│ body copy                     │  │  image   │    │ outline offset behind it
│ [Shop the collection]  Gifts  │  │          │    │
└───────────────────────────────┴──────────────────┘
Shop by category ─────────────────────── All categories
 ╭─╮  ╭─╮  ╭─╮  ╭─╮  ╭─╮  ╭─╮                 arches in a row (scroll-snap on mobile)
 │ │  │ │  │ │  │ │  │ │  │ │
 name name name name name name

Featured collection ──────────────────── View all     left heading, rule, link
[4:5][4:5][4:5][4:5]                                   cards: no frame, "Add to bag" bar on hover

▓▓▓ navy promo band with a repeating arch line pattern ▓▓▓

 ╭────╮   Our story — split, arch image left, copy right
```

### Product card

Image 4:5 on sand → name (2 lines max) → price row (price, struck price) → colour dots. Promotion as a small
mulberry text tag top-left, wishlist as a bare outline heart top-right, "Add to bag" as a full-width bar that slides up
on hover (desktop) or a small square bag button (touch). Quick view and compare stay, as text actions in the bar.

### Product page

Gallery: large image first, thumbnails in a row underneath (Asif Zone: column on the left), 4:5. Info column: condensed
title, price, options, full-width primary action. Recommendation rails use the left-aligned rail heading.

### Footer

Light sand band (Asif Zone: dark), newsletter as a two-column statement on the left, link columns as plain lists (no
cards), small arch mark and the legal line at the bottom. No giant wordmark.

## 4. Engineering rules

1. Tokens first. A difference that is a value (colour, radius, font, spacing, direction) is a token in the theme.
2. Structure second. A difference that is a composition is a preset component under
   `apps/web/components/storefront/presets/mihrab/`, selected by `storeLayout()`; the classic component is untouched.
3. Presets reuse the shared hooks and stores (`useAddToCart`, `useCartStore`, `useSearchStore` …); they never fetch or
   compute prices themselves.
4. Asif Zone must stay pixel-identical: screenshot diff of `default` before/after.
5. Every preset handles loading, empty and error states and works at 375 px; WCAG AA contrast; reduced motion respected.
6. Motion: one moment only — the hero arch outline draws in on first load. Everything else answers a tap.

## 5. Delivery plan

| # | Work | Files |
|---|---|---|
| 1 | Tokens: palette, sand, mulberry, condensed headings, `layout: "mihrab"`, preset helper | ui-tokens, `lib/theme-layout.ts`, `app/layout.tsx` |
| 2 | Arch primitive (mask + outline) | `presets/mihrab/arch.tsx`, globals.css |
| 3 | Header + announcement strip + mobile menu; hide bottom tab bar | presets/mihrab/header.tsx |
| 4 | Hero, category arches, rail heading, promo band, brand story, values | presets/mihrab/* |
| 5 | Product card | presets/mihrab/product-card.tsx |
| 6 | PDP gallery direction + info column tokens | tokens + recipes |
| 7 | Footer | presets/mihrab/footer.tsx |
| 8 | Cart, checkout, account, search, drawers: token pass, screenshots | tokens |
| 9 | Verify: lint, tsc, tests, axe, desktop + 375 px screenshots of both stores, Asif Zone diff | — |

## 6. Status (2026-10-12)

All nine steps done, plus: the account area renders the preset header/footer (`store-chrome.tsx`), a Mihrab flash
sale on sand (the classic navy band made mulberry and navy text unreadable), the arch loading state, square chips in
tabs, carousels, overlays and the cart reminder, and the reminder sits where the absent tab bar was.

Verified: Asif Zone (`default`) pixel-identical to `main` on 8 pages at 1440 and 375 px (only the contact button's
pulse animation differs); storefront e2e (`storefront-existing-products`, `variant-picker-and-stock`,
`customer-accounts`) 26 passed / 2 skipped in both themes, including a real COD order; axe 0 WCAG A/AA violations on 9
Nasihamart pages at both widths; no 375 px overflow.

Open: hero banners are owner artwork in the shared carousel, so Nasihamart's banners should be drawn in this style;
the 404 page and the auth card are shared and only token-styled.
