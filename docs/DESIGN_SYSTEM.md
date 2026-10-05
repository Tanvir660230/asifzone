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
[data-brand="northwind"] {
  --color-ink-900: 20 24 38;   /* RGB channels */
  --color-accent: var(--color-ink-900);
}
```

- **Palette scales:** `ink` (neutral 50–950), `cream` (surfaces), `sale` (promo labels only), and the semantic statuses `success`, `warning`, `danger`, `info`. `brass` is a legacy alias of `ink`; don't use it in new code.
- **Semantic roles:** prefer these in new code, because they describe intent.

| Role | Use | Role | Use |
|---|---|---|---|
| `canvas` | page background | `fg` | primary text |
| `surface` | cards, panels, inputs | `fg-muted` | secondary text |
| `surface-muted` | wells, table headers | `fg-subtle` | tertiary / placeholders |
| `surface-inverse` | dark chrome | `accent` / `accent-fg` | primary actions, active, focus |
| `line-subtle` / `line` / `line-strong` | borders | | |

- **Type:** `font-sans` (Inter), `font-display` (Playfair) for titles. Named sizes: `text-display-sm|md|lg|xl`, `text-caption`.
- **Radii:** `sm 4` · `DEFAULT 8` · `md 10` · `lg 14` · `xl 20` · `2xl 24` · `3xl 32`.
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
