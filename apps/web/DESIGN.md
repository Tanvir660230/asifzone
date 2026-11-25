---
name: Asif Zone commerce (Asif Zone · Nasihamart · Tahafi)
description: One commerce system with three shopfronts — clean, trustworthy, premium; restrained and smooth.
colors:
  ink-900: "#111111"
  ink-800: "#1a1a1a"
  ink-700: "#333333"
  ink-500: "#666666"
  ink-400: "#707070"
  ink-300: "#d9d9d9"
  ink-200: "#ececec"
  ink-100: "#f5f5f5"
  ink-50: "#fafafa"
  paper-white: "#ffffff"
  canvas-soft: "#f8f8f8"
  sale-red: "#dc3733"
  sale-red-deep: "#c62828"
  sale-red-wash: "#fdecea"
  success-700: "#077259"
  success-500: "#12b491"
  warning-700: "#855517"
  warning-500: "#c8862c"
  danger-600: "#a0332c"
  danger-500: "#c1443c"
  info-600: "#1f5f9e"
  nasihamart-orange: "#f5871f"
  tahafi-forest-olive: "#3e4a2f"
typography:
  display:
    fontFamily: "Playfair Display, Georgia, serif"
    fontSize: "3rem"
    lineHeight: 1.1
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Playfair Display, Georgia, serif"
    fontSize: "1.875rem"
    lineHeight: "2.25rem"
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Playfair Display, Georgia, serif"
    fontSize: "1.5rem"
    lineHeight: "2rem"
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.875rem"
    lineHeight: 1.6
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.6875rem"
    lineHeight: "1rem"
    letterSpacing: "0.04em"
  figure:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "2.75rem"
    lineHeight: 1.05
    letterSpacing: "-0.025em"
rounded:
  sm: "4px"
  default: "8px"
  md: "10px"
  lg: "14px"
  xl: "20px"
  2xl: "24px"
  3xl: "32px"
  full: "9999px"
spacing:
  control: "32px"
  row-dense: "32px"
  row: "40px"
  header: "48px"
  page-compact: "20px"
  page: "24px"
  sidebar: "232px"
  form: "720px"
components:
  button-primary:
    backgroundColor: "{colors.ink-900}"
    textColor: "{colors.paper-white}"
    rounded: "{rounded.full}"
    height: "44px"
    padding: "0 20px"
  button-primary-hover:
    backgroundColor: "{colors.ink-800}"
  button-outline:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.ink-900}"
    rounded: "{rounded.full}"
    height: "44px"
  input:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.ink-900}"
    rounded: "{rounded.lg}"
    height: "40px"
    padding: "0 12px"
  card:
    backgroundColor: "{colors.paper-white}"
    rounded: "{rounded.2xl}"
    padding: "20px"
  badge-sale:
    backgroundColor: "{colors.sale-red}"
    textColor: "{colors.paper-white}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
  chip-discount:
    backgroundColor: "{colors.sale-red-wash}"
    textColor: "{colors.sale-red-deep}"
    rounded: "{rounded.full}"
    padding: "2px 10px"
---

# Design System: Asif Zone commerce

## Overview

**Creative North Star: "One Shop, Three Shopfronts"**

One careful shop sits behind three different shopfronts. Asif Zone, Nasihamart and Tahafi share every behaviour — how a
product is chosen, how checkout reads an address, how an order moves — and differ only in the face they show: palette,
type, corners and a few signature details, all carried by tokens (`packages/ui-tokens`, `themeDefinitions`). A new screen
is designed once, in tokens and recipes, and looks native in all three. The admin is a fourth face of the same system:
calm, light-only and Apple-like, because it is a work tool used on phones all day.

The mood is clean, trustworthy and premium. Product photographs and prices carry the page; chrome stays quiet. Colour
is spent sparingly and with meaning — one action colour per brand, a sale colour only for genuine promotions, semantic
colours only for state. Components are restrained and smooth: soft corners, two-layer shadows that read as lifted rather
than blurred, and motion that settles gently (ease-out-expo) instead of bouncing.

The source of truth for every rule here is `docs/DESIGN_SYSTEM.md` (recipes in `apps/web/app/globals.css`, primitives in
`apps/web/components/ui/*`, motion in `apps/web/lib/motion.ts`). This file is its visual summary; when they disagree,
DESIGN_SYSTEM.md wins.

**Key Characteristics:**
- Three brand themes over one behaviour; brand-only looks live in tokens, never in `if (brand === …)`.
- Phone-first at 375px for shoppers and staff alike.
- Neutral surfaces, one action colour per brand, sale red only for promotions.
- Two-layer elevation, soft-editorial radii, gentle ease-out motion.
- English on the site, Bangla on ad landing pages — one language per page.

## Colors

A true-neutral base (Asif Zone) with one action colour per brand and a reserved promotional red.

### Primary
- **Ink Black** (`ink-900`): the default theme's action colour — primary buttons, active states, the focus ring, and
  primary text. Filled actions under the pointer deepen to **Ink 800**.
- **Nasihamart Orange** (`nasihamart-orange`): Nasihamart's buying actions only (add, + on cards, checkout), always with
  ink type on top — never as a text colour on white.
- **Tahafi Forest Olive** (`tahafi-forest-olive`): Tahafi's single accent — the logo, links, sale marks and bands; actions
  themselves are near-black with a gloss.

### Secondary
- **Sale Red** (`sale-red`, deep `sale-red-deep`, wash `sale-red-wash`): promotional labels only — Sale, % off, New,
  Limited. Never errors or destructive actions (that is `danger`). Each brand re-tunes it (Nasihamart: savings green;
  Tahafi: olive).

### Neutral
- **Ink 700 / 500 / 400** (`ink-700`, `ink-500`, `ink-400`): body, secondary and tertiary text (meta, hints, struck
  prices). Ink 400 is the lightest text allowed on light surfaces (4.95:1 on white).
- **Ink 300 / 200 / 100 / 50** (`ink-300` … `ink-50`): strong, default and subtle hairlines, wells and table headers.
- **Paper White** (`paper-white`) and **Soft Canvas** (`canvas-soft`): surfaces (cards, inputs) and the page behind them.
- **Status** (`success-*`, `warning-*`, `danger-*`, `info-*`): validated as a set for contrast and colour-blind
  separation; text uses the 600/700 steps on 50/100 washes.

### Named Rules
**The One Voice Rule.** Each brand has one action colour. A second accent is not added; old `brass` classes are aliased
to ink.

**The Promotions-Only Red Rule.** Sale colours mark promotions and nothing else.

**The Role-Not-Hex Rule.** Components use roles (`fg`, `fg-muted`, `surface`, `line`, `accent`), never raw hex, so a theme
change reaches them.

## Typography

**Display Font:** Playfair Display (default theme), via `--font-display-family`
**Body Font:** Inter, with system fallbacks; Bangla glyphs fall through to the Bangla face (`--font-bn`) and ৳ to
`--font-taka`

**Character:** an editorial serif for titles over a plain, highly legible sans for everything you read or tap. Brands swap
the pair through tokens: Nasihamart uses Manrope with Hind Siliguri for Bangla; Tahafi uses Geist (Instrument Serif for
showpiece titles); the admin uses the Apple system font.

### Hierarchy
- **Display** (3rem, 1.1, -0.025em): hero and campaign titles.
- **Headline** (1.875rem, 2.25rem): page titles.
- **Title** (1.5rem, 2rem): section titles.
- **Body** (0.875–1rem, ~1.6): running text, kept to about 65ch on reading pages (legal, policies).
- **Label** (0.6875rem, 0.04em, uppercase by token `--caps-transform`): small caps labels and eyebrows.
- **Figure** (2.25–2.75rem, tight): the admin's headline money figures, so every big number matches.

### Named Rules
**The Balanced Title Rule.** Headings use `text-wrap: balance`; no single word on a title's last line.

**The One Language Rule.** A page is English or Bangla, never both.

## Layout

Phone-first: every page works at 375px with no sideways page scroll. The storefront centres content in a max-width
column with generous section rhythm (`--section-rhythm`); product grids are two columns on phones. On phones the product
page's buy bar replaces the tab bar while it is on screen. The admin uses a fixed density baseline: 48px top bar,
232px sidebar (56px rail), 40px table rows (32px dense), 32px toolbar controls, 24px page padding (20px compact), forms at
most 720px wide; wide tables get a column picker, never a horizontal page scroll.

**The 375 Rule.** If it doesn't work at 375px, it isn't done.

## Elevation & Depth

A lifted, two-layer system: a soft far shadow plus a crisp near one, so surfaces read as raised rather than blurry. Cards
rest at `sm`; floating chrome (sheets, menus, sticky bars) uses `float` / `floatLg`; glass panels add a lit top edge.
Inputs are recessed with a hairline inner shade. Depth tokens are CSS variables, so a theme can retune them.

### Shadow Vocabulary
- **Resting** (`0 1px 2px 0 rgba(20,20,20,0.06)`): cards and tiles at rest.
- **Lifted** (`0 4px 12px -2px rgba(20,20,20,0.08), 0 2px 4px -2px rgba(20,20,20,0.04)`): hover and raised panels.
- **Floating** (`0 8px 16px -4px rgba(20,20,20,0.10), 0 20px 48px -8px rgba(20,20,20,0.18)`): sheets, popovers, dialogs.
- **Recessed** (`inset 0 1px 2px 0 rgba(20,20,20,0.05)`): text fields.

**The Lifted-Not-Blurred Rule.** Depth comes from two layers, never one big blur.

## Shapes

Soft-editorial corners: a 4–32px radius scale (`sm` 4px → `3xl` 32px), with control, chip and swatch radii as their own
tokens so a store can choose sharp, soft or round corners in Storefront Studio without mixing styles. The default theme
uses pill controls. Product photographs share one frame (`--product-photo-aspect`, `--product-photo-fit`): 5:6 contain
for studio shots (default, Nasihamart), 1:1 cover for Tahafi's model photos.

## Components

### Buttons
Restrained and smooth.
- **Shape:** the theme's control radius (default: full pill).
- **Primary:** accent fill with accent-fg text, 44px tall on touch; a subtle gloss (`--gloss`) on filled actions.
- **Hover / Focus:** fill deepens to `accent-hover`; a visible 2px accent focus ring offset by 2px; a small press scale.
- **Outline / Ghost:** white surface with a hairline, or text-only for low-emphasis actions.

### Chips
- **Style:** pill chips on `surface-muted`; selected chips take the accent fill.
- **Discount chip:** sale wash with sale-deep text (e.g. "57% off").

### Cards / Containers
- **Corner Style:** 20–24px on storefront cards and account panels.
- **Background:** white surface on the soft canvas.
- **Shadow Strategy:** Resting at rest, Lifted on hover (`--card-lift`).
- **Border:** an inset hairline ring (`line-subtle`).

### Inputs / Fields
- **Style:** the `ui-control` recipe — 40px, white, hairline border, recessed inner shade, placeholder in `fg-subtle`.
- **Focus:** border to ink-400 plus a soft 4px accent ring.
- **Error / Disabled:** danger border and message under the field; disabled at reduced opacity.

### Navigation
- **Storefront:** a quiet header with search; on phones a tab bar or floating dock (per brand) above which the bag bar
  sits.
- **Admin:** a section bar of module pages under the top bar, a phone tab bar (Home, Orders, Inbox, Stock, More) and a
  More sheet in iOS style.

### Thana & district box (signature)
One field that reads the thana and district out of the written address (English or Bangla), asks "Which Kaliganj?" with
chips when a name belongs to several districts, and offers the written thana when a pick contradicts the address. Never
marked optional, never blocking.

## Do's and Don'ts

### Do:
- **Do** build with roles and recipes (`fg`, `surface`, `accent`, `ui-control`, `ui-card-frame`) so all three themes follow.
- **Do** put a brand-only look in that theme's tokens and keep Asif Zone's look unchanged unless the change is meant for it.
- **Do** keep tap targets at least 24px (44px where `docs/DESIGN_SYSTEM.md` asks); use `tap-target` for isolated inline
  actions.
- **Do** handle loading, empty and error states on every screen.
- **Do** keep reading text to about 65ch.

### Don't:
- **Don't** use purple/blue gradients, emoji as icons, everything centred, identical three-card grids, generic hero copy
  or gratuitous glassmorphism.
- **Don't** hard-code colours, fonts or one-off styles; propose a token instead.
- **Don't** add dark mode to the admin.
- **Don't** use sale red for anything but promotions, or a second accent colour in a brand.
- **Don't** mix English and Bangla on one page.
