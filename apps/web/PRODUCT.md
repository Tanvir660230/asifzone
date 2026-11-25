# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Shoppers in Bangladesh, mostly on phones.** Most arrive from Facebook / TikTok ads (and Messenger, WhatsApp, Instagram
  chats) onto an ad landing page (`/lp/…`) or a product page, and order Cash on Delivery. Every order is confirmed by a
  phone call before it ships. They type addresses the local way — smallest place first, then thana, then district — in
  Bangla or English, and often skip optional fields.
- **The owner and a small staff team** run each store from the admin, mostly on phones: confirming orders by call,
  booking the courier (Steadfast), packing and dispatch, returns and exchanges, stock and purchasing, and the books
  (finance). The owner works in Bangla; staff-facing screens are English.

## Product Purpose

One commerce codebase installed three times — **Asif Zone**, **Nasihamart** and **Tahafi** (`STORE_THEME=default` /
`nasihamart` / `tahafi`), each with its own database, content and look. Each installation is a storefront plus an
order-to-cash back office: catalogue, checkout, landing pages for ads, order operations, courier, stock, manufacturing
and accounting. Success is an order that is confirmed, delivered and not returned, booked correctly in the shop's books.

- **Asif Zone:** attar / perfume, prayer caps and clothing.
- **Nasihamart:** a food and organic-products shop.
- **Tahafi:** premium clothing; men's ranges now (jackets, panjabi), women's later — brand-level copy must not say
  "menswear only".

## Operating Context

- Orders: COD by default (bKash / Nagad / card via EPS and SSLCommerz also offered); confirmation call → courier booking by
  staff → delivery or return. Incomplete checkouts are kept as leads for a call-back.
- Delivery is priced by zone (Dhaka district vs. the rest of the country, store data, not code). District and thana are
  optional at checkout; the address is read for them, and staff fix the rest on the call.
- The admin runs on phones as much as on desktops; finance and stock pages carry real money and stock numbers.
- The source of truth for rules is `docs/BUSINESS_DECISIONS.md`; the platform map is `docs/MASTER_SYSTEM_INVENTORY.md`.

## Capabilities and Constraints

- **One language per page:** the website (product pages, cart, checkout, account) is English; the ad landing pages are
  Bangla. Never mix the two on one page.
- **Admin is light only** (no dark mode), calm and Apple-like.
- **One codebase for three stores:** a shared change ships to all three; a brand-only look goes in that theme's tokens,
  never `if (brand === …)`; Asif Zone's look stays as it is unless a change is meant for it.
- **Never change live selling prices** on your own — report or suggest only.
- **Never send an order to the courier automatically** — staff book it.
- **Never force finance or stock values** — numbers come from what the owner and staff enter.
- Every screen handles loading, empty and error states and works at 375px.

## Brand Commitments

- Three separate brand identities on one design system (`docs/DESIGN_SYSTEM.md`, tokens in `packages/ui-tokens`).
  Brand files: `docs/brand/nasihamart/`, `docs/brand/tahafi/` (logos drawn from the designers' masters). Asif Zone is the
  `default` theme.
- Customer-facing copy says only what the shop can stand behind (e.g. Tahafi offers size exchange, not a return
  guarantee).

## Evidence on Hand

- Real catalogue, orders and photos live in each store's database and uploads (a sanitized mirror, `asifzone_demo`,
  exists for local work). Tahafi has real product photography for its Haven jackets; other Tahafi sample photos under
  `docs/brand/tahafi/sample/` are placeholders for local preview only.
- No testimonials, press, ratings or sales figures are approved for marketing copy — do not invent them.

## Product Principles

1. **The phone is the store.** Shoppers and staff both work on phones; every flow is designed at 375px first.
2. **Never block an order for a detail staff can fix on the call** — ask for what changes the price or the delivery,
   infer the rest, and flag doubts for the confirmation call.
3. **Say it the way people here say it** — local address habits, Bangla on ad pages, plain English on the site.
4. **Money and stock are facts, not estimates** — the screens show what was recorded, never a guess dressed as a number.
5. **Three brands, one system** — brand character lives in tokens and presets, behaviour is shared.

## Accessibility & Inclusion

WCAG 2.2 AA (contrast, 24px minimum tap targets — 44px where the design system asks — keyboard focus, labelled controls).
Bangla text needs a Bangla-capable font on landing pages.
