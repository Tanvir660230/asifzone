# Tahafi theme blueprint

Modern modest menswear: jackets, overshirts, panjabi and caps for campus, work and Jummah. The look is quiet and confident. The clothes and the photography carry it; the interface stays out of the way.

Everything comes from the logo (the designer's master, 2026-10-28): its four colours, and its mark (twin diamonds over a curved bar, on two sweeping legs).

## Tokens (`packages/ui-tokens`, `themeDefinitions.tahafi`)

Only the logo's four colours, plus tints of them. No brass, no red. Ink leads (owner, 2026-10-31: olive as the main colour felt heavy; ink lets olive, black and khaki garments stand out and reads clearest on phones); olive stays as the brand's second voice.

| Role | Value | Notes |
|---|---|---|
| Brand ground: hero, top strip, footer, flash sale, promo bands | ink `#1C1C1A` (`ink-950`) | cream on it 14.9:1 |
| Actions (`accent` role) | ink `#1C1C1A`, hover olive `#4F5343` | the role is re-valued, not a palette step |
| Logo, nav underline, sale tag, brand card | olive `#4F5343` | the brand's second voice; cream on it 6.9:1 |
| Text, headings | ink `#1C1C1A` (`ink-900`) | 14.9:1 on cream |
| Page | cream `#F2EFEA` (`cream-100`) | |
| Cards, inputs | `#FAF8F5` (`cream-50`) | |
| Wells behind photos | sage-washed cream `#E4E2DC` (`cream-200`) | |
| Threads, quiet marks | sage `#84857E` | 3.3:1 on cream, so never text; hints use the darker `#64655E` (`ink-400`, 5.1:1) |
| Promotions (`sale`) | an olive tag with white type, olive sale price | the logo has no red |
| Secondary text on ink | `#E4E1DA` / `#C4C2B9` / `#A9A9A0` (`ink-300/400/500` inside dark bands) | 13.1 / 9.6 / 7.2:1 |

Contrast is enforced by `apps/api/src/config/theme-tokens.test.ts` (every text step on cream, the well, ink and inside the bands).

- **Type:** Instrument Serif for every title (closest to the wordmark's serif), at weight 400 and set large (it is narrow and light); Geist for everything else. Both load only on this store (`next/font`, `preload: false`). Sentence case throughout, with no tracked-out capitals.
- **Shape:** small radii (2–22px), pill buttons, no gloss, 1.5px icon strokes.
- **Cards:** 4:5 photo on the well, no frame or lift.
- **Bands:** the hero, flash sale, promo banner and footer are ink; the brand story is cream.
- **Icons:** bare beside their text — the `--icon-chip-*` tokens drop the decorative circle the base design puts behind help, promise, sign-in and shipping icons.

## Layout preset `tahafi` (`apps/web/components/storefront/presets/tahafi/`)

Tahafi composes its own storefront (owner, 2026-10-31: "it should not look like Asif Zone"; approved mockup
https://claude.ai/artifact/5bbb2i9bNJXFoLzTmZTxHD). Every piece comes from the mark:

- **The canopy** (`canopy.tsx`): the bar of the mark as an edge between two grounds — the ink header hanging into the
  hero, the cream page dipping into the lookbook and the footer.
- **Twin diamonds**: settling into the hero's dip (the page's one moment of motion), above every page and section title
  (`--title-mark`), the open tab of the dock, the loader, colour swatches on cards.
- **The hang-tag**: the hero's featured piece, the product page's delivery dates and promises (`tag-card.tsx`), the
  placed order (`order-tag.tsx`).
- **App feel on phones, unlike Asif Zone's**: a header of just the logo, and a floating ink dock (Home, Shop, Search,
  Saved) with the bag apart in olive. The bag, menu and size picker rise as sheets (shared).
- **Catalogue, not tiles**: categories as a serif index; frameless product cards with the name in the serif.

What each file does: `presets/tahafi/README.md`. To add a Tahafi-only piece, branch on `storeLayout() === "tahafi"` at
the component switch (`store-chrome.tsx`, `product-card.tsx`, `home/home-section.tsx`, `brand-loader.tsx`) and put the
component in `presets/tahafi/`. Never branch on the brand name.

## Rules

- **Logo:** use the designer's files only (`source/logo-paths.json`, exported by `source/build.mjs`); never retype the wordmark or redraw the mark. Olive (preferred) or ink on cream; cream on ink or olive.
- **Icons:** lucide only, stroke 1.5, at 16, 20 or 24px. Put them inline next to their text, never inside decorative circles. No emoji.
- **No AI-template tells:** no fake counts ("10K+ customers"), no generic slogans, no identical 4-card icon grids, no gradients or glass, and no eyebrow label over every heading.
- **One job per section:** the same promise (COD, delivery, exchange) appears once.
- **Photography:** real shoots with one warm, slightly desaturated grade. The sample photos in `sample/` are cut from an AI design board and must be replaced before launch.
- **Copy:** English for now (owner, 2026-10-27). Bangla comes later through Anek Bangla and the existing `--font-bn` fallback.

## Brand files

The designer's outlines (`source/logo-paths.json`, cut from the master EPS by `source/extract-from-eps.mjs`), the generator `source/build.mjs` and the files it writes are described in [README.md](README.md).
