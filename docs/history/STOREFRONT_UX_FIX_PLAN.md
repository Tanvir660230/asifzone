# Storefront UX fix plan (2026-10-11)

Owner feedback: the header hiding on scroll feels wrong; the chat button at the bottom doesn't work; homepage product sections show a single row; buying one product, then two or three, should feel smooth. Each issue below was reproduced in a browser (phone 390 px, desktop 1280 px) before planning the fix.

## Issues found

| # | Issue | Evidence | Fix |
|---|---|---|---|
| 1 | **Chat button opens, then closes itself** on the home, category and product pages | Probe: tap → menu items 2/2 and `aria-expanded=false` on 4 of 8 page/width combinations. The open menu grows upward, touches a product card's bag button, and the "duck out of the way" overlap check closes it | Overlap is measured against the round button only, never the open menu; an open menu is never closed by it; changes inside the widget don't re-trigger the check |
| 2 | **Header hides on scroll down** | Owner dislikes it | Header always stays on top (sticky), with a soft shadow once the page scrolls; `--sticky-top` stays constant |
| 3 | **Homepage product sections show one row** | Rails of single cards | Two rows: desktop 4 × 2 grid (8 products, no sideways scrolling); phone/tablet two rows that swipe sideways, so 4+ cards are visible at once |
| 4 | **Every add-to-cart opens the full cart drawer** over the page (PDP, product cards, popup) | Adding 3 products = open/close the drawer 3 times; on phones it covers the whole screen | A compact **"Added to bag"** confirmation (bottom sheet on phones, corner card on desktop): photo, name, option, bag count and subtotal, **View bag** / **Checkout**; closes by itself after a few seconds; the shopper stays where they were |
| 5 | Cart drawer: mostly empty space, no way back except ✕, small quantity buttons (28 px) | Screenshots | "Continue shopping" button; delivery fee line (inside/outside Dhaka); **Complete your order** suggestions with one-tap add; 36 px quantity buttons |
| 6 | Checkout on phones: the bottom nav and chat button float over form fields | Full-page capture | Focused checkout: no bottom nav, no chat button, no sticky cart bar on /checkout |
| 7 | Cart page: "Running low — you might also like" reads like an error about the shopper's item | Screenshot | "Few left — similar styles:" |
| 8 | PDP inline "Added to cart — view cart" line duplicates the new confirmation | — | Removed |

## Order of work
1. Chat button (bug) → 2. header → 3. homepage two rows → 4. add-to-bag confirmation → 5. drawer → 6. focused checkout → 7–8 copy.

## Verification
Browser walk-through at 390 and 1280 px: chat menu opens on every page; header stays; homepage sections show two rows; add one product, then two more from cards, then checkout; e2e storefront specs; unit tests; lint.

## Result (all 8 done)
`scripts/storefront-journey.mjs` at 390 and 1280 px, zero console errors:
- Contact menu opens and stays open on home (top and scrolled), category, product and cart; it closes on a tap outside or Escape.
- Header stays in view after scrolling 2,500 px.
- Homepage "Featured": 2 rows (desktop 4 × 2 = 8 cards; phones swipe two rows together).
- Add from the product page, from a card (single option) and through the options popup: the "Added to bag" confirmation each time, the bag does not open, the page stays where it was.
- "View bag": 3 lines, "Complete your order" suggestions, delivery fee line, Continue shopping.
- Checkout: no bottom nav, no contact button.

Also: "bag" wording everywhere (drawer, cart page, sticky bar "View bag"), suggestion names on two lines.

Tests: e2e storefront specs 32 passed / 0 failed (16 skipped by design; 3 specs updated for the confirmation that replaced the auto-opening drawer), web unit 64/66 (the 2 pre-existing admin failures), ESLint clean on changed files.
