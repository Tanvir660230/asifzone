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
