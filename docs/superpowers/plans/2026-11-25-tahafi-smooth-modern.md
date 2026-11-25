# Tahafi Storefront: Smooth + Modern Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make tahafi.com scroll and load smoothly on mid-range Android phones and look cleaner and more app-like, without changing Asif Zone or Nasihamart.

**Architecture:** Three phases, one PR each, merged in order: (1) Smooth — performance and stability fixes with almost no visible change; (2) Look — header, card, category, product page and checkout clarity; (3) App feel — shared-element page transitions. Every visible change goes through the `tahafi` layout preset (`storeLayout() === "tahafi"`, the existing pattern in `product-showcase.tsx`) or a token whose default keeps today's look. Live content fixes are a separate owner-approved step, not code.

**Tech Stack:** Next.js 15.5 (app router), React 19.2, Tailwind 3, Framer Motion 12, `@clothing-brand/ui-tokens`, Vitest 4, Playwright 1.62.

**Spec:** the audit of 2026-11-25 (live crawl at 390px and 1440px; numbers below are from it). Memory note `project_tahafi_ui_polish.md`.

## Global Constraints

- Asif Zone (`STORE_THEME=default`) must stay pixel-identical and Nasihamart unchanged: check both with `.playwright-mcp/size-check.cjs` and a screenshot diff after each phase.
- No hard-coded colours, fonts or one-off styles: tokens in `packages/ui-tokens/src/index.js` (`tahafi` block at line ~544), recipes in `apps/web/app/globals.css`. A new token's default = today's value.
- Never branch on brand (`if (brand === …)`); branch on the preset (`storeLayout()`) or a token.
- Website copy is English (`apps/web/lib/buy-copy.ts`); landing pages `/lp/*` stay Bangla and are out of scope.
- Brand-level copy says "modest fashion", never men-only.
- No live price, stock or order changes. Live content edits only after the owner says yes.
- Every UI keeps loading, empty and error states and works at 375px.
- Don't commit, merge or deploy Tahafi without the owner's go (each phase = its own PR, owner approves the deploy).
- Work in a new worktree off `origin/main`: `C:/dev/asifzone-tahafi-smooth`, branch `feat/tahafi-smooth`. Check `git diff --cached` before every commit (shared checkout rule).

## Baseline (audit 2026-11-25) and targets

| Measure (390px phone) | Now | Target |
|---|---|---|
| `backdrop-filter` elements per page | 16–25 | ≤ 6 |
| Second card photo downloaded on phones | yes (every card) | no |
| Product page CLS (cookie banner reshapes) | 0.026–0.157 | < 0.02 |
| Cookie notice height | ~242px card over the dock | ≤ 64px one row |
| HTML per page (home / PDP) | 299KB / 361KB | ≤ 180KB / ≤ 220KB |
| Product page actions before the fold | 4 + hint + qty | 2 + small WhatsApp link |

## Local review recipe

Tahafi web against the live store, read-only: start `.playwright-mcp` read-only proxy (scratchpad `ro-proxy.mjs`, `:4199`, GET only → tahafi.com), then in `apps/web` set `.env.local` `PUBLIC_API_URL`/`MEDIA_BASE_URL=http://localhost:4199`, `STORE_THEME=tahafi`, run `next dev --port 3881`. Restart dev after token edits. Default-theme check: same with `STORE_THEME=default` against the local dev API (see `reference_local_e2e_setup.md`). Screenshots need `reducedMotion: 'reduce'` or `.ui-reveal` sections stay blank.

## Review Focus

1. **Dark mode** (`color-mode=dark` cookie, `tahafi.dark` tokens): every surface that loses its blur (card "+", cookie row, hero caption) must still read in dark mode — the solid replacement uses `bg-surface`/`text-fg` tokens, not white. Add a dark-mode screenshot to each phase's verification.
2. **Product without a colour in its name** (no " – " in `product.name`): the card shows the whole name as the title, never an empty line.
3. **Single-variant product** (one size): the hidden size hint and the quick-add must still add straight to the bag.
4. **Reduced motion**: the view transition and the photo fade must be off when `prefers-reduced-motion: reduce`.
5. **Slow 3G / image error**: the placeholder colour stays if the photo fails; nothing collapses or shifts.

---

## Phase 1 — Smooth (PR 1, nearly invisible)

### Task 1: Measurement spec for Tahafi smoothness

**Files:**
- Create: `apps/web/e2e/tahafi-smooth.spec.ts`

**Interfaces:**
- Produces: the spec the later tasks turn green. Skips itself unless `process.env.STORE_THEME === "tahafi"`.

- [ ] **Step 1: Write the spec** — viewport 390×844, `isMobile`, `hasTouch`, `localStorage.az_tracking_consent_v1 = "denied"` via `addInitScript` except in the cookie test. Tests:
  - `blur budget on phone pages`: for `/`, `/category/jackets`, `/product/haven-full-sleeve-jacket-black`, count elements whose computed `backdropFilter` or `webkitBackdropFilter` ≠ `none` after scrolling to the bottom and back; `expect(count).toBeLessThanOrEqual(6)`.
  - `phone cards load one photo`: on `/category/jackets` collect image responses whose URL contains `/_next/image`; `expect(requests).toBeLessThanOrEqual(cardCount + 2)` where `cardCount` = `[data-nav-pending-scope]` count.
  - `cookie notice is one row`: without the init script, `getByRole('dialog', { name: 'Tracking preferences' })` box height `≤ 64`.
  - `product page is stable`: `PerformanceObserver` layout-shift sum after `networkidle` + 1.5s `< 0.02`.
- [ ] **Step 2: Run against the local Tahafi web** — `E2E_BASE_URL=http://localhost:3881 STORE_THEME=tahafi pnpm --filter web test:e2e tahafi-smooth`. Expected: 4 FAIL (blur ~20, ~2× images, height ~242, CLS > 0.02). Save the numbers in the PR description.
- [ ] **Step 3: Commit** — `test(tahafi): smoothness budget spec (failing)`.

### Task 2: Card — no glass, one photo on phones, placeholder colour

**Files:**
- Modify: `apps/web/components/storefront/presets/tahafi/product-card.tsx`
- Modify: `packages/ui-tokens/src/index.js` (`tahafi` block), `packages/ui-tokens/src/index.d.ts` if tokens are typed
- Modify: `apps/web/app/globals.css` (new `.ui-media-fade` recipe)

**Interfaces:**
- Produces: token `--media-placeholder` (default = `rgb(var(--color-surface))`, Tahafi = the studio beige sampled from the product photos' background, contrast-checked in dark mode → dark value from `tahafi.dark`), token `--media-fade` (default `0ms`, Tahafi `280ms`), class `.ui-media-fade` (`opacity:0` until `[data-loaded]`, transition `opacity var(--media-fade) var(--ease-smooth)`; under `prefers-reduced-motion` no transition).

- [ ] **Step 1:** "+" button: replace `glass-panel` with the solid recipe `bg-surface/95 shadow-float ring-1 ring-ink-900/[0.06]` (existing token classes). Same size (`ui-tap`), same position.
- [ ] **Step 2:** Wrap the secondary `<Image>` in `<div className="hidden lg:block">` and change its class to `lg:group-hover:opacity-100` (lazy images inside `display:none` are not fetched; touch "sticky hover" can no longer flash it).
- [ ] **Step 3:** Photo container background `bg-[var(--media-placeholder)]`; primary image gets `ui-media-fade` and `onLoad={(e) => e.currentTarget.dataset.loaded = ""}` (also set when `complete` on mount, so cached images never stay hidden). On error, leave the placeholder visible.
- [ ] **Step 4: Run** `tahafi-smooth` → `phone cards load one photo` PASS; blur count drops (cards no longer count).
- [ ] **Step 5:** Default theme: `size-check.cjs` + home screenshot with `STORE_THEME=default` unchanged (tokens default to today's values).
- [ ] **Step 6: Commit** — `perf(tahafi): solid quick-add, desktop-only hover photo, photo placeholder`.

### Task 3: Blur diet for the rest of the Tahafi chrome

**Files:**
- Modify (only where the spec still counts blur): `presets/tahafi/hero.tsx` (bottom caption card), `presets/tahafi/sections.tsx` (lookbook captions), `components/storefront/product-gallery.tsx` (tahafi photo pill), `presets/tahafi/header.tsx` (logo capsule + round buttons `TAHAFI_GLASS_BUTTON`)

**Interfaces:**
- Consumes: nothing new. Keeps `.glass` on the header bar (after scroll) and the dock + bag button only.

- [ ] **Step 1:** List every remaining blurred element per page with the spec's debug output (`console.log` of tag + class). Replace each non-chrome one with the solid recipe from Task 2; on photos use `bg-ink-950/55` (existing token) for the caption plate so white text keeps ≥ 4.5:1.
- [ ] **Step 2:** Header round buttons and logo capsule: solid `bg-surface/90` + `shadow-float` instead of `glass-panel` (the bar behind them is already glass once scrolled).
- [ ] **Step 3: Run** spec → `blur budget` PASS on all three pages. Dark-mode screenshot of home + PDP looks right.
- [ ] **Step 4: Commit** — `perf(tahafi): blur only on header bar and dock`.

### Task 4: One-row cookie notice

**Files:**
- Modify: `apps/web/components/analytics/tracking-consent-banner.tsx`
- Test: `apps/web/e2e/tahafi-smooth.spec.ts` (`cookie notice is one row`), existing `ad-pixels.spec.ts` still green

**Interfaces:**
- Consumes: `storeLayout()` from `@/lib/theme-layout`, `trackingConsentMode()`.

- [ ] **Step 1:** When `storeLayout() === "tahafi"`: one row, fixed height, solid `bg-surface` + `shadow-float` (no `.glass`), text `"We use cookies to measure our ads."` + `Privacy` link, buttons `Decline` (ghost, `size="sm"`) and `OK`/`Allow` (primary, `size="sm"`). Phone: `inset-x-3`, sits above the dock exactly as now. Other presets: untouched markup.
- [ ] **Step 2:** Fix the reshape: the row has `min-h-[3.5rem]` and `whitespace-nowrap` on buttons so font swap can't change its height.
- [ ] **Step 3: Run** spec → `cookie notice is one row` and `product page is stable` PASS; `pnpm --filter web test:e2e ad-pixels` PASS.
- [ ] **Step 4: Commit** — `fix(tahafi): one-row cookie notice, no layout shift`.

### Task 5: Lighter page HTML

**Files:**
- Create: `apps/web/lib/card-product.ts`, `apps/web/lib/card-product.test.ts`
- Modify: the server components that pass `Product[]` to client cards/rails (find with `git grep -n "ProductCard\|ProductRail" apps/web/app apps/web/components/storefront/home-sections*`)

**Interfaces:**
- Produces: `toCardProduct(product: Product): Product` — same type, heavy fields emptied, so every card keeps working unchanged.

- [ ] **Step 1: Measure** — in a scratch script, fetch `https://tahafi.com/` and the PDP, extract the `self.__next_f.push` payload, and rank `Product` keys by total JSON bytes. Write the top keys in the PR description. Fields are dropped only if no card/rail/quick-add code reads them (`git grep` each key under `components/storefront`).
- [ ] **Step 2: Write the failing test** — `card-product.test.ts`: `toCardProduct(fixture)` keeps `id, slug, name, images, variants (id, size, color, price fields, stock fields), avgRating, reviewCount, resolved.variantDimensions, lowStockThreshold` deep-equal; dropped keys from Step 1 are empty (`""`/`[]`/`null` matching the type); `JSON.stringify(out).length < JSON.stringify(fixture).length * 0.5`.
- [ ] **Step 3: Run** `pnpm --filter web test card-product` → FAIL (module missing).
- [ ] **Step 4: Implement** `toCardProduct` and apply it where card lists are passed to client components (home rails, category/search grid, related rail). The PDP's own product is not trimmed.
- [ ] **Step 5: Run** unit test PASS; `curl -s https://localhost:3881/ | wc -c` vs before: home ≤ 180KB, PDP ≤ 220KB. Quick-add sheet on a card still shows sizes/colours and adds to bag (manual check + `pnpm --filter web test:e2e product-families`).
- [ ] **Step 6: Commit** — `perf(storefront): send card-sized products to the browser`. (Shared code: AZ/NM pages get lighter too, look unchanged — verify with `STORE_THEME=default` screenshots.)

### Task 6: Phase 1 verification + PR

- [ ] Full `tahafi-smooth` spec PASS; `pnpm --filter web lint`; `pnpm --filter web test`.
- [ ] Screens 390 + 1440, light + dark, home / category / PDP / cart / checkout (never submit); default theme screenshot diff = 0.
- [ ] `impeccable` audit + `web-design-guidelines` on changed files; fix findings.
- [ ] PR "Tahafi smooth (phase 1)" with before/after table; owner approves deploy.

---

## Phase 2 — Look (PR 2)

### Task 7: Header — search where the sun was, fuller desktop menu

**Files:**
- Create: `apps/web/components/storefront/presets/tahafi/nav-links.ts`, `nav-links.test.ts`
- Modify: `presets/tahafi/header.tsx`, `presets/tahafi/header-actions.tsx`, `presets/tahafi/footer.tsx`

**Interfaces:**
- Produces: `desktopNavLinks(menu: MenuNode[], max = 6): { label: string; href: string }[]` (use the `menu` node type `header.tsx` already receives).

- [ ] **Step 1: Failing test** — one top-level node "Jackets" with children Sleeveless/Full-Sleeve → `[{Sleeveless Jackets,/category/sleeveless-jackets},{Full-Sleeve Jackets,…},{"All Jackets",/category/jackets}]`; several top-level nodes → the top-level list unchanged (sliced to `max`); a node's `href` wins over `/category/<slug>`; empty menu → `[]`.
- [ ] **Step 2: Run** `pnpm --filter web test nav-links` → FAIL; implement; PASS.
- [ ] **Step 3:** Desktop nav uses `desktopNavLinks(menu)`; search field text `"Search Tahafi"` (was "Search jackets, panjabi…").
- [ ] **Step 4:** Phone header right button: the existing phone search button from `header-actions.tsx` replaces `<ModeToggle>`. `ModeToggle` moves into the Tahafi footer (a labelled "Appearance" row) and stays in the desktop header.
- [ ] **Step 5: Commit** — `feat(tahafi): search in the phone header, sub-categories in the desktop menu`.

### Task 8: Card — colour first, quieter tag

**Files:**
- Create: `apps/web/lib/product-name.ts`, `apps/web/lib/product-name.test.ts`
- Modify: `presets/tahafi/product-card.tsx`

**Interfaces:**
- Produces: `splitStyleColour(name: string): { style: string; colour: string | null }`.

- [ ] **Step 1: Failing test** — `"Haven Sleeveless Jacket – Light Ash"` → `{style:"Haven Sleeveless Jacket", colour:"Light Ash"}`; `"Haven Full-Sleeve Jacket - Black"` (hyphen with spaces) → colour `"Black"`; `"Haven Full-Sleeve Jacket"` (hyphen inside a word only) → `{style: name, colour: null}`; trims spaces; split on the **last** separator.
- [ ] **Step 2: Run** → FAIL; implement; PASS.
- [ ] **Step 3:** Card text block: when `colour` → line 1 `colour` (semibold, current title size), line 2 `style` (`text-xs text-fg-muted`, one line, ellipsis); else today's two-line title. Keep `min-h` so rows stay level. `aria-label`/`alt` keep the full name.
- [ ] **Step 4:** Drop the discount tag on the Tahafi card (the struck-through price already says it); keep "Sold out".
- [ ] **Step 5: Commit** — `feat(tahafi): colour-first card title, no repeated sale tag`.

### Task 9: Category — sub-categories as one scrolling row

**Files:**
- Modify: `apps/web/components/storefront/category-stock-panel.tsx`

- [ ] **Step 1:** When `storeLayout() === "tahafi"`: no "Categories" heading; chips in one row `flex gap-2 overflow-x-auto overscroll-x-contain [scrollbar-width:none] -mx-4 px-4 snap-x` on phones, wrap from `sm`; chip height `ui-tap-min`. Other presets: same markup as now.
- [ ] **Step 2:** Screens at 375px: both chips on one line, page shows the first products higher. Default theme unchanged.
- [ ] **Step 3: Commit** — `feat(tahafi): sub-category chips in one row on phones`.

### Task 10: Product page — two clear actions

**Files:**
- Modify: `apps/web/components/storefront/variant-selector.tsx`, `apps/web/components/storefront/whatsapp-order-button.tsx`, `apps/web/components/storefront/product-reviews.tsx`, `apps/web/components/storefront/product-gallery.tsx`
- Test: `apps/web/e2e/tahafi-smooth.spec.ts` (new tests below)

**Interfaces:**
- Produces: `WhatsAppOrderButton` prop `look?: "button" | "link"` (default `"button"` = today).

- [ ] **Step 1: Failing e2e tests** (Tahafi only): `pdp shows no size hint before a tap` — `getByText(/Please select a size/)` count 0 on load; tap `Add to Cart` → options sheet opens (existing `VariantPickerDialog`). `pdp has no quantity stepper` — `getByRole('button', { name: 'Increase quantity' })` count 0 after picking size L. `one review shows no histogram` — on the 1-review product, `getByText('4 star')` count 0.
- [ ] **Step 2:** `variant-selector.tsx`, Tahafi only: hide the missing-choice line until the shopper has tapped an action once (`attempted` state; the "You usually take" hint still shows); hide the quantity row (quantity 1; the bag still lets them change it).
- [ ] **Step 3:** WhatsApp: Tahafi passes `look="link"` → a text button with the WhatsApp icon under the two actions, `ui-tap-min` hit area.
- [ ] **Step 4:** Reviews: Tahafi with `breakdown.count < 5` → average + stars + "N review(s)" only, no five bars.
- [ ] **Step 5:** Gallery dots: give each dot the existing `.ui-hit` (44px hit area, same look) — all presets, visually identical.
- [ ] **Step 6: Run** spec PASS; `pnpm --filter web test:e2e product-families` PASS (shared buy box).
- [ ] **Step 7: Commit** — `feat(tahafi): two clear actions on the product page`.

### Task 11: Checkout — honest delivery line before the district

**Files:**
- Modify: `apps/web/app/(storefront)/checkout/page.tsx` (order summary delivery row)

- [ ] **Step 1:** Read how the summary shows the quote's delivery fee when no district is chosen (district is optional since PR #193; fees come from the quote/settings — never hard-code 60/120).
- [ ] **Step 2:** When no district is chosen, the summary's delivery row reads `"Inside Dhaka ৳X · Elsewhere ৳Y"` from the same fee source the product page's delivery box uses (`orderHelp.fees`/settings), and the total is labelled "Total (elsewhere)" until a district is chosen. After a district: today's single line. All presets (it's a correctness fix); default theme screenshot changes only in that row — note it in the PR.
- [ ] **Step 3:** Tahafi phones: the Place Order button becomes a sticky bottom bar above the safe area once the form is taller than the screen (reuse the PDP sticky bar recipe `sticky-add-to-cart.tsx` styles).
- [ ] **Step 4: Run** the checkout e2e specs (`git grep -l checkout apps/web/e2e`) — PASS, never submitting against live.
- [ ] **Step 5: Commit** — `feat(checkout): both delivery fees before a district is chosen`.

### Task 12: Live content fixes (owner approval first — not code)

Via `node ~/.asifzone-admin/az-admin.mjs` as the owner account, after the owner says yes to the list:
- [ ] Home "Sleeveless jackets" subtitle: "Six colours, sizes M to XXXL".
- [ ] Home "Full-sleeve jackets" subtitle: "Four colours, sizes M to XXL".
- [ ] Footer/SEO tagline: "Modern modest fashion" (brand scope rule).
- [ ] Product photos without the logo stamp on the site (the un-stamped `tahafi-final` set exists; upload with `upload-haven.cjs --replace` only after the owner picks; categories keep their own uploads).
- [ ] "Our story" page at `/about` (studio photos only, owner writes or approves the text) and a footer link.

### Task 13: Phase 2 verification + PR

Same checklist as Task 6, plus: before/after screenshots of header, card, category, PDP, checkout at 375 and 1440, light and dark.

---

## Phase 3 — App feel (PR 3)

### Task 14: Photo glides from card to product page

**Files:**
- Modify: `apps/web/next.config.mjs` (`experimental.viewTransition: true`)
- Modify: `presets/tahafi/product-card.tsx`, `apps/web/components/storefront/product-gallery.tsx`
- Modify: `apps/web/app/globals.css` (`::view-transition-*` timing from motion tokens; none under reduced motion)
- Test: `apps/web/e2e/tahafi-smooth.spec.ts`

- [ ] **Step 1:** Confirm the API in current docs with Context7 (Next 15.5 `experimental.viewTransition` + React `unstable_ViewTransition`). If it isn't usable on this version, stop and report; do not add a library without the owner.
- [ ] **Step 2:** Tahafi card primary photo wrapped in `<ViewTransition name={\`photo-${product.slug}\`}>`; the PDP gallery's first photo uses the same name. Only when `storeLayout() === "tahafi"`; other presets render no boundary.
- [ ] **Step 3:** Duration `--duration-slow`, easing `--ease-smooth` from tokens; `@media (prefers-reduced-motion: reduce) { ::view-transition-group(*) { animation: none } }`.
- [ ] **Step 4: Test** `card photo transitions to the product page` — click a card, assert `document.getAnimations()` includes a view-transition animation during navigation (skip when the browser lacks `document.startViewTransition`), and the PDP `h1` is visible within 1s.
- [ ] **Step 5:** Default theme: navigate home → product, no animation, screenshot identical.
- [ ] **Step 6: Commit** — `feat(tahafi): product photo glides into the product page`.

### Task 15: Phase 3 verification + PR

Same checklist as Task 6, plus a short screen recording (phone width) of home → card → product → back for the owner.

---

## Out of scope (decided)

- Loading skeletons for category/product routes: navigation already lands in ~0.3s and a route `loading.tsx` would change every store.
- New libraries, fonts or a palette change.
- Landing pages (`/lp/*`) — their own programme.

---

## Outcome (2026-11-25, branch feat/tahafi-smooth)

Done: Tasks 1–4, 7–11. Measured against the live catalogue through a GET-only proxy (POST allowed only to the two
price-quote endpoints): blur ≤ 6 on home / category / product, one photo per card on phones (was 20 for 10 cards),
one-row cookie notice, product page CLS < 0.02. `e2e/tahafi-smooth.spec.ts`: 8 passed, 1 fixme.

Changed from the plan, with reasons:
- Task 2: no photo fade-in. Hiding a photo until JavaScript marks it loaded would keep cards blank on a slow phone until
  hydration; the placeholder colour alone removes the blank tile.
- Task 5 dropped: the 299KB home HTML is 63KB gzipped; product objects are ~48KB of it before compression, so trimming
  would save ~5–8KB on the wire while risking fields the pixels read (sku). Not worth it.
- Task 10 step 5 dropped: gallery dots already have a 26px hit area (`after:-inset-2.5`); 44px would overlap neighbours.
- Phase 3 (Task 14) on hold: Next 15.5 documents `experimental.viewTransition` as not for production, and it moves the
  whole app (all three stores) to React's experimental build. The acceptance test is kept as `test.fixme`.
- Task 12 (live content) not done: needs the owner's yes.

Default (Asif Zone) and Nasihamart: full-page screenshots of home, a category, a product (AZ) and the bag at 390 and
1440, origin/main vs this branch on the same live data: 0 differing pixels.

Task 11 after merging main (#197/#198): main now asks inside / outside Dhaka and leaves delivery out of the total until
the zone is known, which does the fee hint's job better, so the hint was dropped. Only the Tahafi sticky Place Order
remains from Task 11; no change for Asif Zone or Nasihamart.
