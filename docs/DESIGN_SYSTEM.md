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

**Layout presets.** Some differences are compositions, not values: where the logo sits, whether there is a bottom tab bar, how a product card arranges its actions. For those a theme names a structural preset (`layout` in its definition, `classic` by default), read with `storeLayout()` from `apps/web/lib/theme-layout.ts`. A few components ask for the preset (`StoreHeader`/`StoreFooter` in `components/storefront/store-chrome.tsx`, which every page shell uses; the tab bar; homepage sections; product card and rail headings; gallery thumbnails; the loading state), never for the brand, and render the preset's composition from `components/storefront/presets/<preset>/`. Preset components reuse the shared hooks and stores, so behaviour is identical in every preset. Import preset components statically: a `next/dynamic` chunk rendered on the server is blocked by the nonce CSP (`strict-dynamic`) and the component never hydrates. Everything else still changes only through tokens.

| Theme | Preset | Character |
|---|---|---|
| `default` | `classic` | Neutral editorial. True-neutral grays, Playfair titles, pill controls, the radius scale below. |
| `nasihamart` | `mihrab` | Night navy, ivory and sand; Instrument Sans in two widths (condensed headings, no serif); a pointed arch framing the photography; left-aligned catalogue layout, two-row header, light footer, no bottom tab bar. See `docs/brand/nasihamart/THEME_BLUEPRINT.md`. |
| `tahafi` | `tahafi` | Olive-black, cream and sand with olive actions and small brass marks; Instrument Serif titles over Geist; 4:5 frameless product cards; the hero's small line hangs on a brass-threaded hang-tag over the photograph. See `docs/brand/tahafi/THEME_BLUEPRINT.md`. |

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
| hero CTA, cart line items | `--hero-cta-fill/-text`*, `--line-item-radius`, `--stepper-radius` | |
| `.ui-tile-caption`, `rounded-[var(--tile-media-radius)]` | `--tile-caption-position` (`absolute` over the photo / `static` below it), `--tile-caption-padding`, `--tile-media-radius` | category tile caption and photo |
| `.ui-hero`, `.ui-hero-layout`, `.ui-hero-copy`, `.ui-hero-media`, `.ui-hero-media-frame`, `.ui-hero-secondary` | `--hero-align`, `--hero-layout-lg` (`block` stacked / `grid` copy beside image), `--hero-media-aspect-lg`, `--hero-content-max-w-lg`, `--hero-copy-pad-lg`, `--hero-media-offset-lg`, `--hero-secondary-ring`, `--hero-primary-mr`, `--hero-secondary-ml` | the homepage hero composition |
| `rounded-[var(--control-radius)]` | `--control-radius` | buttons (`buttonVariants`) and call-to-action links — a pill by default |
| `hover:bg-[color:var(--accent-hover)]`, nav links | `--accent-hover`, `--nav-hover`, `--nav-underline` | primary-action hover fill; navigation hover color and underline |
| `svg.lucide[stroke-width="2"]` (base layer) | `--icon-stroke` | icon line weight (icons given their own width keep it) |
| `.ui-section-frame[data-spacing], [data-background], [data-show]` | `--section-rhythm-base` (the theme's `--section-rhythm`) | a homepage section's own spacing (×0.6 / ×1.45), tinted background (`surface-muted`) and computer- or phone-only display — set in the Storefront Studio, rendered by `SectionFrame` |
| `.ui-band-inverse[data-tone]` | ui-tokens `toneVariables` per theme | a dark band the store forced light or dark for one section (contrast-tested in `theme-tokens.test.ts`) |
| `text-[color:var(--band-accent,…)]` | `--band-accent`* | eyebrows, rules and link hovers inside `.ui-band-inverse` sections (each call site keeps its own default) |

\* Opt-in: undefined in the base design, so the property inherits as it did before the token existed. A theme may set it.

**Inverse bands.** `.ui-band-inverse` marks a section designed on the dark palette, and `data-band` names it: `hero`, `story` (brand story), `flash`, `promo` (the text-only promo banner) and `footer`. A theme renders sections light by mirroring the palette inside them (ink-950 becomes the light surface, ink-300 becomes ink-700, cream becomes dark ink, and so on), so every pairing keeps its contrast: `band: "light"` mirrors every band, `lightBands: ["hero", "story"]` only the named ones (`bandSurface` picks the light surface). Tokens whose colour must resolve against a light band's palette go in `bandComponents`; palette steps re-valued inside the bands that stay dark go in `darkBandPalette`. Artwork made for one background (logos) uses `.ui-art-on-dark` / `.ui-art-on-light`, and the band shows the right one.

**Store design choices (Storefront Studio → Site design).** On top of its brand theme a store may choose a brand colour, heading and text fonts (only the faces the root layout already loads), a corner style, the section rhythm and whether dark bands render dark or light. These are stored on `StoreSetting.storefrontDesign` (schema: `storefrontDesignSchema`, packages/shared `storefront-design.ts`) and turned into token re-values by `designCss()` (apps/web/lib/design-css.ts), emitted in `<style id="storefront-design">` after the theme's stylesheet under the same `:root[data-brand]` selectors. Each choice is a complete set (a corner style is the whole radius scale plus control radii), the accent's text colour is computed for contrast, and admin surfaces are unaffected (they re-declare their own tokens). The same design holds the announcement bar (`AnnouncementBar`), extra header menu links (`withMenuLinks` / `navHref`, lib/nav-links.ts) and the footer's about text, extra column and newsletter toggle.

**After editing `packages/ui-tokens`,** delete `apps/web/.next` and restart `next dev`. The dev cache does not notice changes to the workspace package that `tailwind.config.ts` imports.

**Proving a refactor didn't change a store:** screenshot the storefront before and after with `STORE_THEME=default` against the same data, then pixel-diff. The base design is deterministic, so two runs with no change differ by 0 pixels.

- **Palette scales:** `ink` (neutral 50–950), `cream` (surfaces), `sale` (promo labels only), and the semantic statuses `success`, `warning`, `danger`, `info`. `brass` is a legacy alias of `ink`; don't use it in new code.
- **Grey text steps clear WCAG AA.** `ink-500` is secondary text, `ink-400` tertiary text (meta, hints, struck prices): #707070, ≥ 4.5:1 on every light surface. Neither is a fill behind dark text (use `accent`, `surface` or a status colour). Inside the base design's dark sections (`.ui-band-inverse`) the same steps are re-valued light (`inverseBandVariables` in ui-tokens: ink-400 #b3b3b3, ink-500 #8a8a8a), so `text-ink-400` stays legible on the footer and other dark bands. `apps/api/src/config/theme-tokens.test.ts` enforces both.
- **Text floor:** 12px (`text-xs`) for words; 11px only for compact numeric or promo badges (`CountBadge`, `PromoBadge`).
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
| Storefront motion & layout | `Reveal` (scroll-driven CSS reveal, `index` staggers; no JS, off under reduced motion), `ProductCarousel` (the one product rail: snap row, 4 per desktop row, arrows, "View all"), `HeaderShell` (scroll-aware header; publishes `--sticky-top` for anything pinned under it), `categoryTileLayout` in `lib/category-tile-layout.ts` (bento spans, one cell per category) |
| Product page | `DeliveryEstimate` (the checkout's own estimate and the store's delivery fee, inside/outside Dhaka), `ShareButton` (share sheet or copy link), `WhatsAppOrderButton` (prefilled order message, `lib/whatsapp.ts`), usual-size hint (`lib/size-memory.ts`: a dot on the pill, never pre-selected), `ReviewPhotoPicker` / `ReviewPhotoStrip` |
| Page frame | `StorefrontPage`, `StorefrontPageHeader` (components/storefront/storefront-page.tsx), `HelpAside`, `NotFoundContent`, `NavigationProgress` |
| Returning shoppers | `BuyAgainRail` (signed-in, delivered products in stock), cart "Complete your order" rail (`lib/cart-suggestions.ts`: bundle products, then frequently bought together), `InstallAppCard` + `AppShellWorker` (home-screen install, offline page; the service worker caches only the offline page) |
| Homepage | `HomeSection` + `SectionFrame` (components/storefront/home/): the one renderer for a homepage section, used by the live page and the Storefront Studio preview; sections `RichTextSection`, `TestimonialsSection` (approved reviews only), `NewsletterSection`, `ImageGallerySection`. Data helpers in `lib/homepage-data.ts`. Import sections statically (the preview is a client tree; `next/dynamic` chunks are blocked by the CSP). |
| Storefront Studio | `/admin/homepage` (components/admin/studio/): draft + publish (`lib/studio/use-studio-draft.ts`), iframe preview at real device widths (`lib/studio/preview-protocol.ts`), inspector fields declared per section type in `section-fields.ts`, page checks from `studioHealthChecks` (@clothing-brand/shared) |
| Storefront counts | `components/storefront/count-badge.tsx` — `CountBadge` (the bag-icon bubble) and `bagLabel()` for the control's accessible name |

**Page metadata.** Every route has a title. A server page sets it in `generateMetadata`; a client page gets a sibling `layout.tsx` that exports it. Pages that belong to one shopper (cart, checkout, wishlist, order status, payment, account, sign-in) use `privatePageMetadata(title)` from `lib/seo.ts` (titled, `noindex`, no canonical). A stored SEO title goes through `storeTitle(title, storeName)` so the store name isn't appended twice. The root layout sets no canonical: indexable pages set their own.

`components/admin/{page-header,empty-state,pagination,table-skeleton,form-section,sub-nav}` and `components/account/account-empty-state` are thin re-exports or wrappers of the above, kept so existing imports don't change.

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
7. **Reserve space for what arrives late.** The storefront `<main>` is at least a viewport tall, so streamed sections and client-hydrated pages never push the footer through the viewport (layout shift). Fixed bottom bars carry `data-hide-on-keyboard` so they step aside while a shopper types.
8. **Motion is transform and opacity only, and CSS first.** Section and card entrances use `Reveal` (`animation-timeline: view()`), never JavaScript scroll listeners; hover and press feedback are CSS transitions. Anything that moves collapses to static under `prefers-reduced-motion`.
9. **Every storefront and account page uses one frame and one heading.** `StorefrontPage` (`.ui-page`: max-width 80rem, gutters 1rem / 1.5rem / 2rem, the same top gap below the header) and `StorefrontPageHeader` (breadcrumb or eyebrow row of fixed height, then the `<h1>` in `.ui-page-title`, an optional description and actions). Content inside may be narrower, but starts at the frame's left edge — no centred one-off columns, no page-specific title sizes. Sign-in pages and the account sit inside the same storefront shell (header, footer, bag, bottom nav). The product page is the one exception to the heading (its title is the product, `.ui-product-title`), not to the frame.
10. **No loading screens between pages.** There are no route `loading.tsx` files: the current page stays until the next is ready, and `NavigationProgress` draws a thin line only when that takes over 0.2s. Placeholders that remain (`.ui-skeleton`, `.ui-delayed`) stay invisible for their first 0.3s, so a fast response never shows a loading state. Data a page will need is prefetched where the next step is predictable (the account prefetches every section's data when it opens).

## 6. Admin patterns (blueprint P2.1, tab 6)

The admin is Apple-calm and light only. These patterns sit on the tokens, recipes and primitives above — never one-off
styles.

**Principles.** One primary action per page, top right; the rest secondary or under "More". Plain business words — a
title says what the page is for in two or three words. Every status shows its next step. Money is exact, with a source
label when estimated. Advanced fields behind "More options", owner-only tools behind "More". Avoid KPI tiles that repeat
another page, cards around a single table, gradients and glass in the admin, decorative icons, two buttons that do the
same thing.

**Page anatomy** — five rows, always in this order: shell (sidebar from the navigation manifest, top bar with search
Ctrl/⌘ K, Create, bell, account) → header (`PageHeader`: title, one-line description, primary action; back link on record
pages) → section bar (a section's pages as tabs when 2–6, an inner list when more) → filter row (search left, chips,
saved views, date range right) → body (table, record or form). Lists full width; forms at most 720 px; record pages
2/3 + 1/3.

| Pattern | Rules | Built from |
|---|---|---|
| List | First column identity, then status, then 3–5 decision columns; money right-aligned; row opens the record; bulk bar on selection; cards below the breakpoint | `DataTable` |
| Record page | Status and primary next action in the header; side column for links, totals, timeline | `PageHeader`, `Card` |
| Form | Titled sections, required first, inline validation, sticky save bar, discard guard | `Field`, form sections |
| Quick sheet (Received goods, Fill, Count) | Drawer on desktop, full screen on phone; one task; preview before Save | `Drawer` |
| Confirm dialog | Title = action + object; body lists the consequences the server will apply; destructive button right | `Modal` / confirm |
| Status change | Only legal next states; reason inline when required; toast with Undo when reversible | shared state machine |
| Queue item (Home) | Severity bar, title, one-line why, count or amount, next action link; it clears only when resolved | `QueueItem` (`components/admin/queue-item.tsx`, `data-testid="action-<key>"`) |
| Money | `Money` / `CostAmount`; estimates carry the estimate token and label | `--data-estimate-*`, `--data-missing-*` |

**Words.** Sentence case; verbs on buttons ("Receive return", not "Submit"); the owner's nouns (bottles, parcel, bill,
production run), not system words (GRN, BOM, settlement); one name per thing across menu, title, button and toast.

**States.** Loading: a skeleton in the content's shape, previous data kept while refetching. Empty: why, and the one
action that fills it; filtered-empty offers Clear filters. Error: a plain sentence, what to do, Retry, the server's reason
— never a raw code. Success: a toast naming the result. Estimated or incomplete: a badge on the number and a line saying
what is missing, linking to the fix. Permission: hidden in navigation; reached by link, `PermissionState`.

**Phone.** Bottom bar Home, Orders, Inbox, Stock, More; lists become cards; quick sheets full screen with a large Save;
tables over four columns get a column picker, never a horizontal page scroll; touch targets at least 44 px. Every page
works at 375 px.
