# Nasihamart storefront theme: tidy shop

Owner, 2026-11-06: the dark Honey look and a bright yellow mock were both rejected. The brief became clean, modern and easy to
use, close to Khaas Food: an app-like shop where buying is quick, with organic food first and caps and attar after it. Plan and
mock: https://claude.ai/artifact/EMJp5APRGBJg83frJF2Uxv. This replaces the dark Honey theme. The layout preset keeps the id
`honey`.

## Direction

- **Ground:** a soft off-white page #F7F6F3, white cards. Light only, there is no dark mode.
- **Colour:** one orange, #F5871F, on buying actions only, always with ink type #1F1D1B (white on it fails contrast). Honey tint
  #FFF4E1 only on the top offer and the promo band. Green #17794A only for savings.
- **Type:** Manrope for Latin and figures, Hind Siliguri for Bangla. Never heavier than 700. The fat, round look was the reason
  the yellow mock failed.
- **Shape:** 12 to 16px corners, 12px controls, round only for the + on a card.
- **Buying:** a + on every card adds without leaving the page and becomes a − 1 + stepper. A product with options opens the
  options sheet. On phones a small dark bar above the tabs shows the count and total. Wide screens show the total on the header's
  bag button.
- **Phone tabs:** Home, Shop, Bag, Orders (track order), Chat (contact). The floating contact button is off on phones.

## Content that makes it work (Storefront Studio and Settings)

- Hero: a short headline, one line of text, one button, and a square photo. A cut-out on a transparent background sits best on
  the tint.
- Categories: the first two sit beside the hero as small tiles, the rest appear in the category section.
- Logo: `logoUrl`, the version for light backgrounds, is what shoppers see.
- Product photos stay 5:6. Cards crop them square from the middle, so keep the product centred.

Logo files: `docs/brand/nasihamart/2026-logo/` (PNG exports from the designer's pack).
