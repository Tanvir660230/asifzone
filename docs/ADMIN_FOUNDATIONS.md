# Admin foundations (P1)

The infrastructure every admin screen builds on. Each concern has exactly one home; new screens use these instead of
re-implementing them. Lint warnings (`apps/web/eslint.config.mjs`) and architecture tests (`apps/web/tests/architecture/`)
keep it that way.

| Concern | Source of truth | Use it via |
| --- | --- | --- |
| Navigation (sidebar, flyout, mobile bar, section tabs, palette pages, Create menu, breadcrumbs, titles, `g` chords, deprecated redirects) | `apps/web/lib/admin/navigation.ts` (`NAV_NODES`) | `navTree`, `sectionTabsFor`, `breadcrumbsFor`, `createCommands`, `<ModuleTabs />` |
| What the UI offers an admin | `apps/web/lib/admin/capabilities.ts` (`CAPABILITIES`) | `useCapability("orders.manage")`, `useCapabilities()` |
| Switchable admin features | `apps/web/lib/admin/features.ts` + `ADMIN_FEATURES` runtime env | node `featureFlag`, `isFeatureEnabled()` |
| Status words, tone, icon, meaning | `apps/web/lib/status.ts` (`STATUS_REGISTRY`) | `<StatusBadge domain value />`, `lib/format` helpers |
| Business vocabulary | `apps/web/lib/admin/terminology.ts` (`TERMS`) | `term("returnRequest")` |
| View state in the URL | `apps/web/lib/url-state.ts` (grammar) | `useUrlState(schema)` |
| Lists | `apps/web/components/admin/data-table/` | `<DataTable columns rows … />` |
| Filters and views | `apps/web/lib/admin/filters.ts`, `components/admin/filters/` | `useFilterState(defs)`, `<FilterBar />`, `<ViewBar />` |
| Keyboard | `apps/web/lib/admin/shortcuts.ts` (`SHORTCUTS`) | `useShortcut("create.open", fn)` |
| Overlays / Escape | `apps/web/lib/layer-stack.ts` | automatic through `useFocusTrap` |
| React Query keys | `apps/web/lib/query-keys.ts` (+ `orderKeys`) | `customerKeys.detail(id)` |
| Density | `packages/ui-tokens` `density` | `w-sidebar`, `h-header`, `h-row`, `h-row-dense`, `h-control`, `px-page`, `max-w-drawer-md` |

## Recipes

**Add an admin page.** Create the route, then add one node to `NAV_NODES`: `id`, `label` (from `TERMS` where the
concept has one), `kind`, `route`, `parent`, `domain`, `order`, and the `capability` that its API calls need. The
sidebar, tabs, palette, breadcrumbs and title follow. A detail or editor page is `visibility: "hidden"` (it gets a title
and breadcrumbs, but no menu entry). The test `every admin page has a navigation node` fails until the node exists.

**Move a page.** Change the node's `route` and list the old path under `deprecatedRoutes` (with the same `[param]`
names). Middleware redirects it (308), keeping the query string.

**Gate an action.** Add a capability that maps to an existing permission (and a provider, if the action needs one). Do
not compare `admin.role`, and do not add a permission table to a component. The API stays authoritative.

**Hide a future module.** Add a flag to `FEATURE_FLAGS`, put `featureFlag` on the node, and switch it on for an
installation with `ADMIN_FEATURES=messages-inbox` (`-flag` turns off a flag that is on by default).

**Build a list.** Declare `FilterDefinition[]` (keys `f.*`, plus `from`/`to`) and call `useFilterState(defs)` for `q`,
filters, `page` and `size` in the URL. Render `<FilterBar />`, and `<DataTable />` with server paging and sorting,
selection and row actions. Old deep-link names go in `aliases` (as Orders does: `?queue=` → `f.queue`).

**Bind a key.** Add it to `SHORTCUTS` (the test rejects duplicates and `[`/`]`), then call `useShortcut(id, handler)`.
Single-key shortcuts pause while the admin is typing or an overlay is open. Escape belongs to the layer stack.

## What P1 deliberately did not do

- **Redesign module screens.** Orders keeps its own state hook. It now reads its chip wording and deep links from the
  filter definitions, and moves fully to URL state in P3.
- **Rewrite every table, query key or permission check.** These migrate module by module. The lint guards warn on new
  bespoke tables, hand-written URL parsing, role checks and `adminCan` imports.
- **Add a search API.** The command palette's record search still uses the list endpoints.

## Performance budgets (P9)

Blueprint V2 budgets: each admin page ships ≤ 250 KB gzip of its own JavaScript (shared framework/layout chunks
excluded), and Home is interactive in ≤ 2.5 s on a mid-range phone over 4G.

- **Bundle check:** after `next build`, `pnpm --filter web budget:admin` lists every admin page's own JS and fails
  if one is over. Measured 2026-10-08: all 59 pages within budget (largest: print labels 162 KB); shared by every
  admin page 276 KB.
- **Load time** (production build, Pixel 7, CPU 4×, cold cache; "interactive" = content in, 500 ms with no long task):

  | Page | 4G (9 Mbps, 170 ms) | Slow 4G (1.6 Mbps, 150 ms) |
  |---|---|---|
  | Home | 1.63 s | 2.54 s |
  | Orders | 1.85 s | 2.99 s |
  | Products | 1.83 s | 3.18 s |
  | Customers | 1.68 s | 2.05 s |

- What keeps it there: the web bundles `@clothing-brand/shared` from source (`transpilePackages` + alias,
  `"sideEffects": false`) so pages only get the modules they import; list thumbnails use the 300 px `-thumb`
  rendition (`<Thumbnail>`); the "View store" link doesn't prefetch the storefront.
- Not yet done: Home's data queries wait for `/me` + capabilities (one extra round trip), and the root layout
  preloads the storefront's display font. Both matter mainly on Slow 4G.

## Visual baseline (P9)

`apps/web/e2e/admin-visual.spec.ts` screenshots nine key pages (Home, Orders, Products, Customers, Inbox, Payments,
Analytics, Settings, Audit log) on desktop and phone. Data — rows, figures, dates, counts, charts — is masked, so a
diff means the layout, chrome or controls changed. Opt-in because screenshots depend on OS fonts and the database:
`VISUAL=1 pnpm --filter web test:e2e admin-visual` (add `--update-snapshots=all` after an intended change). The stored
baseline (`*-win32.png`) was taken 2026-10-08 against a production build on the demo-data mirror.
