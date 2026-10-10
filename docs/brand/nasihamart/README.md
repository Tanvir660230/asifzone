# Nasihamart brand assets

Source of truth for the Nasihamart identity. These files are **content**: they reach the store only by being uploaded
in the admin (nothing in the application code references them). The visual system they belong to — palette, type,
radii, section treatment — is the `nasihamart` theme in `packages/ui-tokens` (`STORE_THEME=nasihamart`).

## Files

| File | Use | Upload in the admin |
|---|---|---|
| `png/nasihamart-logo.png` (`nasihamart-logo.svg`) | Primary logo — light backgrounds (header, ivory sections) | Settings → Store & Branding → **Logo (light backgrounds)** |
| `png/nasihamart-logo-on-dark.png` (`…-on-dark.svg`) | Logo for navy backgrounds (footer) | Settings → **Logo (dark backgrounds)** |
| `png/nasihamart-favicon-512.png` (`nasihamart-favicon.svg`) | Browser tab / home-screen icon | Settings → **Favicon** |
| `png/nasihamart-og-image-1200x630.png` (`…-og-image.svg`) | Default link preview (Facebook, WhatsApp …) | Settings → Search engines → **Social sharing image** |
| `nasihamart-icon.svg`, `png/nasihamart-icon-512.png` | The mark alone (avatars, packaging, print) | — |
| `nasihamart-logo-black.svg` / `-white.svg`, `nasihamart-icon-black.svg` / `-white.svg` | One-colour reproduction (stamps, embossing, single-colour print) | — |

Upload the PNG exports: the upload pipeline re-encodes images and does not keep SVG. The SVGs are the masters — every
letter is an outline, so they render identically everywhere without the fonts.

## Mark

A pointed (two-centred) arch — the doorway / mihrab outline of Islamic architecture, one open stroke in warm stone —
framing the wordmark's own **N**. No star, no cart, no ornament. Wordmark: *Nasihamart* in Newsreader (medium, display
optical size), all navy; warm stone appears only in the arch.

Clear space: at least the arch's width on every side. Minimum size: 96 px wide for the full logo, 16 px for the favicon
(the favicon is the mark on a navy tile, built for small sizes — use it, not the bare mark, below 32 px).

## Colour

| Role | Hex | Use |
|---|---|---|
| Primary navy | `#0B1F33` | Headings, primary actions, dark sections, footer, the N |
| Secondary blue | `#123B73` | Hover, links, selected and interactive states |
| Warm stone | `#D6C1A2` | The arch; small accents **on navy only** (1.6:1 on ivory — never text on light backgrounds) |
| Soft ivory | `#F8F6F1` | Page and section background |
| White | `#FFFFFF` | Cards, forms, surfaces |
| Ink | `#1A1F2E` | Body text |
| Warm border | `#E5E0D7` | Lines, dividers, card and input outlines |

Proportion: ≈70% ivory/white, 20% navy, 7% blue, 3% stone. Contrast: navy on ivory 15.5:1, blue on ivory 10.2:1, stone
on navy 9.6:1, ivory on navy 15.5:1.

## Type

- **Newsreader** (serif, optical sizes) — hero, section and editorial headings, the wordmark.
- **Instrument Sans** (grotesk) — navigation, UI, product data, buttons, the OG descriptor.

Both are SIL Open Font License 1.1, loaded by the web app through `next/font` (no files to ship).

## Photography (for the real content)

Natural, warm light; neutral or ivory backgrounds; navy/ivory/stone styling; minimal props; consistent aspect ratios
(hero 4:5 — 16:9 on tablets, category 4:5, product 1:1 or 4:5, brand story landscape ≈ 5:2). No stock
clichés, no saturated backgrounds, no heavy gold, no mosque silhouettes.

## Status

These assets were drawn to the approved direction (navy + warm stone, no green/gold) as a production-ready vector
set. If a designer delivers a different final logo, replace the files here and re-upload them in the admin — no code
changes.
