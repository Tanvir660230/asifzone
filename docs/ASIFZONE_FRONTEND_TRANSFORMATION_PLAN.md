# Asif Zone — Frontend Transformation Plan

Status: **implemented and verified** (see the report) · Branch `feat/storefront-transformation` (off `origin/main` 050ca3e) · Worktree `C:/dev/asifzone-storefront`
Companion report: `docs/ASIFZONE_FRONTEND_TRANSFORMATION_REPORT.md` (written at the end).

Legend for every claim below: **[V]** verified in code or a running browser · **[M]** measured (numbers from a script in `apps/web/scripts/`) · **[A]** assumption · **[R]** recommendation.

---

## 1. Executive summary

The storefront is not a blank slate. It already has a disciplined, token-driven, multi-brand design system (`packages/ui-tokens`, `globals.css` recipes, `components/ui` primitives, `docs/DESIGN_SYSTEM.md`) and serves two installations from one codebase: Asif Zone (`STORE_THEME=default`) and Nasihamart (`STORE_THEME=nasihamart`). Rendered at 375/768/1440 px, every public route loads with no horizontal overflow, one `<h1>` per page, and real data. **[V]**

So the transformation is **not a rewrite**. A rewrite would throw away a working theming system, accessibility primitives and two brands' worth of tuning. The evidence points to a set of concrete defects, plus systemic polish that is best fixed once in the foundation:

| # | Finding | Severity | Evidence |
|---|---|---|---|
| 1 | Layout shift: CLS **0.302** (home), **0.591** (cart), **0.221** (checkout) on mobile; "good" is ≤ 0.1 | Critical | [M] `storefront-vitals.mjs`; attributed to the footer being pushed by streamed or hydrated content |
| 2 | 9 private and utility routes emit `<link rel=canonical>` = **the homepage** and the bare title "Asif Zone" | High | [V] audit report; root layout sets `alternates.canonical` and client pages can't override it |
| 3 | Checkout shows raw Zod text to shoppers ("String must contain at least 1 character(s)") | High | [V] screenshot `flow/before-checkout-invalid-375.png` |
| 4 | The floating contact button sits over content on mobile (product title, checkout fields, card actions) | High | [V] screenshots `pdp-375-0`, `before-checkout-375` |
| 5 | Secondary text in `ink-400` (#b3b3b3) is ~2.1:1 on white (WCAG AA needs 4.5:1); 144 storefront text usages | High | [V] grep count; tier lines, breadcrumbs, helper text, review counts |
| 6 | Text below 12 px: 10 px discount badges and count badges, 11 px bottom-nav labels and footer captions | Medium | [V] audit `tiny` list |
| 7 | Product titles duplicate the brand: "… \| Asif Zone \| Asif Zone" | Medium | [V] `<title>` of `/product/premium-pakistani-cap-white` |
| 8 | Listing pages jump from `<h1>` to `<h3>` (filters, cards) | Medium | [V] audit headings |
| 9 | Mobile listing header: the sort select squeezes the title into two lines | Medium | [V] `cat-375-0.png` |
| 10 | Sold-out sizes use a red strike over a pink fill: loud, and the struck text is illegible | Medium | [V] `pdp-1440-0.png` |
| 11 | Cart count badge: low-emphasis grey fill; the count isn't in the Bag tab's accessible name | Medium | [V] screenshots and code |
| 12 | Empty reviews say "no reviews" twice in low-contrast grey | Low | [V] `pdp-1440-1.png` |
| 13 | Footer repeats the brand three times (logo, giant wordmark, tagline ×3) and titles the newsletter "Get in Touch" | Low | [V] `before-track-order-d.png` |

Things that look wrong but are **content or configuration, not code**. These are recorded as owner actions and not "fixed" by overriding admin data:

- The mobile hero is a desktop banner with baked-in text, unreadable at 375 px. The banner model already supports `mobileImageUrl` (`hero-carousel.tsx`); the owner should upload a 1:1 mobile crop. **[V]**
- Size facet shows duplicate spellings ("2XL 23.5" and "2XL/23.5"): inconsistent variant values in the catalog. Clean them up in Admin › Products. **[V]**
- The product page stacks up to 5 recommendation rails (Best Match, Customers Also Bought, Upgrade Option, Budget Alternative, Trending). These are admin-configured product-page sections; **[R]** keep two or three.
- Homepage "Featured" shows 9 items in a 4-column grid, leaving one orphan. `itemCount` is admin-set; **[R]** use 8 or 12.
- Favicon URL in the demo settings points at `localhost:4000` (CSP-blocked locally). This is a data artifact of the demo mirror, not present in prod. **[A]**

---

## 2. Verified architecture and technology inventory

| Area | Fact | Source |
|---|---|---|
| Monorepo | pnpm 9 + turbo; `apps/web`, `apps/api`, `packages/{shared,ui-tokens,config}` | `package.json`, `pnpm-workspace.yaml` [V] |
| Web | Next.js 15.5 App Router, React 19.2, TypeScript 5.9, Tailwind 3.4, Framer Motion 12, TanStack Query 5, Zustand 4, react-hook-form + zod, lucide-react icons | `apps/web/package.json` [V] |
| API | Express + Prisma + Postgres, Vitest; storefront endpoints under `/api/products/storefront/*`, `/api/v1/checkout/quote` | `apps/api` [V] |
| Rendering | Root layout calls `headers()`, so **every page renders per request** (needed for the CSP nonce in `middleware.ts`). Data fetches keep `revalidate` caching | `app/layout.tsx` [V] |
| Route groups | `(storefront)` (with `loading.tsx` Suspense), `(storefront-detail)` (product/category, no loading, so `notFound()` yields a real 404), `account/(auth)`, `account/(shell)`, `account/(invoice)`, `admin` | [V] |
| Theming | `<html data-brand>` from `STORE_THEME`; tokens as CSS variables; `[data-surface="admin"]` isolates the admin; `.ui-band-inverse` dark sections that a theme can render light | `ui-tokens/src/index.js`, `tailwind.config.ts` [V] |
| Fonts | `next/font/google`: Inter (body), Playfair Display (titles), Noto Sans Bengali (per-glyph fallback, incl. ৳), Newsreader + Instrument Sans (Nasihamart only, `preload:false`) | `app/layout.tsx` [V] |
| State | Cart, wishlist, compare in Zustand + `localStorage` (cart mirrored to the server for signed-in customers). **Prices are never computed client-side**: totals come from the server quote (`hooks/use-quote.ts`) | `store/cart.ts` [V] |
| Auth | httpOnly cookies on the API origin; `apiFetch` does one silent refresh on 401; `useCurrentCustomer` redirects, `useOptionalCustomer` doesn't | `lib/api-client.ts`, `hooks/use-current-customer.ts` [V] |
| Analytics | Page-view tracker, Meta/TikTok pixels + Clarity behind a consent banner (`az_tracking_consent_v1`) | `components/analytics/*`, `lib/pixels/consent.ts` [V] |
| SEO | `generateMetadata` on server pages; `lib/seo.ts` (`buildOpenGraph`, `productSeoFields`); Organization + WebSite JSON-LD in the root layout; product JSON-LD; `robots.ts`, `sitemap.ts` | [V] |
| Tests | Web: Vitest (44 unit, `tests/`), Playwright e2e (29 specs, mostly admin; storefront: `storefront-existing-products`, `variant-picker-and-stock`, `customer-accounts`, `security-headers`, `ad-pixels`, `second-store`). API: Vitest (~1457) | [V] |
| Baseline quality | `pnpm --filter web lint` 0 errors / 51 warnings (all admin); `tsc --noEmit` clean; web unit 42/44. The 2 failures are pre-existing admin tests (`navigation.test.ts`, `status-registry.test.ts`), unrelated to the storefront | [M] |

---

## 3. Route and component inventory

### 3.1 Public routes (all audited at 375 / 768 / 1440 px, `apps/web/scripts/storefront-audit.mjs`)

| Route | Source | Data / backend | Status | Notes |
|---|---|---|---|---|
| `/` | `app/(storefront)/page.tsx` | homepage sections, banners, flash sale, category tree (server) | 200 | CLS 0.302; sr-only `<h1>`; sections admin-composed |
| `/category/[slug]` | `app/(storefront-detail)/category/[slug]/page.tsx` | storefront listing + facets (server, URL state) | 200 | h1→h3 skip; mobile header squeeze |
| `/product/[slug]` | `app/(storefront-detail)/product/[slug]/page.tsx` → `product-page-view.tsx` | product, rails, reviews | 200 / 404 | duplicate brand in title; sold-out chips; FAB overlap |
| `/search` | `app/(storefront)/search/page.tsx` + `search-overlay.tsx` | listing + suggest + popular searches | 200 | `noindex, follow` when `q` is set (correct) |
| `/cart` | `app/(storefront)/cart/page.tsx` (client) | local cart + server quote | 200 | CLS 0.591; canonical → home |
| `/checkout` | `app/(storefront)/checkout/page.tsx` (client, 793 lines) | quote, order create, gateways | 200 | CLS 0.221; raw Zod messages; canonical → home |
| `/order-confirmation/[orderNumber]` | client | `trackOrder` (needs phone) | 200 | canonical → home; asks for phone when not in session |
| `/pay/[token]`, `/pay/complete` | client | payment links | — | not audited visually (needs a live token) |
| `/track-order` | client | `trackOrder` | 200 | canonical → home, title "Asif Zone" |
| `/wishlist` | client | local or server wishlist | 200 | canonical → home |
| `/contact`, `/faq`, `/shipping-returns`, `/privacy-policy`, `/terms` | server | settings / store policy | 200 | consistent; fine |
| `/account/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email`, `/claim`, `/unsubscribe` | `app/account/(auth)/*` (client) | customer auth | 200 | canonical → home, title "Asif Zone"; should be `noindex` |
| `/account/*` (13 pages) | `app/account/(shell)/*` | customer APIs | auth-gated | audited signed in (see report) |
| 404 (root + storefront) | `app/not-found.tsx`, `(storefront)/not-found.tsx`, `(storefront-detail)/not-found.tsx` | — | 404 | real 404 status, `noindex` (correct); product-404 title "Product" |
| `/preview/[id]` | admin product preview | admin session | — | admin-only, out of scope |

### 3.2 Shared storefront components (74 files in `components/storefront`, 37 in `components/ui`)

Shell: `storefront-shell.tsx`, `header.tsx`, `mega-menu.tsx`, `mobile-nav.tsx`, `mobile-bottom-nav.tsx`, `footer.tsx`, `cart-drawer.tsx`, `contact-widget.tsx`, `search-overlay.tsx`, `sticky-cart-bar.tsx`, `page-transition.tsx`.
Commerce: `product-card.tsx`, `product-grid.tsx`, `product-carousel*.tsx`, `product-gallery.tsx`, `variant-selector.tsx`, `variant-option-pickers.tsx`, `variant-picker-dialog.tsx`, `sticky-add-to-cart.tsx`, `facet-filters.tsx`, `promo-badge.tsx`, `product-reviews.tsx`, `quick-view-modal.tsx`, `compare-bar.tsx`.
Content: `hero.tsx`, `hero-carousel.tsx`, `category-grid.tsx`, `brand-story.tsx`, `values-grid.tsx`, `trust-strip.tsx`, `promo-banner-section.tsx`, `flash-sale-section.tsx`, `newsletter-form.tsx`.

### 3.3 Admin

The admin (`app/admin`, 158 components) is a separate product with its own surface tokens (`[data-surface="admin"]`, Apple-style, light only) and an active, separate redesign programme (Admin V2). **It is out of scope here [R]:** redesigning it in parallel would collide with that work. Nothing in this plan changes admin rendering. The admin surface re-declares every token, so palette changes to the default theme do not reach it. **[V]** (`surfaces.admin` in ui-tokens).

---

## 4. Issue register (evidence-based)

Severity: **Critical** = breaks a Core Web Vital or a purchase; **High** = WCAG AA failure, SEO defect, or blocks or obscures content on a key path; **Medium** = consistency or readability problem with real user cost; **Low** = polish.

| ID | Sev | Problem | Evidence | Root cause | Fix |
|---|---|---|---|---|---|
| F-01 | Critical | CLS 0.302 / 0.591 / 0.221 (home / cart / checkout, mobile) | [M] attribution: `footer 567→0`, `623→0`, `161→385` | First paint is short: a streamed `BrandLoader` (min-h 50vh) or a client page that returns `null` until the store hydrates. The footer paints inside the viewport, then gets pushed | Reserve a viewport of height for `<main>` in the shell; render a skeleton instead of `null` in cart/checkout before hydration |
| F-02 | High | Canonical = homepage on cart, checkout, wishlist, track-order, order-confirmation, login, register, forgot-password, the 404s; titles "Asif Zone" | [V] audit JSON | `app/layout.tsx` sets `alternates.canonical: siteUrl`, inherited by every page without its own; the affected pages are client components and can't export metadata | Drop the root canonical (home and server pages set their own); add a `layout.tsx` with metadata per client route segment; `noindex` for private pages |
| F-03 | High | Raw Zod messages at checkout | [V] screenshot | `checkoutSchema` fields use `z.string().min(1)` with no message | Customer-facing messages in the shared schema (benefits the API's 400s too) |
| F-04 | High | Contact FAB covers content on mobile | [V] screenshots | `right-20` offset (a workaround for card collisions) puts it mid-content | Flush right (`right-4`) above the bottom nav; keep the existing overlap-ducking; hide while the on-screen keyboard is open (`data-hide-on-keyboard`) |
| F-05 | High | `ink-400` text ≈ 2.1:1 | [V] 144 usages | Default palette step 400 = #b3b3b3, used both as a text colour and as a "brass" fill | Re-value default `ink-400` → #707070 (4.95:1 on white, 4.66:1 on the #f8f8f8 canvas, 4.54:1 on ink-100); keep #b3b3b3 inside dark bands via `darkBandPalette`; re-point the 10 `bg-ink/brass-400` fills to semantic tokens |
| F-06 | Medium | 10–11 px text | [V] | hard-coded `text-[10px]` / `text-[11px]` | Floor at 11 px for numeric count badges, 12 px for words |
| F-07 | Medium | Brand duplicated in titles | [V] | stored `seoTitle` already ends with the store name, and the layout template appends it again | `storeTitle()` helper: use `absolute` when the title already contains the store name |
| F-08 | Medium | Listing heading skips (h1 → h3) | [V] | facet and card headings are `h3` with no `h2` | sr-only `h2` for "Filters" and "Products" landmarks |
| F-09 | Medium | Mobile listing header squeeze | [V] | title and sort share a row at all widths | Title full width; Filters + Sort on one toolbar row on mobile |
| F-10 | Medium | Sold-out size chips loud and illegible | [V] | red line-through on a pink fill | Neutral muted chip with a hairline diagonal; label text stays legible; keep `aria-disabled` and the "sold out" name |
| F-11 | Medium | Count badge low emphasis; Bag tab's name lacks the count | [V] | `bg-brass-400`; `aria-label={label}` | One `CountBadge` (accent fill); accessible name "Bag, 2 items" |
| F-12 | Medium | `product-404` title "Product" | [V] | fallback metadata | "Product not found" |
| F-13 | Low | Empty reviews message duplicated | [V] | two empty messages | One empty state with the CTA |
| F-14 | Low | Footer brand repetition; newsletter titled "Get in Touch" | [V] | footer composition | Remove the repeated tagline lines; default newsletter heading "Stay in the loop" (still overridable in settings) |
| F-15 | Low | Mobile breadcrumb wraps into 3 ragged lines | [V] `pdp-375-0` | crumbs wrap freely | Single line; middle crumbs truncate |
| D-01 | Medium | 2 failed 401 requests on every guest page view (`/customers/me` + refresh) | [V] network log | session cookies are httpOnly on the API origin, so the web can't know there's no session | **Deferred**: needs an API-set, non-secret session-hint cookie on a shared parent domain (auth change, separate review) |

---

## 5. Current design-system assessment

Strong: tokens are the single source of truth; semantic roles; brand themes without component branches; recipes for every repeated pattern; reduced-motion handled globally; focus ring sitewide; primitives wire `aria-describedby`/`aria-invalid`; dialogs trap focus. **[V]**

Weak points (all addressed in the foundation phase, as token changes rather than one-offs):

1. **`ink-400` serves two incompatible jobs**: a mid-grey *text* colour and (via the `brass` alias) a *fill* behind dark text. No single hex satisfies both, so the text role wins (F-05) and the fills move to roles that mean what they say (`accent`, `surface`).
2. **No text-size floor**: arbitrary `text-[10px]` exists in 6 storefront files.
3. **Page-level metadata isn't a system**: client routes have no metadata home (F-02).
4. **Loading states don't reserve space** (F-01).

## 6. Visual direction and tokens

Direction: keep the established Asif Zone language (neutral editorial: white and soft-grey surfaces, near-black type, Playfair titles over Inter, a single red accent reserved for promotions, pill controls). It suits a modest-fashion and fragrance catalogue whose photography is warm and busy, so the chrome should stay quiet. The changes are **legibility and rhythm**, not a new look: an Asif Zone customer should recognise the store, and Nasihamart must not change except where it shares a fixed defect.

Token changes (default theme only unless noted):

| Token | Before | After | Why |
|---|---|---|---|
| `palette.ink[400]` | #b3b3b3 | #707070 | 4.95:1 on white, 4.66:1 on #f8f8f8, 4.54:1 on ink-100 (#737373 was considered and rejected: 4.46:1 on the canvas). Large-text and UI-component uses (borders, icons) need only 3:1 and pass easily |
| default `darkBandPalette.ink[400]` | — | #b3b3b3 | dark sections keep their current light-grey captions (9.6:1 on #080808; #707070 would be only 4.0:1 there) |
| (no new colours) | | | |

Typography decision: **keep Inter + Playfair Display + Noto Sans Bengali.** Inter has excellent small-size legibility and broad Latin coverage, is self-hosted by `next/font` (no layout shift: `size-adjust` fallbacks), and is already tuned throughout. Playfair gives the editorial voice at display sizes only. Noto Sans Bengali covers ৳ and Bangla text per glyph. A font swap would add risk with no measured benefit. **[R]**

## 7. Page-by-page specification (what changes)

- **Shell:** `<main>` reserves `min-h-[100svh]` (F-01); count badges unified (F-11); bottom-nav labels 12 px; FAB placement (F-04).
- **Home:** CLS fix via the shell; cards inherit the contrast fix. Owner actions: mobile hero image, `itemCount` multiples of 4.
- **Category / search:** heading landmarks (F-08); mobile toolbar (F-09); count copy.
- **Product:** title fix (F-07); sold-out chips (F-10); reviews empty state (F-13); breadcrumb (F-15).
- **Cart / checkout:** skeleton before hydration (F-01); messages (F-03); metadata (F-02).
- **Auth / account:** metadata + `noindex` (F-02); verified signed in with a local test account.
- **Content pages:** already consistent; only shared fixes apply.
- **404s:** product-404 title (F-12).

## 8. Shared component architecture

- New `components/storefront/count-badge.tsx`: the one count bubble (header bag, bottom nav, sticky cart bar).
- `lib/seo.ts`: `storeTitle(title, storeName)` and `privatePageMetadata(title)` so every route's metadata goes through one place.
- No new primitives otherwise; reuse `Button`, `Skeleton`, `EmptyState`.

## 9. Functional improvements

Only fixes with verified need are planned. The 401 noise (D-01) is deferred because the fix is an auth-surface change. No new features (no fake recommendations or controls).

## 10. Accessibility, SEO, performance

- **A11y:** F-05, F-06, F-08, F-10, F-11. Verify with axe (`@axe-core/playwright` is already used by e2e? **[A]** checked during verification) and the audit script's small-text and unnamed-control counts.
- **SEO:** F-02, F-07, F-12. Verify canonical, title and robots per route from the audit JSON.
- **Performance:** F-01. Re-measure with `storefront-vitals.mjs` on a production build. JS bytes are reported as transferred, uncompressed body size **[V]** (the dev box serves without gzip), so they are compared like-for-like only.

## 11. Risks and assumptions

| Risk | Mitigation |
|---|---|
| Darker `ink-400` changes borders and placeholders (focus border, hover borders) | Visual check of forms; 3:1 UI contrast is the target there anyway |
| Nasihamart shares components | Token-only changes; Nasihamart defines its own `ink-400`; render `STORE_THEME=nasihamart` screenshots before claiming done |
| `min-h-[100svh]` on `<main>` adds space above the footer on short pages | Acceptable trade (the footer starts below the fold); content pages are taller than a viewport |
| Shared schema message changes reach the API | Messages only; validation rules unchanged; run API tests that assert on messages |
| Unmerged work in other worktrees touching the same files | This branch is off current `main`; changes are small and local |

Unresolved questions for the owner: none blocking. Owner content actions are listed in §1.

## 12. Implementation phases (dependency order)

1. **Foundation:** tokens (F-05), dark-band palette, fills to semantic roles, text floor (F-06), `CountBadge` (F-11).
2. **Shell:** CLS (F-01), FAB (F-04), bottom nav.
3. **SEO layer:** root canonical, per-route metadata, title helper (F-02, F-07, F-12).
4. **Checkout and cart:** messages (F-03), hydration skeletons.
5. **Listing and PDP:** F-08, F-09, F-10, F-13, F-15.
6. **Footer** (F-14).
7. **Verification:** lint, tsc, unit, API tests touching the schema, prod build, audit script, flow script, vitals, Nasihamart screenshots, report.

## 13. Task list

| Task | Pri | Problem / evidence | Solution | Affected | Risk | Verify | Status |
|---|---|---|---|---|---|---|---|
| T-01 | High | F-05 | ink-400 re-value + darkBandPalette + fills | ui-tokens, 8 components | Med | contrast calc, screenshots both themes | done |
| T-02 | Med | F-06 | text floor | promo-badge, footer, bottom-nav, search-overlay, product-card | Low | audit `tiny` count | done |
| T-03 | Med | F-11 | CountBadge + a11y name | cart-icon, mobile-bottom-nav, sticky-cart-bar | Low | screenshot, snapshot | done |
| T-04 | Crit | F-01 | main min-height; cart/checkout skeleton | storefront-shell, cart, checkout | Low | vitals CLS ≤ 0.1 | done |
| T-05 | High | F-04 | FAB placement | contact-widget | Low | mobile screenshots | done |
| T-06 | High | F-02 | metadata layer | layout.tsx + 12 segment layouts | Low | audit canonical/title/robots | done |
| T-07 | Med | F-07, F-12 | title helper | lib/seo, product + category pages | Low | audit titles | done |
| T-08 | High | F-03 | schema messages | shared order schema | Low | flow screenshot + API tests | done |
| T-09 | Med | F-08, F-09 | landmarks + mobile toolbar | category, search, facet components | Low | audit headings, screenshot | done |
| T-10 | Med | F-10 | sold-out chips | variant-option-pickers | Low | screenshot, e2e variant spec | done |
| T-11 | Low | F-13, F-15 | reviews empty, breadcrumb | product-reviews, breadcrumb | Low | screenshot | done |
| T-12 | Low | F-14 | footer | footer | Low | screenshot both themes | done |
| T-13 | — | D-01 | session hint | API auth | Med | — | deferred |

## 14. Test strategy and acceptance criteria

- **Static:** `pnpm --filter web lint` 0 errors; `tsc --noEmit` clean; web unit tests no new failures (baseline 42/44); `apps/api/src/config/theme-tokens.test.ts` passes (it checks theme contrast).
- **Build:** `next build` compiles (the Windows standalone-trace EPERM is a known, harmless environment quirk).
- **Browser:** the audit script at 375/768/1440 shows no new overflow, console errors or failed requests (beyond D-01 and the demo favicon); canonical correct on all 25 routes; tiny-text count down.
- **CWV:** CLS ≤ 0.1 on home, cart and checkout (mobile lab, 4× CPU).
- **Flows:** PDP → size → add to cart → drawer → cart → checkout validation (the flow script). Customer register → account pages. Nasihamart theme spot check.
- **E2E:** run the storefront specs that apply locally (`variant-picker-and-stock`, `storefront-existing-products`, `security-headers`) where the environment allows. Record exactly what ran.

## 15. Rollback

Every change is a frontend or token change on one branch; reverting a commit restores the previous behaviour. The only cross-package change (schema messages) changes strings, not validation rules.
