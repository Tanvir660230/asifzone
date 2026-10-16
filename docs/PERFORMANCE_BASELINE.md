# Storefront performance baseline — 2026-10-16

Lab numbers from `apps/web/scripts/storefront-vitals.mjs` (phone profile 375×812, 4× CPU slowdown, median of 3 runs) on
a local production build (`next build` + `next start`, `INSTALL_ID=local`) against the seeded test catalogue. The
network is local, so **LCP here says nothing about real customers** — Admin › System health › Site speed is the source
of truth for that from now on (real visits, 75th percentile). What the lab does show reliably: JavaScript weight, main
thread blocking and layout shift.

| Page | Theme | JS (KB, uncompressed) | Long tasks over 50 ms (ms) | CLS |
|---|---|---|---|---|
| Home | default | 905 | 136 | 0 |
| Home | nasihamart | 905 | 112 | 0 |
| Category | default | 887 | 218 | 0 |
| Category | nasihamart | 887 | 189 | 0 |
| Product | default | 919 | 277 | 0 |
| Product | nasihamart | 919 | 301 | 0 |
| Search | default | 889 | 210 | 0 |
| Search | nasihamart | 889 | 214 | 0 |
| Cart | default | 930 | 161 | 0 |
| Cart | nasihamart | 930 | 160 | 0 |
| Checkout | default | 998 | 151 | 0 |
| Checkout | nasihamart | 998 | 120 | 0 |

## What is already right

- No layout shift on any page in either theme (CLS 0).
- The likely LCP images are prioritised: first gallery image, first hero slide, the first product cards
  (`priority` in `product-gallery.tsx`, `hero-carousel.tsx`, `product-card.tsx`, Mihrab `sections.tsx`).
- `@clothing-brand/shared` is compiled from its ESM source (`next.config.mjs` alias), so unused shared modules are dropped.

## Biggest JavaScript on every page (home, largest first)

| Chunk | Size | What |
|---|---|---|
| Next.js app router runtime | 170 KB | unavoidable |
| react-dom | 169 KB | unavoidable |
| framer-motion + zustand | 129 KB | animation library, used site-wide |
| zod | 56 KB | form validation, reached from a client form on every page |

## Later (not done in this pass)

1. **framer-motion on the storefront (≈129 KB).** Most storefront motion is enter/hover transitions that CSS can do
   (`globals.css` recipes). Moving the storefront to CSS transitions and keeping framer-motion for admin and the few
   gesture components (gallery swipe, sheets) would take ~100 KB off every storefront page. Needs a design pass so both
   themes keep their feel.
2. **zod on every page (≈56 KB).** Find the client component that imports a shared zod schema on every page (likely the
   newsletter or contact form in the footer) and validate its few fields by hand, or load that form with `dynamic()`.
3. **Product page main-thread work (≈280–300 ms at 4× slowdown).** Profile hydration of the product page (variant
   pickers, gallery, sticky add-to-cart) — the most visited page, so the biggest INP payoff.

Re-check against Site speed after a week of real data: fix whichever page kind is "Slow" on phones first.
