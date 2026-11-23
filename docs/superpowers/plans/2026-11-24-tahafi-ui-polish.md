# Tahafi storefront UI polish (2026-11-24)

Owner: "the website UI looks bad — check every frontend piece one by one with ui-ux-pro-max and fix it, reusable, global CSS".

## Evidence (live tahafi.com, 375px and 1440px, `.playwright-mcp/ui-probe.cjs`)
- Tap targets under 44px on every page: card quick-add 40, size chips 40, colour swatch 36, share 40, gallery dots 6×6,
  footer links 28 tall, social icons 40, "Size guide" 16 tall, landing-page phone/WhatsApp links 22 tall.
- Text under 12px: dock labels 11px, landing-page promise sub-lines and colour names 11px.
- Product page: one "Color — Coffee" swatch (each colour is its own product), so the shopper cannot see the other colours
  until the "More colours" rail at the very bottom. Product families exist in code but Tahafi has none.
- Cards: the discount tag sits on the model's face; names wrap/truncate ("Navy…").

## Rules
- Brand looks only through tokens (`themeDefinitions.tahafi` in packages/ui-tokens) or the `tahafi` preset files.
- New shared tokens default to today's value, so Asif Zone and Nasihamart stay pixel-identical.
- Invisible hit-area growth (`.ui-hit`) changes no pixels, so it may apply to every brand.

## Steps
1. **Data (live, no deploy):** product families "Haven Sleeveless" (6) and "Haven Full-Sleeve" (4), colour labels, in the
   colour order of the hero rail. The product page then shows every colour as photo tiles.
2. **Tokens + global CSS:**
   - `--tap` (default 2.5rem) and `--tap-sm` (default 2.25rem); tahafi 2.75rem both.
   - `.ui-tap` / `.ui-tap-sm` (height + min-width), `.ui-tap-h` (height only).
   - `.ui-hit`: an invisible ::after that grows a small control's hit area to `--tap`.
3. **Shared controls use the tokens:** size chips and swatches (variant-option-pickers), quantity steppers
   (variant-selector, variant-picker-dialog), share button, gallery arrows and dots, footer social icons and link hit areas.
4. **Tahafi preset:**
   - product card: tag moved off the face, quick-add 44px, steady card height;
   - dock labels 12px;
   - product page: hide the lone colour swatch row when a family shows the colours.
5. **Landing pages:** 11px lines to 12px; phone/WhatsApp links get a 44px hit area.
6. **Verify:**
   - local web on :3881 against a read-only proxy of tahafi.com (GET only);
   - 375 + 1440 screenshots before/after;
   - re-run ui-probe;
   - STORE_THEME=default computed-style probe on the changed controls, which must be identical to main;
   - `pnpm --filter web lint` + typecheck.
7. PR, CI green, merge. Deploy only when the owner says go live.
