# Nasihamart storefront theme: Honey

Owner, 2026-11-06: a new logo (orange house and arch, charcoal wordmark), organic food alongside attar and caps, and a full
new look. The owner rejected an arch-and-doorway system, then two light options, and approved a dark, sharp look. Mockup:
https://claude.ai/artifact/M6oGXcZWPggnijZHWNjwP8. This replaces the Mihrab theme.

## Direction

The logo's charcoal and orange, with the product lit like a studio shot.

- **Ground:** every shopper page is dark (`dark.always` in ui-tokens). Page #14110E, cards #211C18, cream text #FFF9F1. The
  admin stays light.
- **Colour:** one orange, #F5871F, for actions, always with charcoal type (white on it fails contrast). Link orange #F9A84A.
- **Type:** Outfit for titles, Hind Siliguri for reading (Latin and Bangla).
- **The one big idea:** the hero product stands in front of a glowing disc with its name large. A two-word headline sits on
  either side of the product on wide screens.
- **Shape:** large soft corners and pill controls. No arches outside the logo.

## Content that makes it work (Storefront Studio and Settings)

- Hero: a two-word headline, a cut-out product image on a transparent background, one line of text, one button. A longer
  headline falls back to words beside a rounded photograph.
- Logo: `logoOnDarkUrl` is what shoppers see. `logoUrl` stays the version for light paper (labels, invoices).
- Categories: the first is the large tile, and its name sits on the photo in charcoal, so its image needs a light or orange
  background.
- Promo banner without an image: the full-width orange band.

Logo files: `docs/brand/nasihamart/2026-logo/` (PNG exports from the designer's pack).
