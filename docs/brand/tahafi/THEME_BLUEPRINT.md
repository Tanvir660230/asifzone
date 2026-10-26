# Tahafi theme blueprint

Modern modest menswear: jackets, overshirts, panjabi and caps for campus, work and Jummah. The look is quiet and confident. The clothes and the photography carry it; the interface stays out of the way.

## Tokens (`packages/ui-tokens`, `themeDefinitions.tahafi`)

| Role | Value | Notes |
|---|---|---|
| Page | cream `#F4F0E8` (`cream-100`) | |
| Cards, inputs | `#FBF9F5` (`cream-50`) | |
| Wells behind photos | sand `#E9E2D2` (`cream-200`) | |
| Text, dark sections, footer | olive-black `#1E211B` (`ink-900`/`ink-950`) | 14.6:1 on cream |
| Actions (`accent` role) | olive `#3E4A33`, hover `#303A27` | the role is re-valued, not a palette step, so text stays olive-black |
| Small marks | brass `#A8843C` | nav underline, the "New" badge, the hang-tag thread. Never text on cream |
| Promotions (`sale`) | terracotta `#B4492F` | |

Contrast is enforced by `apps/api/src/config/theme-tokens.test.ts` (every text step on cream, sand, olive and inside the bands).

- **Type:** Instrument Serif for every title, at weight 400 and set large (it is narrow and light); Geist for everything else. Both load only on this store (`next/font`, `preload: false`). Sentence case throughout, with no tracked-out capitals.
- **Shape:** small radii (2–14px), pill buttons, no gloss, 1.5px icon strokes.
- **Cards:** 4:5 photo on the sand well, no frame or lift.
- **Bands:** the hero and brand story are light (cream); flash sale, promo banner and footer are olive-black.

## Layout preset `tahafi` (`apps/web/components/storefront/presets/tahafi/`)

Tahafi composes most sections the classic way and adds its own pieces:

- **Hang-tag hero** (`hero.tsx`, `hang-tag.tsx`). The hero's small line, "name | detail | price", hangs on a brass thread over the photograph instead of sitting above the headline as an eyebrow, and it links to the hero's button target. This is the brand's one loud moment; keep everything else calm.

To add a Tahafi-only piece, branch on `storeLayout() === "tahafi"` at the component switch (see `store-chrome.tsx`, `product-card.tsx`, `home/home-section.tsx`) and put the component in `presets/tahafi/`. Never branch on the brand name.

## Rules

- **Icons:** lucide only, stroke 1.5, at 16, 20 or 24px. Put them inline next to their text, never inside decorative circles. No emoji.
- **No AI-template tells:** no fake counts ("10K+ customers"), no generic slogans, no identical 4-card icon grids, no gradients or glass, and no eyebrow label over every heading.
- **One job per section:** the same promise (COD, delivery, exchange) appears once.
- **Photography:** real shoots with one warm, slightly desaturated grade. The sample photos in `sample/` are cut from an AI design board and must be replaced before launch.
- **Copy:** English for now (owner, 2026-10-27). Bangla comes later through Anek Bangla and the existing `--font-bn` fallback.

## Brand files

The generator `source/build.mjs` (vector SVG with outlined glyphs, plus PNG exports) and the files themselves are described in [README.md](README.md).
