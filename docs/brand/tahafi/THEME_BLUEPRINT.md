# Tahafi theme blueprint

Modern modest menswear: jackets, overshirts, panjabi and caps for campus, work and Jummah. The look is quiet and confident. The clothes and the photography carry it; the interface stays out of the way.

Everything comes from the logo (the designer's master, 2026-10-28): its four colours, and its mark (twin diamonds over a curved bar, on two sweeping legs).

## Look (owner, 2026-10-31)

The feel of a new iPhone: light, clear, glossy, never busy. Option A ("light glass") of the mockup
https://claude.ai/artifact/5bbb2i9bNJXFoLzTmZTxHD. Two earlier directions were tried and set aside — olive-led, then an
ink "canopy / hang-tag" catalogue — because the colours fought the photographs and too many marks made pages hard to read.

## Tokens (`packages/ui-tokens`, `themeDefinitions.tahafi`)

| Role | Value | Notes |
|---|---|---|
| Page | `#F4F4F2` (`cream-100`) | |
| Cards, the photo stage, inputs | white (`cream-50`) | soft depth (`--panel-shadow`, `--card-frame-shadow`), radius 22px |
| Secondary grounds (footer, light bands) | `#EBEBE8` (`cream-200`) | every band renders light (`band: "light"`) |
| Text, primary actions | ink `#1C1C1A` | actions glossy (`--gloss: 1`), pill shaped |
| The one accent | the logo's olive `#4F5343` (`sale`) | links, the bag count, sale tags, icon tiles on `#EEF0E8` |
| Glass | `.glass` / `.glass-panel` (globals.css) | the header, the dock, controls floating on photographs |

**Dark mode** (option B, `tahafi.dark`): page `#0F0F0E`, cards `#1C1C1A`, text `#F4F4F2`, light glossy actions, the
olive tag stays and olive text turns light `#C3CBA8`. It follows the shopper's device unless they choose Light or Dark
(header button; Auto returns to the device). Storefront only — the admin is always light.

Type: Geist throughout, titles at 650 with tight tracking. Contrast is enforced by
`apps/api/src/config/theme-tokens.test.ts`.

## Layout preset `tahafi` (`apps/web/components/storefront/presets/tahafi/`)

What each piece does: `presets/tahafi/README.md`. To add a Tahafi-only piece, branch on `storeLayout() === "tahafi"` at the
component switch (`store-chrome.tsx`, `product-card.tsx`, `home/home-section.tsx`, `brand-loader.tsx`) and put the component
in `presets/tahafi/`. Never branch on the brand name.

## Rules

- **Logo:** use the designer's files only (`source/logo-paths.json`, exported by `source/build.mjs`); never retype the wordmark or redraw the mark. Olive (preferred) or ink on cream; cream on ink or olive.
- **Icons:** lucide only, stroke 1.5, at 16, 20 or 24px. Put them inline next to their text, never inside decorative circles. No emoji.
- **No AI-template tells:** no fake counts ("10K+ customers"), no generic slogans, no identical 4-card icon grids, no gradients or glass, and no eyebrow label over every heading.
- **One job per section:** the same promise (COD, delivery, exchange) appears once.
- **Photography:** real shoots, every product on the same plain white or light-grey background, one light grade — the white cards depend on it. The sample photos in `sample/` are cut from an AI design board and must be replaced before launch.
- **Copy:** English for now (owner, 2026-10-27). Bangla comes later through Anek Bangla and the existing `--font-bn` fallback.

## Brand files

The designer's outlines (`source/logo-paths.json`, cut from the master EPS by `source/extract-from-eps.mjs`), the generator `source/build.mjs` and the files it writes are described in [README.md](README.md).
