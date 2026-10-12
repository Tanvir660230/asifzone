# Asif Zone: Frontend Transformation Report

Branch `feat/storefront-transformation` (off `origin/main` 050ca3e) · worktree `C:/dev/asifzone-storefront` · **not committed or pushed yet**
Plan: `docs/ASIFZONE_FRONTEND_TRANSFORMATION_PLAN.md` (task statuses in §6 below).

## 1. Summary

The storefront already had a sound, token-driven, two-brand design system, so this was a targeted quality pass, not a rewrite. The investigation used the real catalogue: a local clone of the sanitized production mirror, 19 products and 57 images. It found six defects with user or business cost, all now fixed and verified:

| | Before | After | Evidence |
|---|---|---|---|
| Layout shift (CLS, mobile lab) | home **0.302**, cart **0.591**, checkout **0.221** | **0.000** on all 6 measured pages | `scripts/storefront-vitals.mjs`, prod build, median of 3 |
| Canonical URL | 9 routes (cart, checkout, wishlist, track-order, order status, sign-in, register, forgot-password, 404s) pointed at **the homepage** | Every indexable page canonical to itself; private pages titled and `noindex`, no canonical | `scripts/storefront-audit.mjs`, 25 routes × 3 widths |
| Page titles | "Asif Zone" on 12 routes; "… \| Asif Zone \| Asif Zone" on products | "Checkout \| Asif Zone", "Sign in \| Asif Zone", …; stored SEO titles no longer doubled | same |
| Checkout validation | "String must contain at least 1 character(s)"; an email like `a@b` blocked the order with **no message** | "Enter your full name", "Choose your area or thana", "Enter a valid email address, or leave it empty" | flow screenshots; `tests/checkout-messages.test.ts` |
| Tertiary text contrast | `ink-400` #b3b3b3: about 2.1:1, on 144 storefront text usages | #707070: 4.54–4.95:1 on every light surface; dark sections keep a light grey (9.6:1) | `theme-tokens.test.ts` (new contrast test) |
| axe WCAG 2.2 A/AA | not measured before | product, search, cart, checkout, track-order, login, FAQ: 0 violations; the remaining finds fixed (see §4) | axe-core 4.13 via Playwright |
| Floating contact button (mobile) | parked mid-screen (`right-20`), over product titles and checkout fields | in the right gutter above the bottom nav; lifts only while the sticky add-to-cart bar shows; hides while typing | screenshots |

## 2. What was investigated

- **Repository:** the monorepo layout, every storefront and account route (59 page/layout files), 74 storefront components, 37 UI primitives, the token package, the Tailwind plugin, the SEO helpers, cart/quote/checkout data flow, the auth refresh path, and the test infrastructure. Old docs were checked against code (e.g. `DESIGN_SYSTEM.md` matched the code).
- **Running app:** Next 15 dev and production builds against an isolated API (`:4620`, `LIVE_PROVIDERS=off`, own DB `storefront_demo` cloned from the demo mirror, own Redis index). Every public route was rendered at 375/768/1440 px. The real purchase path was driven (PDP → size → add to cart → drawer → cart → checkout → validation), and a throwaway customer was registered to audit all 10 account pages signed in.
- **Out of scope by decision:** the admin (`app/admin`). It is a separate product with its own surface tokens and an active Admin V2 programme; no admin rendering changed (the admin surface re-declares every token).

## 3. What changed (by area)

**Design tokens** (`packages/ui-tokens`, `apps/web/tailwind.config.ts`)
- Default `ink-400` #b3b3b3 → **#707070** (tertiary text now AA). #737373 was rejected: 4.46:1 on the canvas.
- New base `inverseBandVariables`, emitted under `.ui-band-inverse`: inside dark sections ink-400 stays #b3b3b3 and ink-500 becomes #8a8a8a (fine print was #666, 3.5:1). Theme band rules are more specific, so Nasihamart is unaffected. The default theme stays exactly the base tokens (an existing invariant test).
- Fills that used the grey behind dark text moved to semantic roles: count badges → `accent`; search-box submit → `accent`; quick-add hover → `surface`; hero-carousel active dot → `cream-50`.

**Shell** (`storefront-shell`, `mobile-bottom-nav`, `sticky-cart-bar`, `sticky-add-to-cart`, `contact-widget`)
- `<main>` is at least one viewport tall, so streamed or hydrated content can't push the footer through the viewport (the CLS fix).
- One `CountBadge` (with `bagLabel()`): the bag control's accessible name now includes the count ("Bag, 2 items").
- The on-screen-keyboard flag (an existing admin hook) is now mounted on the storefront; the bottom nav, sticky cart bar and contact button step aside while typing.
- Contact button: flush right; `[html[data-sticky-atc]_&]` lifts it only while the sticky add-to-cart bar is visible.
- Bottom-nav labels 11 → 12 px; inactive labels `ink-600` (they sit on translucent glass).

**SEO** (`app/layout.tsx`, `lib/seo.ts`, 13 new segment `layout.tsx` files, product/category pages, account layouts)
- Removed the root canonical that leaked to every page without its own.
- `privatePageMetadata(title)` for cart, checkout, wishlist, order status, payment, all sign-in/registration pages, the account shell and the invoice. Track-order is public with a self canonical.
- `storeTitle()` stops "… \| Asif Zone \| Asif Zone"; product/category 404 titles say "not found".

**Checkout** (`packages/shared` order schema + `common.ts`, `checkout/page.tsx`)
- Customer-facing messages on every checkout field; name and address are trimmed, so a field of only spaces now counts as empty. **This is the one validation-rule change**, and it is deliberate.
- The email field now renders its error (it had none).

**Listing and product pages**
- Category header: the title takes the full width on phones, with sort beneath it.
- Stock line reads "16 products · 14 in stock" (was "14 of 16 products in stock").
- Screen-reader `h2` landmarks ("Refine", "Products") on category and search, so headings no longer skip from h1 to h3.
- Unavailable sizes and colours: a dashed outline with a thin strike-through; the value stays readable and there's no red (sold-out is information, not an error). Accessible names are unchanged.
- Breadcrumb: `<nav aria-label="Breadcrumb">` + `<ol>` + `aria-current`, on one line; the current page truncates.
- Reviews: removed the duplicate "No reviews yet" box.
- Pagination: dimmed Previous/Next carry `aria-disabled`.
- Carousel eyebrow `brass-300` → `fg-muted`; sale-coloured **text** (`flash sale ends in`, `selling fast`) → `sale-600` (5.3:1). Badge fills are unchanged.

**Footer, content pages, text sizes**
- Newsletter default heading "Get in Touch" → "Stay in the loop" (still overridable in settings).
- Removed the third repetition of the tagline.
- Privacy and Terms section numbers `ink-300` → `ink-400`.
- Text floor: 12 px for words; 11 px only for compact badges (discount badges were 10 px).

**Docs and tooling**
- `docs/DESIGN_SYSTEM.md`: grey-text rules, text floor, `CountBadge`, the page-metadata pattern, and the reserve-space rule.
- Four reusable audit scripts in `apps/web/scripts/`: route audit, viewport slices, purchase-flow capture, lab vitals.

## 4. Tests actually executed

| Check | Result |
|---|---|
| `tsc --noEmit` (web, api) | clean |
| ESLint on changed storefront code; `next build` lint/type pass | 0 errors |
| `next build` (production) | compiled. The Windows standalone-trace `EPERM` at the very end is a known local environment quirk; `BUILD_ID` produced |
| Web unit (Vitest) | **49/51**. The 2 failures are pre-existing admin tests on `main` (`navigation.test.ts`, `status-registry.test.ts`), the same as baseline 42/44. 7 new tests pass |
| API `theme-tokens.test.ts` | 6/6 (incl. the new contrast test) |
| API order integration tests (`order`, `manual-order-confirm`, `order-adjustments`) on an isolated Postgres container | 58/58 |
| API full suite on the isolated container | **1461/1461** after one fix (see §4a) |
| Playwright e2e against the local prod build (desktop + Pixel 7): `customer-accounts`, `security-headers`, `storefront-existing-products`, `variant-picker-and-stock` | **32 passed, 2 skipped** (viewport-specific tests skipped on the other viewport by design). Includes a real COD order and a stock drop, and zero CSP violations |
| Route audit, 25 routes × 375/768/1440 | 0 horizontal overflow; correct status codes (404s are real 404s); canonical/title/robots as specified; no console errors beyond the expected (see §5) |
| axe-core WCAG 2.2 A/AA, 20 routes × 2 widths, with an item in the bag | **0 violations in 40 page scans** (final build; see §4b) |
| Nasihamart (`STORE_THEME=nasihamart`, same build) | home, PDP, category and footer render with its own palette, fonts and stone accents; no regressions seen |

### 4a. API full suite
The first full run (isolated Postgres container, own Redis index, `INSTALL_ID`/`REVALIDATE_SECRET` blanked as for any worktree) gave 1460/1461. The failure was `store-identity.guard.test.ts`: my doc comment in `apps/web/lib/seo.ts` used the real store name as an example. I made it brand-neutral (`<Store>`), and the guard now passes 5/5. All other 1460 tests passed.

### 4b. Final axe run
The first scan after the main changes found 5 pre-existing contrast problems: the home carousel eyebrow in `brass-300`; dimmed pagination not marked disabled; sale-coloured small text at 4.26:1; Privacy/Terms section numbers in `ink-300`; bottom-nav labels on translucent glass. All five are fixed. The final production build scanned 20 routes at 375 and 1440 px: **0 violations**. The e2e specs were re-run on that same final build: 32 passed, 2 skipped.

## 5. Remaining issues, blockers, deferred work

| Item | Why it isn't done | Next step |
|---|---|---|
| Two 401 requests (`/customers/me` + refresh) on every guest page view | Session cookies are httpOnly on the API origin, so the web can't know there's no session. The fix is an API-set, non-secret session-hint cookie on a shared parent domain: an auth change that deserves its own review | Small API + `apiFetch` change, behind review |
| React hydration warning (#418) on a **full page load of `/account/reward-points`** (signed in) | Not touched by this branch. Only that route triggers it, while the shared header/cart icon render on every page, so it is inferred to be pre-existing (not proven against a baseline build) | Reproduce in `next dev` to get the unminified message |
| Mobile hero banner text unreadable at 375 px | Content: a desktop banner with baked-in text. `mobileImageUrl` is already supported | Owner uploads a 1:1 mobile crop in Admin › Banners |
| Duplicate size facets ("2XL 23.5" vs "2XL/23.5") | Inconsistent variant values in the catalogue | Normalise in Admin › Products |
| Product page stacks 5 recommendation rails; "Featured" shows 9 items in a 4-column grid | Admin-configured | Keep 2–3 rails; use 8 or 12 items |
| Demo favicon / logo URLs `http://localhost:4000/...` | An artifact of the demo mirror (fixed only in my local clone) | none for prod |
| Admin redesign | Separate Admin V2 programme | — |
| Lighthouse / field CWV | Lab measurements only (Playwright + 4× CPU); no field data | Check CrUX / Search Console after deploy |

Performance notes, stated plainly: CLS went to 0 everywhere. LCP and long-task times moved within run-to-run noise (e.g. cart LCP 928 → 1060 ms, home 1016 → 860 ms), so no LCP improvement is claimed. JS bytes are uncompressed body sizes on a local server and dropped about 19 KB per page; that drop was not targeted and is not attributed to a specific change.

| Page | LCP ms (before → after) | CLS | Long tasks ms | JS KB |
|---|---|---|---|---|
| home | 1016 → 860 | 0.302 → 0 | 219 → 217 | 866 → 847 |
| category | 256 → 248 | 0 → 0 | 167 → 172 | 888 → 869 |
| product | 340 → 336 | 0 → 0 | 251 → 263 | 899 → 880 |
| search | 768 → 792 | 0 → 0 | 158 → 191 | 890 → 871 |
| cart | 928 → 1060 | 0.591 → 0 | 158 → 201 | 882 → 863 |
| checkout | 760 → 744 | 0.221 → 0 | 183 → 180 | 943 → 925 |

## 6. Plan task status

| Task | Status |
|---|---|
| T-01 contrast tokens + fills | done |
| T-02 text floor | done (11 px kept only for compact badges, by rule) |
| T-03 CountBadge + accessible name | done |
| T-04 CLS | done (0.000) |
| T-05 contact button | done |
| T-06 metadata layer | done |
| T-07 title helper + 404 titles | done |
| T-08 checkout messages (+ the missing email error) | done |
| T-09 landmarks + mobile listing header | done |
| T-10 unavailable-option chips | done |
| T-11 reviews empty state, breadcrumb | done |
| T-12 footer | done |
| T-13 guest 401s | deferred (auth change) |
| Added during verification | axe finds: pagination `aria-disabled`, carousel eyebrow, sale text, policy numbering, bottom-nav label contrast; done |

## 7. Files changed

New: `apps/web/components/storefront/count-badge.tsx`, `apps/web/lib/seo.test.ts`, `apps/web/tests/checkout-messages.test.ts`, 13 segment `layout.tsx` files under `app/(storefront)/{cart,checkout,wishlist,order-confirmation,pay,track-order}` and `app/account/(auth)/{login,register,forgot-password,reset-password,verify-email,claim,unsubscribe}`, `apps/web/scripts/storefront-{audit,shots,flow-shots,vitals}.mjs`, this report and the plan.

Modified: `packages/ui-tokens/src/index.{js,d.ts}`, `packages/shared/src/schemas/{order,common}.ts`, `apps/api/src/config/theme-tokens.test.ts`, `apps/web/tailwind.config.ts`, `apps/web/app/layout.tsx`, `apps/web/lib/seo.ts`, `app/(storefront)/{checkout,search,privacy-policy,terms}/page.tsx`, `app/(storefront-detail)/{category,product}/[slug]/page.tsx`, `app/account/{(shell),(invoice)}/layout.tsx`, and storefront components: `breadcrumb`, `cart-icon`, `category-stock-panel`, `contact-widget`, `footer`, `hero-carousel`, `mobile-bottom-nav`, `pagination`, `product-card`, `product-carousel`, `product-reviews`, `product-showcase`, `promo-badge`, `quick-view-modal`, `search-box`, `search-overlay`, `sticky-add-to-cart`, `sticky-cart-bar`, `storefront-shell`, `urgency-signals`, `variant-option-pickers`; `docs/DESIGN_SYSTEM.md`.

## 8. Recommended next steps

1. Review and commit this branch; open a PR to `main` (merging `main` auto-deploys Asif Zone; Nasihamart then needs its deploy).
2. Owner content actions from §5 (mobile hero image, size values, rail count, featured item count).
3. The session-hint cookie to remove guest 401s (with a security review).
4. Look into the reward-points hydration warning.
5. After deploy, confirm CLS in field data (Search Console › Core Web Vitals).

---

## Round 2: premium redesign (owner request: "more premium, world-class motion, smart features, never slow")

Design read: a premium-consumer storefront (modest fashion and fragrance) for mobile-first Bangladeshi shoppers. The brand stays; the composition and motion are redesigned. Brand tokens, Inter + Playfair and lucide icons are kept, there is no dark mode (project rules), and Nasihamart is restyled only through its tokens.

### Redesigned
| Area | Before | After |
|---|---|---|
| Homepage product sections | each "carousel" rendered a full grid of up to 24 products (home was 9 desktop / 11 phone viewports tall) | product rails: snap-scrolling, exactly 4 per desktop row, a peeking card on phones, arrow controls that disable at the ends, "View all" to the real listing. Home is now 6 / 7 viewports |
| Category section | equal tiles with a dark scrim title duplicating the lettering in the artwork | editorial bento: two wide feature tiles then balanced rows, equal row heights from the column span, exactly one cell per category (unit + e2e tested), a "Name ↗" pill as the action |
| Product card | titles of different heights (prices misaligned across a row); round quick-add icon | 2-line title slot, so every price in a row sits on one baseline; desktop quick-add is a full-width "Quick add" / "Choose options" bar that slides up on hover or focus |
| Trust strip | tiny caps captions in a 2×2 grid | readable promises with icon wells; a swipeable row on phones, an evenly divided band on desktop |
| Values | four identical boxed cards | editorial two-column list with hairlines, the heading pinned beside it on desktop |
| Brand story | centred block, outlined button | large left-aligned statement, a solid action button, and a split layout when there is a photograph |
| Footer | boxed link cards, repeated logo, newsletter in the middle | newsletter row, brand + contact beside three link columns, one bottom bar (payments, copyright, legal); much shorter |
| Header | always pinned | tucks away while scrolling down, returns on the first scroll up, never while focus is inside it; flat at the top, edge shadow once scrolled |
| Product page | standard two columns | the gallery stays in view on desktop while the details scroll; larger price with "% off"; share button |

### Smart features (all from real data, nothing invented)
- **Delivery estimate on the product page:** "Order today: Inside Dhaka Mon 12 Oct - Tue 13 Oct, Elsewhere Wed 14 Oct - Fri 16 Oct". This is the same shared `estimateDelivery` rule the checkout uses, computed after mount so server and browser clocks can't disagree.
- **Share:** the phone's native share sheet (WhatsApp, Messenger…), or a copied link on desktop.
- **Sticky Filters + Sort bar on phone listings:** stays pinned under the header while you scroll the grid, moves up when the header tucks away, and shows the active filter count.
- **Scroll-aware header** (above), and a **bag-count bump** when an item is added.
- Not built, deliberately: a "spend X more for free delivery" bar. The store has no free-delivery threshold setting, so it would be fake.

### Motion, and why it stays fast
- Section and card entrances are **scroll-driven CSS** (`.ui-reveal`, `animation-timeline: view()`): zero JavaScript, nothing hidden before hydration, transform and opacity only. Browsers without support, and anyone with reduced motion, see content in place. Framer Motion was removed from the product grid, product rails, category grid, values and brand story.
- Hover and press feedback are CSS transitions. The header uses Motion's single scroll value and changes state only when the direction flips.

### Verified (production build, local stack)
| Check | Result |
|---|---|
| Lab vitals, mobile, 4× CPU, median of 3 | CLS **0** on all 6 pages. Long-task time fell on 5 of 6 pages (home 217 → 139 ms, search 191 → 126, cart 201 → 150, checkout 180 → 145; product 263 → 264). Home LCP 860 → 728 ms (lab noise is about ±150 ms, so this is not claimed as a win) |
| e2e (desktop + Pixel 7) | 32 passed, 2 skipped (viewport-specific); the category-grid test was rewritten for the new layout contract and passes |
| Web unit | 52/54. The same 2 pre-existing admin failures; 3 new bento-layout tests pass |
| axe WCAG 2.2 A/AA, 20 routes × 2 widths | **0 violations with reduced motion.** With motion on, axe flags only cards still waiting below the fold for their reveal (it evaluates off-screen elements at their pre-reveal opacity). Fixed along the way: footer link target size, keyboard-scrollable trust row |
| Route audit 25 × 3 widths | no horizontal overflow anywhere |
| Nasihamart (`STORE_THEME=nasihamart`) | renders through its own tokens (captions below photos, light story band, navy actions, its fonts) |
| tsc, ESLint | clean |

Retired tokens (no longer used by any component): `--tile-scrim`, `--tile-label`, `--story-media-max-w`, `--story-media-h-sm`, and the `.ui-tile-grid` recipe.

### Owner content that would lift it further
- A **mobile hero image** (1:1, without baked-in text): the hero is the first impression and is still a desktop banner on phones.
- Optionally a **brand-story photograph**: the band switches to its split editorial layout automatically.
- Clean up duplicate size values ("2XL 23.5" / "2XL/23.5").

## Round 3: smart features (2026-10-11)

The owner picked items 2–9 from the recommendation list (the Bangla/English toggle was left out). Each one uses data the store already has; nothing is invented.

| # | Feature | What the shopper sees | How it works |
|---|---|---|---|
| 2 | Delivery fee on the product page | "Inside Dhaka · ৳60 delivery · Mon 12 Oct - Tue 13 Oct", the same for elsewhere; "Free delivery" on free-delivery products | Store settings `shippingFeeDhaka` / `shippingFeeOutsideDhaka` (the reconciled mirrors of the two delivery zones). The checkout quote stays the amount charged |
| 3 | Order on WhatsApp | A button under Add to Cart opens WhatsApp with the product, the chosen size/colour, quantity and the page link already written | The store's active WhatsApp social link; hidden when it has none. No prices in the message, so a stale page can't promise one |
| 4 | Best coupon applied automatically | "Best coupon applied for you: CODE · you save ৳100", with **Remove** | The existing server `/coupons/best` evaluation, now applied instead of only suggested. Removing it, or entering a code yourself, stops auto-apply for that checkout; if the bag changes and the coupon no longer applies, it is let go quietly |
| 5 | Installable app | Home-screen install card after an order and in the account; an offline page in the store's name and colours | `app/manifest.ts` (name, icon, theme colours from settings and brand tokens), `/offline` route, `public/sw.js` now caches **only** the offline page (navigations go to the network first). iOS Safari gets the two-tap Share instructions |
| 6 | Photo reviews | Up to 4 photos in the review form; thumbnails with a viewer on approved reviews; photos shown to admins in moderation before approval | New `POST /api/reviews/images` (signed-in customers, rate limited, magic-byte checked, re-encoded to WebP, which strips camera GPS metadata). `ProductReview.images` (migration `20261104100000_review_images`). The schema accepts only the store's own `/uploads/reviews/<uuid>.webp` references. Abandoned uploads are picked up by the existing unused-upload cleanup |
| 7 | "You usually take M" | A dot on the size you took last time and a one-tap hint; never pre-selected | Sizes put in the bag on this device (`localStorage`, nothing sent anywhere), matched against what this product has in stock |
| 8 | Buy again | "Welcome back, <name> · Buy again" on the homepage for signed-in customers | New `GET /api/customers/me/buy-again`: products from delivered orders, newest first; the storefront shows only those in stock. Guests see nothing |
| 9 | Complete your order | A rail under the cart total with quick-add | Bundle products for what's in the bag first (they unlock its saving), then "frequently bought together" for the latest items; nothing already in the bag or sold out |

### Verified
| Check | Result |
|---|---|
| API (new) | `buy-again` 2/2, `review-photos` 6/6 (schema rules, 401 for guests, upload stored as WebP reference, non-image refused, photos public only after approval) |
| API full suite | **1469/1469** (143 files), including the 8 new tests |
| Web unit | 64/66: the same 2 pre-existing admin failures as main; new tests for WhatsApp message, size memory, cart suggestions, theme colours |
| e2e storefront specs (desktop + Pixel 7) | 32 passed, 0 failed, 16 skipped (each spec's own conditions: no pixel ID in this build, desktop- or phone-only tests) |
| Walkthrough at 390 px and 1280 px (`scripts/storefront-smart-shots.mjs`) | every feature present and working, zero console errors. Auto-coupon was checked with a temporary local coupon, deleted afterwards |
| tsc (web, api), ESLint on changed files | clean (one existing warning on the admin reviews table) |

## Round 4: existing-site audit — stock visibility, mobile, fonts (2026-10-11)

Measured with `scripts/storefront-type-audit.mjs` (18 routes × 375/1280 px: rendered font families, text under 12px, overflow, clipped text) and `scripts/storefront-stock-shots.mjs` (sold-out states + a mobile sweep).

| Finding | Fix |
|---|---|
| A sold-out size was disabled, so "Notify me when back in stock" could never be reached for it | On the product page sold-out sizes/colours stay crossed out but can be picked: the button reads **Sold out** and a full-width **Notify me when back in stock** appears. The buying popup still offers only what can be bought |
| Sold-out size pills were faint (pale text, thin strike) | Muted fill, dashed outline, darker 1.5px strike; a line under the sizes explains it |
| Sold-out product cards still showed "54% OFF" and looked like any other card apart from a small label | Discount/low-stock badge hidden, photo dimmed, centred **Sold out**, price muted, no strike price |
| Nothing on a card said most sizes were gone | "2 of 6 sizes left" when some sizes are sold out (a state, never a unit count) |
| The chat button covered the right end of full-width product-page buttons | Those buttons are marked as collision areas and the overlap check also runs when buttons appear (not only on scroll) |
| A light strip under the dark footer on phones (the bottom-bar spacer used the page background) | The spacer is painted as the footer band, so it follows whatever colour a theme gives the footer |
| The "% off" badge was the only text under 12px | 12px |

Fonts: every page renders exactly two families — the display serif for headings and Inter for everything else; no font failed to load; after the fixes, no text under 12px, nothing clipped and nothing wider than the screen on any audited route at 375 or 1280 px.

For the owner (data, not code): fragrance names are typed in ALL CAPS ("SWEET LUXE") while caps use Title Case; size values are duplicated in two spellings ("2XL 23.5" / "2XL/23.5"), which doubles the size filter.

Verified: e2e (variant picker & stock, existing products, store config) 26 passed / 0 failed / 6 skipped by design; web unit 64/66 (the 2 pre-existing admin failures); ESLint clean on changed files.

## Round 6: one site, page to page (2026-10-12)

Owner brief: analyse every page; one consistent look; no loading shown; every page should feel part of the same site, not a different size each time. Measured with `scripts/storefront-consistency.mjs` (28 storefront and account pages, in-app navigation from the homepage, 390 and 1280 px).

| Measured before | After |
|---|---|
| Page title sizes: 24 / 30 / 36 / 40 px (phone), 25.5 / 32 / 38 / 51 / 64 px (desktop) | One size on every page: 30 px phone, 42.5 px desktop (the product page keeps its product-title style) |
| Title left edge on desktop: 34 / 62 / 71 / 266 / 300 / 471 / 505 / 538 px | 34 px on every page (68 px on sign-in pages, where the title sits inside the form card) |
| Distance from header to title: 32–358 px | One value within each page type: 77 px desktop / 56 px phone for storefront pages |
| Content widths: 768 / 896 / 1152 / 1280 px, many centred | One 1280 px frame; narrower content (prose, forms) starts at its left edge |
| Loading between pages: skeleton (search, 8 account pages), spinner + "Loading" (track order, wishlist), blank page (bag, checkout before the stored bag is read) | None on any page at either width; the account prefetches its sections' data |
| Sign-in / register had no site header or footer; the account had its own header and footer, without the bag drawer (the bag icon did nothing there), bottom nav or contact button | Both inside the regular storefront shell |

What changed:
- `StorefrontPage` + `StorefrontPageHeader` on every page: category, search, bag, checkout, wishlist, track order, contact, FAQ, shipping & returns, privacy, terms, order confirmation (all states), payment link and result, the 404s, sign-in/register/password pages and the account. `PageHero` and the per-page centred columns are gone.
- Page title token raised to 1.875rem / 2.5rem in the base theme (Nasihamart already used about this).
- Bag page: two columns on desktop (items, then a sticky summary), like checkout. FAQ and track order: a help panel beside the content on desktop. Sign-in pages: what an account gives you, beside the form.
- 24 route `loading.tsx` files removed; `NavigationProgress` added; `.ui-skeleton` / `.ui-delayed` held back 0.3s; `AccountPrefetch`.
- Fixed while testing: after logging out the browser replayed a prefetched "signed in → /account" redirect and stayed in the account; sign-out, sign-in, sign-up and account claim now finish with a full page load, and `?next=` only accepts paths on this site (it accepted any URL).

Verified: e2e 46 passed / 0 failed (storefront, customer accounts, order adjustments, security headers, pixels; 18 skipped by design; three tests now use an exact "Email" label because the footer's newsletter field is on the sign-in page too); purchase journey at 390 and 1280 px, zero console errors; layout audit (overflow, clipped text, text under 12px, fonts) clean on 18 pages at both widths; web unit 64/66 (the 2 pre-existing admin failures).
