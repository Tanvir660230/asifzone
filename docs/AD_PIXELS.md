# Ad pixels (Meta + TikTok)

The storefront reports shopping events to Meta and TikTok through one layer, `apps/web/lib/pixels/`. Components never
call `fbq` or `ttq` themselves.

```text
business action (cart store, checkout, confirmation page, …)
        ↓
lib/pixels/index.ts      typed pixel* helpers: gating, repeat guards, one event id per event
        ↓
lib/pixels/meta.ts       → fbq   (+ server-side Conversions API for Purchase: apps/api/src/lib/meta/)
lib/pixels/tiktok.ts     → ttq   (typed TikTokEventProperties, official base code port)
```

| File | Role |
| --- | --- |
| `index.ts` | Public API (`pixelPageView`, `pixelViewContent`, `pixelSearch`, `pixelAddToCart`, `pixelInitiateCheckout`, `pixelAddPaymentInfo`, `pixelPurchase`, `pixelCompleteRegistration`, `pixelContact`). It decides once whether an event fires, then fans it out to every configured provider. |
| `types.ts` | Platform-neutral `PixelEvent` union and the `PixelProvider` interface. |
| `meta.ts`, `tiktok.ts` | Providers. They only translate. Each is inert until its pixel id is set at build time. |
| `guards.ts` | Repeat suppression (burst window, once per tab/browser) and event-id minting. |
| `consent.ts` | The single consent gate: the shopper's stored choice from the consent banner (see below). |
| `debug.ts` | Console trace of each decision (see Debugging). |
| `components/analytics/ad-pixels.tsx` | Fires PageView on first load and on every client-side route change. |

## Where each event fires

| Event | Trigger | Data |
| --- | --- | --- |
| PageView | `<AdPixels />` in the root layout, once per pathname | — |
| ViewContent | Product page mount (`TrackProductView`) | product id (`product_group`), name, price, BDT |
| Search | Search results page (`SearchSessionTracker`) | `search_string` |
| AddToCart | `useCartStore.addItem`, **after** the cart changed, with the quantity that actually landed (stock clamp), plus Buy Now | variant id, name, qty, price, value, BDT |
| InitiateCheckout | Checkout page with a rehydrated, non-empty cart; once per distinct cart per tab | cart lines, value, BDT |
| AddPaymentInfo | After the API **accepted** the order (COD placed or gateway session opened); once per cart per tab | cart lines only; no payment method or details go to TikTok |
| Purchase | Order confirmation page, from the order **as the API returns it**: COD not cancelled, or an online payment the gateway marked PAID, created < 24h ago | order number, lines (variant id, name, qty, price), order total, BDT |
| CompleteRegistration / Contact | Email sign-up / contact form, WhatsApp, call | — |

TikTok naming follows TikTok's current spec: `Purchase` is the current name for the legacy `CompletePayment`, and Search
uses `search_string`. Currency comes from store settings (`getStoreConfig()`), never from code.

## Duplicate protection

- **PageView**: one per pathname. TikTok's SDK also tracks SPA history changes itself and dedupes an explicit
  `ttq.page()` for a URL it already counted (verified in `e2e/ad-pixels.spec.ts`).
- **React Strict Mode / remounts**: identical calls within 2s are dropped (`firedJustNow`).
- **InitiateCheckout / AddPaymentInfo**: once per cart contents per tab session (sessionStorage).
- **Purchase**, in three layers:
  1. it fires only for an order the backend reports as really completed;
  2. once per order per browser (localStorage `pixels:purchase:<orderNumber>`), which covers refresh, back button,
     revisits and a second tab;
  3. a deterministic `event_id` = `purchase_<orderNumber>` (shared `metaPurchaseEventId`), so a copy that slips past
     layer 2 (cleared storage, another device) is deduplicated by Meta/TikTok within 48h. That is also why it never
     fires for orders older than 24h.
- Gateway callbacks and webhooks never fire browser events; only the confirmation page does.

## Event ids and server-side tracking (future)

Every business event carries one id shared by all platforms (Meta `eventID`, TikTok `event_id`). TikTok and Meta
dedupe a browser event against a server event with the same event name and id within 48h.

To add the **TikTok Events API** later:

1. Add `apps/api/src/lib/tiktok/` alongside `lib/meta/`, sending `Purchase` at order creation/settlement, as Meta's
   Conversions API already does.
2. Use `event_id: metaPurchaseEventId(order.orderNumber)` (it's platform-neutral despite the name) so the browser
   and server copies collapse into one.
3. Hashed matching keys (SHA-256 of trimmed, lower-cased email; E.164 phone) belong there, server-side, per TikTok's
   spec. The browser layer deliberately sends no PII and doesn't call `ttq.identify`.

For other events, pass the browser's id to the server (for example in the checkout payload) and reuse it.

## Consent

Nothing is tracked until the shopper allows it. `components/analytics/tracking-consent-banner.tsx` asks once (only
when a pixel id or `NEXT_PUBLIC_CLARITY_ID` is configured, never on admin/preview screens) and stores the answer in
this browser (`localStorage` `az_tracking_consent_v1`); the footer's "Tracking preferences" link reopens it.
`hasAdTrackingConsent()` in `consent.ts` returns true only for a stored "granted" — no decision, a decline or blocked
storage all mean no tracking. Every event is gated there **before** any script is downloaded or any once-guard is
used, and Clarity (`lib/pixels/clarity.ts`) uses the same gate. Allowing fires the PageView for the current page;
withdrawing an earlier consent reloads the page so no loaded pixel keeps running. First-party analytics
(`PageViewTracker`) and the live-chat widget are not gated. Bump the storage key's version to ask everyone again.

The scripts load under the nonce-based Content-Security-Policy (`lib/security/csp.ts`): they are created from our
bundle, so `'strict-dynamic'` trusts them, and their beacon hosts are in `connect-src`. A new provider needs its
beacon/iframe hosts added there.

## Configuration

| Variable | Where | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_TIKTOK_PIXEL_ID` | GitHub Actions secret → `docker/.env` → web build arg | e.g. `DB1ATB3C77U04C8M0SK0`. Public id. Blank = TikTok fully inert. |
| `NEXT_PUBLIC_META_PIXEL_ID` | same path | Also reused as the API's `META_PIXEL_ID`. |

`NEXT_PUBLIC_*` values are **inlined at build time**, so after changing one you must redeploy (rebuild the web image).
Setting it on a running container does nothing.

**Production setup:** GitHub → repo Settings → Secrets and variables → Actions → New repository secret
`NEXT_PUBLIC_TIKTOK_PIXEL_ID`, or:

```sh
gh secret set NEXT_PUBLIC_TIKTOK_PIXEL_ID --body DB1ATB3C77U04C8M0SK0 --repo Tanvir660230/asifzone
```

The deploy job writes it into `docker/.env`, and `docker-compose.yml` passes it to the web build. For local dev,
leave it blank in `apps/web/.env.local` so test browsing never reaches the real pixel.

## Debugging and verification

**Console trace.** In development every decision is logged as `[pixels] …` (sent → which providers, suppressed as a
repeat, skipped). In production it's silent unless you opt in for your own browser:

```js
localStorage.setItem("pixels:debug", "1")   // then reload; removeItem to turn off
```

**Pixel loaded:** DevTools → Network → filter `analytics.tiktok.com`. You should see `events.js?sdkid=<your id>` once
per page load. Install the *TikTok Pixel Helper* Chrome extension for a per-page event list.

**Events:** in Network, each `api/v2/pixel` POST's payload shows `"event"`, `"event_id"` and `"properties"`.

| Check | Expected |
| --- | --- |
| Home | one `Pageview` (TikTok also sends its own `LandingPageView`, which is normal) |
| Product page | one `Pageview`, one `ViewContent` (`content_type: product_group`) |
| Add to cart | one `AddToCart` after the drawer opens, with the variant id and quantity |
| Checkout | one `InitiateCheckout`; refreshing doesn't add another |
| Place order | one `AddPaymentInfo` |
| Confirmation | one `Purchase`, `event_id = purchase_<order number>`, `order_id`, total, `BDT` |
| Refresh confirmation | no new `Purchase`, and the console trace says `suppressed — already sent` |

**TikTok Events Manager:** Assets → Events → Web events → your pixel → *Test events*. Open the site from there (or
scan the QR code), walk the funnel, and watch events arrive live. *Overview / Diagnostics* flags missing parameters
and duplicate events. Real-traffic reporting lags by up to about an hour.

**Detecting duplicates:** the same `event_id` twice in Network, two `Purchase` rows for one order in Test events, or a
duplicate warning in Diagnostics. The console trace shows why an event was or wasn't sent.

**Automated:** `apps/web/e2e/ad-pixels.spec.ts` runs the whole funnel against the real TikTok SDK while intercepting
every beacon locally (nothing reaches TikTok). It needs a build with both pixel ids set (any values) and is skipped
otherwise:

```sh
NEXT_PUBLIC_TIKTOK_PIXEL_ID=DB1ATB3C77U04C8M0SK0 NEXT_PUBLIC_META_PIXEL_ID=1234567890 pnpm --filter web build
pnpm --filter web start:e2e   # with the API on LIVE_PROVIDERS=off, as for every e2e run
pnpm --filter web test:e2e -- e2e/ad-pixels.spec.ts
```

It places one COD test order and looks it up a few times. The API's order-tracking limit is 20 lookups / 10 min, so
don't loop it many times in a row.
