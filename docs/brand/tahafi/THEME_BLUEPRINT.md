# Tahafi theme blueprint

Modern modest menswear: jackets, overshirts, panjabi and caps for campus, work and Jummah. The look is quiet and confident. The clothes and the photography carry it; the interface stays out of the way.

Everything comes from the logo (the designer's master, 2026-10-28): its four colours, and its mark (twin diamonds over a curved bar, on two sweeping legs).

## Tokens (`packages/ui-tokens`, `themeDefinitions.tahafi`)

Only the logo's four colours, plus tints of them. No brass, no red.

| Role | Value | Notes |
|---|---|---|
| Brand ground: hero, top strip, footer, flash sale, promo bands | olive `#4F5343` (`ink-950`) | cream on it 6.9:1 |
| Actions (`accent` role) | olive `#4F5343`, hover ink `#1C1C1A` | the role is re-valued, not a palette step, so text stays ink |
| Text, headings | ink `#1C1C1A` (`ink-900`) | 14.9:1 on cream |
| Page | cream `#F2EFEA` (`cream-100`) | |
| Cards, inputs | `#FAF8F5` (`cream-50`) | |
| Wells behind photos | sage-washed cream `#E4E2DC` (`cream-200`) | |
| Threads, quiet marks | sage `#84857E` | 3.3:1 on cream, so never text; hints use the darker `#64655E` (`ink-400`, 5.1:1) |
| Promotions (`sale`) | an ink tag with white type, ink sale price | like a tailor's tag; the logo has no red |
| Secondary text on olive | `#E4E1DA` / `#D6D4CB` / `#CBCABF` (`ink-300/400/500` inside dark bands) | 6.1 / 5.3 / 4.8:1 |

Contrast is enforced by `apps/api/src/config/theme-tokens.test.ts` (every text step on cream, the well, olive and inside the bands).

- **Type:** Instrument Serif for every title (closest to the wordmark's serif), at weight 400 and set large (it is narrow and light); Geist for everything else. Both load only on this store (`next/font`, `preload: false`). Sentence case throughout, with no tracked-out capitals.
- **Shape:** small radii (2–22px), pill buttons, no gloss, 1.5px icon strokes.
- **Cards:** 4:5 photo on the well, no frame or lift.
- **Bands:** the hero, flash sale, promo banner and footer are olive, like the logo's own ground; the brand story is cream.

## Layout preset `tahafi` (`apps/web/components/storefront/presets/tahafi/`)

Tahafi composes most sections the classic way and adds its own pieces, each taken from the mark:

- **Canopy hero** (`hero.tsx`, `twin-diamonds.tsx`, `.ui-canopy` in globals.css). On the olive hero the photograph's top edge dips like the bar of the mark, a tenth of its width deep at any size, and the twin diamonds sit in the dip. This is the brand's one loud moment; keep everything else calm.
- **Hang-tag** (`hang-tag.tsx`). The hero's small line, "name | detail | price", hangs on a sage thread over the photograph instead of sitting above the headline, and links to the hero's button target.
- **Twin diamonds** above every section title (the `--title-mark` token) and as the loading state (`loader.tsx`): the two diamonds take turns.
- **Header** (`header.tsx`): the classic header with the horizontal logo, under an olive strip of the store's own delivery promises.

To add a Tahafi-only piece, branch on `storeLayout() === "tahafi"` at the component switch (see `store-chrome.tsx`, `brand-loader.tsx`, `product-card.tsx`, `home/home-section.tsx`) and put the component in `presets/tahafi/`. Never branch on the brand name.

## Rules

- **Logo:** use the designer's files only (`source/logo-paths.json`, exported by `source/build.mjs`); never retype the wordmark or redraw the mark. Olive or ink on cream, cream on olive or ink.
- **Icons:** lucide only, stroke 1.5, at 16, 20 or 24px. Put them inline next to their text, never inside decorative circles. No emoji.
- **No AI-template tells:** no fake counts ("10K+ customers"), no generic slogans, no identical 4-card icon grids, no gradients or glass, and no eyebrow label over every heading.
- **One job per section:** the same promise (COD, delivery, exchange) appears once.
- **Photography:** real shoots with one warm, slightly desaturated grade. The sample photos in `sample/` are cut from an AI design board and must be replaced before launch.
- **Copy:** English for now (owner, 2026-10-27). Bangla comes later through Anek Bangla and the existing `--font-bn` fallback.

## Brand files

The designer's outlines (`source/logo-paths.json`, cut from the master EPS by `source/extract-from-eps.mjs`), the generator `source/build.mjs` and the files it writes are described in [README.md](README.md).
