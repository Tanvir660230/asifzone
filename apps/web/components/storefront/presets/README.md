# Storefront layout presets

A brand theme has two halves. **Tokens** (packages/ui-tokens `themeDefinitions`) change what things look like. A **preset** (the theme's `layout`) changes how a few chrome components are composed. Components ask `storeLayout()` (lib/theme-layout.ts) for the preset, never for the brand, so any installation may pick any preset.

| Preset | Store | What it replaces |
|---|---|---|
| `classic` | Asif Zone (base design) | — |
| `mihrab` | Nasihamart | header, footer, product card, loader, hero, trust row, carousels, category arches, flash sale |
| `tahafi` | Tahafi | header (olive promise strip), hero (canopy frame, twin diamonds, hang-tag), loader; section-title diamonds via `--title-mark`; everything else is `classic` re-valued by tokens |

## Adding a preset

1. Add its id to `StoreLayout` and `LAYOUTS` in `apps/web/lib/theme-layout.ts`, and set `layout` on the theme in ui-tokens.
2. Put its components in `presets/<id>/`. Wrap the classic component where you can (Tahafi's hero passes `mediaOverlay` to the classic `Hero`) instead of copying it.
3. Branch at the existing switch points: `store-chrome.tsx` (header and footer), `product-card.tsx`, `brand-loader.tsx`, and `home/home-section.tsx` (homepage sections).
4. In the Studio, `components/admin/studio/section-fields.ts`: a field restricted with `presets: [...]` must list every preset that renders it. A preset that composes a section the classic way needs `classic` fields too.
5. Keep the other stores pixel-identical. Default values of any new token reproduce the base design.
6. Check both themes at 1440px and 375px.
