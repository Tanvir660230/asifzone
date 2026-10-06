# Design System

The shared visual foundation for the storefront, customer account, and admin. Feature work (Product Builder, Checkout, Orders, CRM, Dashboard…) builds on this. Do not restyle the same pattern locally.

## 1. Where things live (one source of truth each)

| Layer | Location | Owns |
|---|---|---|
| Tokens | `packages/ui-tokens/src/index.js` | palette, semantic roles, type roles, radii, shadows, z-index, motion |
| Tailwind wiring | `apps/web/tailwind.config.ts` | maps tokens into `theme.extend` and injects CSS variables at `:root`; no values of its own |
| CSS recipes | `apps/web/app/globals.css` (`@layer components`) | `.glass`, `.glass-panel`, `.ui-overlay`, `.ui-control`, `.ui-select`, `.ui-label`, `.ui-field-hint`, `.ui-field-error`, `.ui-table*`, `.ui-floating`, `.ui-menu-item`, `.ui-skeleton`, `.glossy`, reduced motion |
| Motion (JS) | `apps/web/lib/motion.ts` | Framer Motion `durations`, `easings`, `transitions`, `variants` (same values as the CSS side) |
| Primitives | `apps/web/components/ui/*` | React components that apply the recipes |

## 2. Tokens

**Colors are CSS variables.** Utilities such as `bg-ink-900` and `text-cream-50/75` resolve to `rgb(var(--color-ink-900) / <alpha>)`. A brand can re-theme at runtime by overriding variables, with no rebuild and no class changes:

```css
:root[data-brand="northwind"] {
  --color-ink-900: 20 24 38;   /* RGB channels */
  --color-accent: var(--color-ink-900);
}
```

**Brand themes.** Themes are defined once, in `themeDefinitions` in `packages/ui-tokens/src/index.js`. A theme only re-values tokens: palette steps, radii (`--radius-*`), typography variables and component tokens (§2a). It never adds styling of its own. The Tailwind plugin emits a theme's overrides under `:root[data-brand="<id>"]`. An installation chooses its theme at runtime with `STORE_THEME` (`apps/web/lib/theme.ts`), and the root layout sets `<html data-brand>`. An unknown id falls back to `default`. Components never branch on the theme. If a brand needs a component to look different, add a token for that difference, with a default that reproduces the base design exactly, instead of adding a conditional. `apps/api/src/config/theme-tokens.test.ts` enforces this and checks each theme's text contrast.

| Theme | Character |
|---|---|
| `default` | Neutral editorial. True-neutral grays, Playfair titles, the radius scale below. |
| `nasihamart` | Warm minimal. Warm off-white canvas, warm near-black text, sans semibold titles with tight tracking, sentence-case labels, flat (gloss-free) controls, frameless image-first product cards, softer and larger radii, and light inverse bands. |

### 2a. Component tokens and recipes

Presentation that differs between brands is a CSS variable in `componentTokens` (ui-tokens), read by a recipe in `globals.css` or an arbitrary utility. Use the recipe; don't re-spell its utilities.

| Recipe / utility | Tokens | Use |
|---|---|---|
| `.font-display` | `--font-display-family`, `--font-display-weight`*, `--font-display-tracking`* | every title |
| `.font-sans` | `--font-body-family` | body text |
| `.ui-caps` | `--caps-transform`, `--caps-spread` | small labels (`SOLD OUT`, `QTY`, accordion/filter headings). Other spacings: `ui-caps tracking-[calc(0.2em*var(--caps-spread))]` |
| `.ui-eyebrow` | `--eyebrow-transform`, `--eyebrow-spread` (default: the caps values), `--eyebrow-weight`* | the kicker above a section title |
| `.ui-section-title` / `.ui-section-heading` | `--section-title-*`, `--section-heading-*` | product rails / homepage section headings |
| `.ui-product-title` | `--product-title-family/-size/-leading/-weight/-tracking` | the product page `<h1>` (its face is the title face by default; a theme may set product data in the UI face) |
| `.ui-card-frame`, `hover:translate-y-[var(--card-lift)]`, `scale-[var(--card-image-zoom)]` | `--card-*` | product card image frame, lift, zoom, tier line, title tracking |
| `.ui-panel` | `--panel-border`, `--panel-shadow` | content tiles (values grid) |
| `.ui-header-bar` | `--header-shadow` | the sticky header's edge |
| `.glossy`, `.glass` | `--gloss` (0 = flat), `--glass-alpha` | filled controls, translucent chrome |
| `PromoBadge tone="note"` | `--badge-note-bg/-fg` | non-promotional badges ("New Arrival"). `tone="sale"` is always the sale accent. |
| category tiles, hero CTA, cart line items | `--tile-scrim/-label`, `--hero-cta-fill/-text`*, `--line-item-radius`, `--stepper-radius` | |
| `.ui-tile-caption`, `rounded-[var(--tile-media-radius)]` | `--tile-caption-position` (`absolute` over the photo / `static` below it), `--tile-caption-padding`, `--tile-media-radius` | category tile caption and photo |
| `.ui-hero`, `.ui-hero-layout`, `.ui-hero-copy`, `.ui-hero-media`, `.ui-hero-media-frame`, `.ui-hero-secondary` | `--hero-align`, `--hero-layout-lg` (`block` stacked / `grid` copy beside image), `--hero-media-aspect-lg`, `--hero-content-max-w-lg`, `--hero-copy-pad-lg`, `--hero-media-offset-lg`, `--hero-secondary-ring`, `--hero-primary-mr`, `--hero-secondary-ml` | the homepage hero composition |
| `rounded-[var(--control-radius)]` | `--control-radius` | buttons (`buttonVariants`) and call-to-action links — a pill by default |
| `hover:bg-[color:var(--accent-hover)]`, nav links | `--accent-hover`, `--nav-hover`, `--nav-underline` | primary-action hover fill; navigation hover color and underline |
| `svg.lucide[stroke-width="2"]` (base layer) | `--icon-stroke` | icon line weight (icons given their own width keep it) |
| brand story image | `--story-media-max-w`, `--story-media-h-sm` | a small vignette or a large editorial photograph |
| `text-[color:var(--band-accent,…)]` | `--band-accent`* | eyebrows, rules and link hovers inside `.ui-band-inverse` sections (each call site keeps its own default) |

\* Opt-in: undefined in the base design, so the property inherits as it did before the token existed. A theme may set it.

**Inverse bands.** `.ui-band-inverse` marks a section designed on the dark palette, and `data-band` names it: `hero`, `story` (brand story), `flash`, `promo` (the text-only promo banner) and `footer`. A theme renders sections light by mirroring the palette inside them (ink-950 becomes the light surface, ink-300 becomes ink-700, cream becomes dark ink, and so on), so every pairing keeps its contrast: `band: "light"` mirrors every band, `lightBands: ["hero", "story"]` only the named ones (`bandSurface` picks the light surface). Tokens whose colour must resolve against a light band's palette go in `bandComponents`; palette steps re-valued inside the bands that stay dark go in `darkBandPalette`. Artwork made for one background (logos) uses `.ui-art-on-dark` / `.ui-art-on-light`, and the band shows the right one.

**After editing `packages/ui-tokens`,** delete `apps/web/.next` and restart `next dev`. The dev cache does not notice changes to the workspace package that `tailwind.config.ts` imports.

**Proving a refactor didn't change a store:** screenshot the storefront before and after with `STORE_THEME=default` against the same data, then pixel-diff. The base design is deterministic, so two runs with no change differ by 0 pixels.

- **Palette scales:** `ink` (neutral 50–950), `cream` (surfaces), `sale` (promo labels only), and the semantic statuses `success`, `warning`, `danger`, `info`. `brass` is a legacy alias of `ink`; don't use it in new code.
- **Semantic roles:** prefer these in new code, because they describe intent.

| Role | Use | Role | Use |
|---|---|---|---|
| `canvas` | page background | `fg` | primary text |
| `surface` | cards, panels, inputs | `fg-muted` | secondary text |
| `surface-muted` | wells, table headers | `fg-subtle` | tertiary / placeholders |
| `surface-inverse` | dark chrome | `accent` / `accent-fg` | primary actions, active, focus |
| `line-subtle` / `line` / `line-strong` | borders | | |

- **Type:** `font-sans` (Inter), `font-display` for titles (Playfair by default; a theme may swap it via `--font-display-family`). Named sizes: `text-display-sm|md|lg|xl`, `text-caption`.
- **Radii** (CSS variables `--radius-*`, re-themable): `sm 4` · `DEFAULT 8` · `md 10` · `lg 14` · `xl 20` · `2xl 24` · `3xl 32`.
- **Shadows:** `sm`, `DEFAULT`, `lg`, `float`, `floatLg`, `glass`, `glass-lg`, `inset`, `glow`.
- **Layers:** `z-raised 10`, `z-sticky 20`, `z-dock 40` (fixed bottom bars), `z-overlay 50` (dialogs, drawers, popovers), `z-toast 200`.
- **Motion:** `duration-instant|fast|base|slow|slower` (100/150/220/320/480ms) and `ease-smooth|standard|exit`.

## 3. Glass, used selectively

- **Glass:** chrome that floats above content. That means sticky headers (`.glass`), menus/popovers/comboboxes (`.ui-floating`), toasts and bulk bars (`.glass-panel`), and the backdrop behind dialogs (`.ui-overlay`).
- **Solid:** content. Cards, tables, forms and dialog bodies stay solid (`bg-surface`) so text contrast never depends on what's behind them.
- **Fallback:** browsers without `backdrop-filter` get opaque surfaces automatically.

## 4. Components (`components/ui`)

| Need | Use |
|---|---|
| Action | `Button` (`primary`, `secondary`, `outline`, `ghost`, `glass`, `destructive`, `sale`, `link`; sizes `sm`/`md`/`lg`/`icon-sm`/`icon`; `loading`). Links styled as buttons use `buttonVariants()`. |
| Icon-only action | `IconButton` (`aria-label` required) |
| Busy indicator | `Spinner` |
| Form field | `Field` (label + control + hint + error, wires `aria-describedby`/`aria-invalid`); `Label` (`required`); `FieldError` |
| Controls | `Input`, `Textarea`, `Select` (native), `SearchableSelect`, `IconPicker`, `Checkbox`, `Switch`, `SearchInput` |
| Layout | `PageHeader` (`size="lg"` page / `"md"` sub-page), `FormSection`, `Card` (+Header/Title/Description/Content/Footer; `variant`, `interactive`) |
| Navigation | `NavTabs` (route tabs; `scrollable`), `SegmentedControl` (in-place view switch), `Breadcrumb`, `BackLink`, `Pagination` / `paginationItemVariants` |
| Data | `TableContainer`, `Table`, `TableHead`, `TableHeaderCell`, `TableRow` (`interactive`), `TableCell` (`align`), `TableMessageRow`, `TableSkeleton`, `BulkActionBar`, `HScrollShadow` |
| Status | `Badge` (meaning-based variants, `dot`), `Alert` (inline, persistent), `toast.success/error/info/warning` (transient) |
| Overlays | `Modal` (`description`, `footer`), `Drawer` (prev/next stepping), `Popover`, `DropdownMenu`, `Tooltip`, `useConfirmDialog` |
| States | `Skeleton` / `SkeletonText`, `EmptyState` (`plain` / `bordered`, `tone`), `ErrorState` (`onRetry`) |

`components/admin/{page-header,empty-state,pagination,table-skeleton,form-section,sub-nav}` and `components/account/{account-page-header,account-empty-state}` are thin re-exports or wrappers of the above, kept so existing imports don't change.

## 5. Rules

1. **No raw recipe strings.** If you're writing a border+bg+focus string for a field, a table head, or a menu item, use the primitive (or its `ui-*` class).
2. **Status by meaning.** `Badge variant="success"` or `approvalStatusBadgeVariant()`, never ad-hoc color pairs. Order and courier status colors stay centralized in `lib/format.ts`.
3. **Motion explains something.** Entering/leaving layers, feedback, hierarchy. Use `lib/motion.ts` presets or `duration-*`/`ease-*` utilities. Reduced motion is handled globally (CSS media query + `<MotionConfig reducedMotion="user">`).
4. **Accessibility is part of the primitive.**
   - Every focusable element shows a ring (controls a soft `ring-accent/10`, everything else the global outline).
   - Dialogs trap focus and close on Escape.
   - `IconButton` requires a name.
   - `Field` links its errors to the control.
5. **Responsive by variant, not by duplication.** One component, responsive classes inside it.
6. **Brand-neutral.** No brand names, colors or copy in primitives. Brand differences belong in token overrides.
