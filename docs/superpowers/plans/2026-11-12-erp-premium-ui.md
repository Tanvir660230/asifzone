# ERP Premium UI — Programme Plan

> **For agentic workers:** this is the programme plan. Each phase below becomes its own task-level plan
> (`docs/superpowers/plans/2026-11-12-erp-premium-ui-p<N>.md`) written when that phase starts, because phases 2–7
> depend on the direction the owner picks in Phase 0. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every page of the Store Console (133 admin routes, 48 of them Money) looks and feels like one premium,
Apple-calm product: one visual language, one set of page patterns, quiet motion, flawless on a 375 px phone.

**Architecture:** UI only. No API, schema or business-rule change. The look changes in three places only —
`surfaces.admin` tokens (`packages/ui-tokens/src/index.js`), admin recipes (`apps/web/app/globals.css`) and the
primitives (`apps/web/components/ui/*`, `apps/web/components/admin/*`). Pages are then migrated onto those
primitives module by module, so a page gets better by losing one-off classes, not by gaining new ones.

**Tech stack:** Next.js 15, React 19, Tailwind 3, Framer Motion (`apps/web/lib/motion.ts`), Playwright (visual
baseline `apps/web/e2e/admin-visual.spec.ts`), `pnpm --filter web budget:admin`.

**Spec:** `docs/DESIGN_SYSTEM.md` §6 (admin patterns) + the Phase 0 direction mockup once approved.

## Owner's four tests (2026-11-12) — every phase is judged on these

1. **Premium look.** Nothing on a screen looks unfinished: aligned edges, one type scale, one card, calm colour.
2. **Clear view.** The page's one answer (what needs doing, how much money, how much stock) is readable in two
   seconds; secondary detail is one click away, not on top.
3. **Perfect navigation.** Any page in at most two clicks or one search; you always see where you are; related
   pages sit together; nothing appears in two menus.
4. **Size efficiency.** No wasted space and no cramming: at 1440 px a list shows at least 14 rows without
   scrolling, forms fit their fields, phone pages show the main action without scrolling.
5. **Structured.** The same thing is always in the same place on every page (title, action, filters, body).

## Global constraints

- Admin is light only. No dark mode, no theme toggle.
- All three stores (Asif Zone, Nasihamart, Tahafi) get the same admin; the admin surface never reads brand tokens.
  Storefront must stay pixel-identical (`[data-surface="storefront"]` previews inside admin included).
- No hard-coded colours, sizes, shadows or fonts in pages. A missing value becomes a token.
- No purple/blue gradients, no emoji icons, no decorative glass on content, no identical 3-card grids.
- Words stay as they are (sentence case, the owner's nouns). Website UI is English.
- Every page: loading, empty, error states; works at 375 px; touch targets ≥ 44 px; WCAG AA contrast.
- Own JS per admin page stays ≤ 250 KB gzip (`budget:admin`).
- e2e selectors (`data-testid`, aria names) are kept; a renamed one is updated in the same PR.
- Work in a worktree off `origin/main` (the shared checkout is 143 commits behind). One PR per phase.
- No merge or deploy of a phase before the owner has seen its before/after screenshots. Tahafi deploys only on the
  owner's word.

## What is wrong today (measured on origin/main, 2026-11-12)

| Finding | Evidence | Why it reads as "not premium" |
|---|---|---|
| Two visual languages | Money uses `.liquid*` glass under `[data-area="finance"]`; the other 85 pages are flat | Moving between modules feels like two apps |
| Type scale is ad hoc | 459 arbitrary `text-[1Xpx]` in 140 files; `text-xs`/`text-sm` bumped globally by a `[class~=]` selector (globals.css:1147) | Uneven hierarchy; sizes fight each other |
| Look patched from outside | globals.css rewrites `.space-y-6`, `.p-6`, `.gap-6`, `.grid > *` under the admin surface | Spacing is accidental, breaks on new pages |
| Tables are not one component | 41 raw `<table>` in 33 files vs `DataTable` in 9 | Row height, alignment, phone cards differ per page |
| Leftover caps labels | 131 `uppercase` in 79 files | Shouts; old ERP feel |
| Inline styles | 65 `style={{…}}` in 44 files | Values outside the token system |
| Giant page files | 15 pages over 400 lines (customers 859, settings 782, orders/new 696, payroll 646) | Each styles its own layout |
| Motion is uneven | 71 motion usages in 40 files, most pages none | No shared feel for open, save, switch |

## Seen on the live admin (2026-11-12, 31 pages at 1440 px and 375 px)

| Finding | Evidence | Target |
|---|---|---|
| Everything is zoomed | `html { font-size: 17px }` from 1024 px, 18 px from 1536 px (globals.css) scales every rem; Orders shows 6 rows in a 960 px window, Products 8, Supplier bills 3 | Admin sets its own 13 px body / 20 px title scale; 40 px rows; 32 px controls → 15+ rows |
| Chrome before content | Orders: title, summary, Active/Trash + search, status tabs, Views chips — data starts at 390 px | One header row, one tab row, one filter row — data starts by 190 px |
| Three navigation models | Sidebar children (Orders, Products, Money); a second inner column (Stock, Bills to pay) that takes 230 px; Money's children scroll under Settings and clip | Sidebar = modules only; a module's pages = tabs under the title; a third level = segmented control in the page |
| Lists drawn as cards | Supplier bills, Expenses: one tall card per record, ISO dates, lower-case status, monospace ids | One table pattern; store date format; `Badge` |
| Two skins | Money's dark hero card and round glossy keys vs flat pages | One card; big figures on white |

Direction mockup (awaiting the owner's verdict): https://claude.ai/artifact/St9vFxxDXXFzRnPGgSMAKE

## Phases

### Phase 0 — See it, then choose the look (no product code)

- [ ] Run a local stack on a demo DB copy (LIVE_PROVIDERS=off) and screenshot all 133 routes at 1440 px and 375 px.
- [ ] Score each page on six points: hierarchy, spacing, type, table/list, states, phone. Output: a ranked list.
- [ ] Build one HTML mockup with **two directions** on the same four real screens (Dashboard, Orders list,
      Money overview, a Stock form), with real numbers from the demo DB:
  - **A — Paper & graphite (recommended):** keep today's warm canvas and graphite action; fix everything by
    rigour — strict 4 px grid, five type sizes, hairlines instead of boxes, large calm numbers, one soft elevation.
    Glass only on floating chrome. Money loses its separate skin and becomes the model for the rest.
  - **B — Soft depth:** same palette, but cards float (layered soft shadow, 20 px corners), the sidebar and
    toolbar are translucent, key numbers sit on a graphite hero card on every module home.
- [ ] Owner picks A or B (or a mix). Nothing else starts before this.

**Done when:** the audit list exists, the owner has chosen, and the choice is written into `docs/DESIGN_SYSTEM.md` §6.

### Phase 1 — Foundation (tokens, recipes, primitives)

Files: `packages/ui-tokens/src/index.js`, `apps/web/app/globals.css`, `apps/web/components/ui/*`,
`apps/web/lib/motion.ts`, `apps/api/src/config/theme-tokens.test.ts`, `docs/DESIGN_SYSTEM.md`.

- [ ] Admin type scale as tokens: five named sizes (`title`, `heading`, `body`, `label`, `caption`) plus
      `figure` sizes for money; tabular numerals on every number. Remove the `[class~=text-xs|text-sm]` bump.
- [ ] Spacing: page gutter, section gap, card padding as density tokens used by `PageHeader`, `Card`,
      `FormSection`; delete the `.space-y-6` / `.p-6` / `.gap-6` overrides once pages no longer need them (Phase 7).
- [ ] One surface model: canvas → card → raised → floating, each one token set. Fold `.liquid*` into it so
      Money and the rest share one card.
- [ ] Primitives polished once, used everywhere: `Button` (press state), `Input`/`Select` (focus ring),
      `Card`, `Badge`, `Table`, `Modal`/`Drawer` (spring in, fade out), `EmptyState`, `Skeleton`, `toast`.
- [ ] Motion presets: `press`, `sheet`, `popover`, `listItem`, `numberChange`; all off under reduced motion.
- [ ] Contrast test for every new text/fill pair added to `theme-tokens.test.ts` (write the failing test first).

**Verify:** `pnpm --filter api test theme-tokens`, `pnpm --filter web lint`, storefront pixel-diff = 0 with
`STORE_THEME=default`, `nasihamart`, `tahafi`.

### Phase 2 — Shell

Files: `components/admin/{sidebar,section-bar,mobile-nav-bar,more-sheet,command-palette,notification-bell,account-menu,page-header,breadcrumbs}.tsx`.

- [ ] Sidebar: clearer group rhythm, active item as a soft filled pill, counts as quiet badges.
- [ ] Toolbar + section bar as one sticky layer with a hairline that appears only on scroll.
- [ ] Command palette (Ctrl/⌘ K) restyled as the fastest way anywhere; recent pages first.
- [ ] Phone: bottom bar and More sheet with native-feel transitions; large title that collapses on scroll.

**Verify:** `admin-mobile-shell.spec.ts`, `admin-section-bar.spec.ts`, screenshots at 1440 / 1024 / 375.

### Phase 3 — Shared page patterns

Files: `components/admin/data-table/*`, `components/admin/{stat-tile,metric-card,queue-item,chart-frame,phone-tables,filters/*}.tsx`, new `components/admin/patterns/{list-page,record-page,form-page}.tsx`.

- [ ] `ListPage`, `RecordPage`, `FormPage` shells that fix the five-row anatomy of DESIGN_SYSTEM §6.
- [ ] `DataTable` covers what the 33 raw-table pages need (sticky first column, totals row, row actions,
      phone cards), so pages can move onto it.
- [ ] One `Figure` component for KPI numbers (label, value, delta, source note) replacing `StatTile`,
      `MetricCard`, `ConversionMetricCard`, `HeroRevenueCard` variants.
- [ ] Charts: one palette, one axis style, one tooltip (use the `dataviz` skill).

**Verify:** component stories on a hidden `/admin/_kit` page screenshotted in CI's visual spec.

### Phases 4–6 — Module migration (one PR each, highest use first)

| Phase | Module | Routes | Order inside |
|---|---|---|---|
| 4 | Sell: Dashboard, Orders, Customers, Inbox | 18 | Dashboard → Orders list/detail → New order → scan pages → Customers → Inbox |
| 5 | Make & stock: Stock, Purchases, Production, Products, Catalog | 29 | Stock hub → Purchases → Production → Products list/builder → Catalog setup |
| 6 | Money & Books | 48 | Overview → Needs attention → Accounts → Expenses → Bills → Courier → Month-end → Statements → rest |
| 6b | Grow, Settings, Team, Analytics, sign-in | 20 | Analytics → Marketing → Online store → Settings → Team → sign-in |

Per page, the same checklist:
- [ ] Rebuild on `ListPage` / `RecordPage` / `FormPage`; raw `<table>` → `DataTable`.
- [ ] Remove arbitrary `text-[…]`, `uppercase`, `style={{…}}`; split files over 400 lines into sections.
- [ ] Loading, empty, filtered-empty, error states present and in the page's shape.
- [ ] Screenshot 1440 + 375 before and after; `impeccable` critique + `web-design-guidelines` review; fix.
- [ ] The module's e2e specs pass.

### Phase 7 — Finish

- [ ] Delete the outside-in CSS patches in globals.css that no page needs any more; delete `.liquid*` if unused.
- [ ] Lint rule (ESLint `no-restricted-syntax`) that fails on arbitrary font sizes, hex colours and
      `uppercase` under `app/admin` and `components/admin`, so the look cannot drift back.
- [ ] axe pass on all routes; `budget:admin`; new visual baseline (`VISUAL=1 … --update-snapshots=all`).
- [ ] Real-phone check by the owner on the three stores' admins.

## Review focus

1. Long Bangla and long product names in tables and cards — must truncate or wrap without breaking row height.
2. Large money values (৳ 1,00,00,000+) and negative values in `Figure` and table cells — no overflow at 375 px.
3. Empty stores (Nasihamart books at ৳0, Tahafi with few orders) — every module home must look intentional with no data.
4. MANAGER role — pages reached by link without permission show `PermissionState`, not a broken layout.
5. Storefront previews inside the admin (Studio, product preview) — must not inherit any new admin token.

## Risks

- **Scale.** 133 routes. Mitigation: Phases 1–3 lift every page at once before any page is touched.
- **Owner taste.** Two earlier looks were sent back (first Money glass, label overhaul). Mitigation: Phase 0
  mockup with real data, and before/after screenshots at every phase gate.
- **Parallel sessions** editing admin pages in other worktrees. Mitigation: rebase each module PR on
  `origin/main` right before review; keep module PRs short-lived.

## Progress (2026-11-12, draft PR #156)

- [x] Scale: 15 px console root from 1024 px, compact density tokens, one-row page title, compact rows for every table, smaller StatTile.
- [x] Navigation: one rule (sidebar modules, section bar pages, capsule tabs for a group's pages); second menu columns removed.
- [x] Orders rows two lines; Supplier bills, Goods receipts, Supplier returns as tables; Journals as one list; store-format dates on those and Expenses.
- [x] Money and Profit hero on the console's white card (owner: "do what is best"); smaller Dashboard title.
- [ ] Shared ListPage / RecordPage / FormPage shells; raw `<table>` pages onto `DataTable`.
- [ ] Page passes not yet done one by one: Products builder, Stock inner pages, Analytics, Marketing, Online store, Settings, Team.
- [ ] Lint rule against arbitrary font sizes and `uppercase` (459 and 131 existing uses must be cleared first).
- [ ] Remove the outside-in CSS patches in globals.css once pages no longer need them.
