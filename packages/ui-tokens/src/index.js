/**
 * The design system's single source of truth — every color, radius, shadow, motion and layering
 * value the apps use. Consumed three ways:
 *
 *  1. `tailwind.config.ts` spreads `colors`/`boxShadow`/... into `theme.extend`, and injects
 *     `cssVariables` (light) at `:root` via a tiny plugin.
 *  2. Colors are emitted as `rgb(var(--color-…) / <alpha-value>)`, so every existing utility
 *     (`bg-ink-900`, `text-cream-50/75`, `border-brass-400`) keeps working, opacity modifiers
 *     included — but the actual values live in CSS variables. A brand (future multi-brand OS) can
 *     re-theme the whole UI at runtime by overriding those variables under a selector such as
 *     `[data-brand="x"]`, with no rebuild and no class-name changes.
 *  3. `motion` is read by `apps/web/lib/motion.ts` (Framer Motion presets) so CSS transitions and
 *     JS animations share one timing language.
 *
 * Palette direction: premium, minimal, neutral — white surfaces, true-neutral grays, one red
 * accent reserved for promotional labels (`sale`), muted semantic status colors.
 */

/* ───────────────────────────── raw palette (hex) ───────────────────────────── */

const palette = {
  // True neutral gray scale. 900 = primary text, 500 = secondary text, 400 = tertiary text (meta, hints, struck
  // prices), 200 = border. 400 clears WCAG AA for body-size text on every light surface: 4.95:1 on white, 4.66:1 on the
  // canvas, 4.54:1 on ink-100 (it was #b3b3b3, 2.1:1). The dark sections keep the light grey (default `darkBandPalette`).
  ink: {
    50: "#fafafa",
    100: "#f5f5f5",
    200: "#ececec",
    300: "#d9d9d9",
    400: "#707070",
    500: "#666666",
    600: "#4d4d4d",
    700: "#333333",
    800: "#1a1a1a",
    900: "#111111",
    950: "#080808",
  },
  // Background family — pure / soft white.
  cream: {
    50: "#ffffff",
    100: "#f8f8f8",
    200: "#f0f0f0",
    300: "#e0e0e0",
  },
  // The one and only accent color: promotional labels (Sale / % OFF / New / Limited) and
  // genuinely promotional CTAs. Never errors/destructive actions — that's `danger`.
  // 500 clears WCAG AA (4.5:1) under white badge text — 4% deeper than the original #e53935, same hue.
  sale: { 50: "#fdecea", 500: "#dc3733", 600: "#c62828" },
  // Semantic status colors. The 500/600 anchors were validated as a set (chroma floor, CVD
  // separation, contrast) — don't tweak one in isolation without re-validating the others.
  success: { 50: "#e9f9f4", 100: "#cdf0e4", 200: "#a8e4d0", 500: "#12b491", 600: "#0aa382", 700: "#077259" }, // 700: 4.8:1 on success-100 (pills)
  warning: { 50: "#fdf6ec", 100: "#faead0", 200: "#f3d4a6", 500: "#c8862c", 600: "#a66c1f", 700: "#855517" },
  danger: { 50: "#fbeeee", 100: "#f6d9d8", 200: "#edb9b6", 400: "#d6716b", 500: "#c1443c", 600: "#a0332c", 700: "#7c2721" },
  info: { 50: "#eef4f9", 100: "#d7e6f0", 200: "#b6d1e4", 500: "#2b6aad", 600: "#1f5f9e", 700: "#1a4c80" },
};

/** `brass` was an old gold accent still referenced by ~80 call sites; the brand allows no second
 * accent, so it is aliased step-for-step to the neutral `ink` scale (same lightness per step, so
 * dark-text-on-brass-400 pairings stay legible). New code should use `ink-*` directly. */
const BRASS_ALIAS = { DEFAULT: 400, 50: 50, 100: 100, 200: 200, 300: 300, 400: 400, 500: 500, 600: 600, 700: 700, 800: 800 };

/** Semantic roles — what a color is FOR, independent of the palette. Each maps to a palette
 * variable, so a brand theme normally overrides only the palette and the roles follow; it may also
 * override a role directly (e.g. a colored `accent`). */
const semantic = {
  canvas: "cream-100", // app/page background
  surface: "cream-50", // cards, panels, inputs
  "surface-muted": "ink-50", // table headers, wells, subtle fills
  "surface-inverse": "ink-900", // dark chrome (admin sidebar)
  line: "ink-200", // default hairline borders
  "line-subtle": "ink-100",
  "line-strong": "ink-300",
  fg: "ink-900", // primary text
  "fg-muted": "ink-500", // secondary text
  "fg-subtle": "ink-400", // tertiary text / placeholders
  accent: "ink-900", // primary actions, active states, focus ring
  "accent-fg": "cream-50", // text on accent
  "accent-hover": "ink-800", // a filled primary action under the pointer
};

/* ───────────────────────────── derived color tokens ───────────────────────────── */

function hexToRgbChannels(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

const ref = (name) => `rgb(var(--color-${name}) / <alpha-value>)`;

/** `:root` custom properties (space-separated RGB channels, the form `<alpha-value>` needs). */
const cssVariables = {};
for (const [scale, steps] of Object.entries(palette)) {
  for (const [step, hex] of Object.entries(steps)) cssVariables[`--color-${scale}-${step}`] = hexToRgbChannels(hex);
}
for (const [step, target] of Object.entries(BRASS_ALIAS)) {
  if (step !== "DEFAULT") cssVariables[`--color-brass-${step}`] = `var(--color-ink-${target})`;
}
for (const [role, target] of Object.entries(semantic)) cssVariables[`--color-${role}`] = `var(--color-${target})`;

const colors = {};
for (const [scale, steps] of Object.entries(palette)) {
  colors[scale] = {};
  for (const step of Object.keys(steps)) colors[scale][step] = ref(`${scale}-${step}`);
}
colors.ink.DEFAULT = ref("ink-900");
colors.cream.DEFAULT = ref("cream-100");
colors.sale.DEFAULT = ref("sale-500");
colors.brass = { DEFAULT: ref("brass-400") };
for (const step of Object.keys(BRASS_ALIAS)) if (step !== "DEFAULT") colors.brass[step] = ref(`brass-${step}`);
for (const role of Object.keys(semantic)) colors[role] = ref(role);

/* ───────────────────────────── typography ───────────────────────────── */

const fontFamily = {
  // --font-taka (just ৳) and --font-bn (Bengali text) follow the Latin font, so the browser falls back per glyph.
  sans: ["var(--font-body-family)", "var(--font-taka)", "var(--font-bn)", "ui-sans-serif", "system-ui", "sans-serif"],
  // `--font-display-family` (set below) is the title face; a theme can swap it, e.g. to the sans face.
  display: ["var(--font-display-family)", "var(--font-taka)", "var(--font-bn)", "ui-serif", "Georgia", "serif"],
};

/** Typography variables at :root. "Ampersand Fix" (globals.css) swaps only U+0026 — Playfair's "&" swash reads as broken. */
const fontVariables = {
  "--font-body-family": "var(--font-sans)",
  "--font-display-family": '"Ampersand Fix", var(--font-display)',
};

/** Named type roles beyond Tailwind's size scale — titles use the display face with tight tracking. */
const fontSize = {
  "display-sm": ["1.5rem", { lineHeight: "2rem", letterSpacing: "-0.01em" }],
  "display-md": ["1.875rem", { lineHeight: "2.25rem", letterSpacing: "-0.015em" }],
  "display-lg": ["2.25rem", { lineHeight: "2.5rem", letterSpacing: "-0.02em" }],
  "display-xl": ["3rem", { lineHeight: "1.1", letterSpacing: "-0.025em" }],
  caption: ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.04em" }],
};

/* ───────────────────────────── shape & depth ───────────────────────────── */

// Soft-editorial radius scale. Each step is a CSS variable (`--radius-lg`), so a theme can reshape the UI.
const radii = {
  sm: "4px",
  DEFAULT: "8px",
  md: "10px",
  lg: "14px",
  xl: "20px",
  "2xl": "24px",
  "3xl": "32px",
};
const radiusVariable = (step) => `--radius-${step === "DEFAULT" ? "default" : step}`;
const borderRadius = { none: "0px", full: "9999px" };
for (const [step, value] of Object.entries(radii)) {
  borderRadius[step] = `var(${radiusVariable(step)})`;
  cssVariables[radiusVariable(step)] = value;
}
Object.assign(cssVariables, fontVariables);

/**
 * Corner styles a store may pick on top of its theme (Storefront Studio → Site design → Corners). Each is the whole radius
 * scale plus the control radii, so a choice never mixes with another style's corners. "soft" and "round" share the base
 * scale and differ in controls (soft rectangles / pills); "sharp" is a tight scale.
 */
const baseRadiusVariables = Object.fromEntries(Object.entries(radii).map(([step, value]) => [radiusVariable(step), value]));
const cornerPresets = {
  sharp: {
    ...Object.fromEntries(Object.keys(radii).map((step, i) => [radiusVariable(step), `${[2, 3, 4, 6, 8, 10, 12][i]}px`])),
    "--control-radius": "3px",
    "--chip-radius": "3px",
    "--swatch-radius": "3px",
    "--fab-radius": "6px",
  },
  soft: { ...baseRadiusVariables, "--control-radius": radii.md, "--chip-radius": radii.md, "--swatch-radius": radii.DEFAULT, "--fab-radius": radii.lg },
  round: { ...baseRadiusVariables, "--control-radius": "9999px", "--chip-radius": "9999px", "--swatch-radius": "9999px", "--fab-radius": "9999px" },
};

// Neutral, two-layer elevation: a soft far shadow plus a crisp near one is what makes a surface
// read as "lifted" rather than just blurrier.
const boxShadow = {
  sm: "0 1px 2px 0 rgba(20,20,20,0.06)",
  DEFAULT: "0 4px 12px -2px rgba(20,20,20,0.08), 0 2px 4px -2px rgba(20,20,20,0.04)",
  lg: "0 12px 32px -4px rgba(20,20,20,0.14), 0 4px 8px -4px rgba(20,20,20,0.06)",
  float: "0 2px 6px -1px rgba(20,20,20,0.07), 0 8px 20px -4px rgba(20,20,20,0.10)",
  floatLg: "0 8px 16px -4px rgba(20,20,20,0.10), 0 20px 48px -8px rgba(20,20,20,0.18)",
  // Glass panels: an inner top highlight (the "lit edge") over a soft drop shadow.
  glass: "inset 0 1px 0 0 rgba(255,255,255,0.65), 0 1px 2px 0 rgba(20,20,20,0.05), 0 12px 32px -12px rgba(20,20,20,0.16)",
  "glass-lg": "inset 0 1px 0 0 rgba(255,255,255,0.7), 0 2px 6px -2px rgba(20,20,20,0.08), 0 28px 64px -16px rgba(20,20,20,0.28)",
  // Recessed fields (inputs) — a hairline inner shade.
  inset: "inset 0 1px 2px 0 rgba(20,20,20,0.05)",
  glow: "0 0 0 4px rgba(17,17,17,0.10)",
};
// Each elevation is a CSS variable (`--shadow-lg`), like radii, so a surface can retune depth without new classes.
const shadowVariable = (key) => `--shadow-${key === "DEFAULT" ? "default" : key}`;
const boxShadowRefs = {};
for (const [key, value] of Object.entries(boxShadow)) {
  cssVariables[shadowVariable(key)] = value;
  boxShadowRefs[key] = `var(${shadowVariable(key)})`;
}

/** Layering scale — named so overlapping fixed elements never fight with ad-hoc numbers. */
const zIndex = {
  base: "0",
  raised: "10",
  sticky: "20",
  dock: "40", // fixed bottom bars
  overlay: "50", // modal / drawer / popover
  toast: "200",
};

/* ───────────────────────────── admin density ───────────────────────────── */

/**
 * The admin's ERP density baseline (P1.12): one set of sizes for the shell, tables, controls and drawers, so modules
 * rebuilt in P2+ share a rhythm instead of each picking its own. Declared as `--density-*` variables at :root (a theme
 * may retune them) and exposed to Tailwind as spacing keys: `w-sidebar`, `w-sidebar-collapsed`, `h-header`, `h-row`,
 * `h-row-dense`, `h-control`, `px-page`, `max-w-drawer-md`, …
 */
const density = {
  sidebar: "232px", // expanded admin sidebar
  "sidebar-collapsed": "56px", // icon rail
  header: "48px", // admin top bar
  "section-bar": "44px", // the module's pages under the top bar (components/admin/section-bar.tsx)
  chrome: "48px", // everything pinned at the top of the page column — `top-chrome` for a page's own sticky bars; the shell retunes it
  page: "24px", // page padding (desktop)
  "page-compact": "20px", // page padding (dense / tablet)
  row: "40px", // table row
  "row-dense": "32px", // dense table row (long operational lists)
  control: "32px", // inputs, buttons, selects in toolbars
  "kpi-strip": "64px", // compact KPI strip
  "filter-bar": "40px", // filter / view bar
  "drawer-sm": "400px",
  "drawer-md": "560px",
  "drawer-lg": "720px",
};
const densitySpacing = {};
for (const [name, value] of Object.entries(density)) {
  cssVariables[`--density-${name}`] = value;
  densitySpacing[name] = `var(--density-${name})`;
}

/* ───────────────────────────── motion ───────────────────────────── */

/** One timing language for CSS (Tailwind utilities) and JS (Framer Motion via lib/motion.ts). */
const motion = {
  duration: { instant: 100, fast: 150, base: 220, slow: 320, slower: 480 },
  easing: {
    // ease-out-expo: starts fast, settles gently — the default for entering/hover.
    smooth: [0.16, 1, 0.3, 1],
    // standard in/out for elements that move within the page.
    standard: [0.2, 0, 0, 1],
    // accelerate away — for exits.
    exit: [0.4, 0, 1, 1],
    // iOS sheets and navigation pushes: quick off the mark, then a long, soft settle.
    sheet: [0.32, 0.72, 0, 1],
  },
  spring: { stiffness: 420, damping: 32, mass: 0.9 },
};

const toCubic = (e) => `cubic-bezier(${e.join(", ")})`;

const transitionTimingFunction = {
  smooth: toCubic(motion.easing.smooth),
  standard: toCubic(motion.easing.standard),
  exit: toCubic(motion.easing.exit),
  sheet: toCubic(motion.easing.sheet),
};

const transitionDuration = Object.fromEntries(Object.entries(motion.duration).map(([k, v]) => [k, `${v}ms`]));

/* ───────────────────────────── component tokens ───────────────────────────── */

/**
 * Presentation decisions that differ between brands, as CSS variables read by the recipes in
 * apps/web/app/globals.css and by a few arbitrary utilities (`tracking-[var(--card-title-tracking)]`).
 * These defaults reproduce the base design exactly; a theme overrides only what it changes.
 *
 * Deliberately NOT declared here (so they stay undefined and the property inherits, as it did before
 * they existed): `--font-display-weight`, `--font-display-tracking`, `--eyebrow-weight`. A theme may set them.
 */
const componentTokens = {
  // Small labels (`.ui-caps`) and eyebrows (`.ui-eyebrow`): case, and a multiplier on their letter-spacing.
  "--caps-transform": "uppercase",
  "--caps-spread": "1",
  // Strength of the `.glossy` sheen on filled controls (0 = flat), and the fill of `.glass` chrome.
  "--gloss": "1",
  "--glass-alpha": "0.75",
  "--header-shadow": "0 4px 20px -8px rgba(17,17,17,0.08)",
  // Artwork made for a dark or a light background (logos inside `.ui-band-inverse`): which one shows. `contents` keeps
  // the wrapper box-less, so the visible variant lays out exactly as if it were unwrapped. A light band swaps them.
  "--band-dark-art": "contents",
  "--band-light-art": "none",
  // Non-promotional product badges ("New Arrival", "Limited Item").
  "--badge-note-bg": "rgb(var(--color-sale-500))",
  "--badge-note-fg": "#ffffff",
  // The darkening behind light text set on a photograph (promo banners).
  "--media-scrim": "rgb(var(--color-ink-950) / 0.35)",
  // Primary call to action on the hero band: its fill and text (transparent = the outline style).
  "--hero-cta-fill": "transparent",
  // Cart line items: the product thumbnail on the cart page and the quantity stepper — rounded like the bag drawer's, so
  // the same item looks the same in the drawer and on the bag page.
  "--line-item-radius": "var(--radius-lg)",
  "--stepper-radius": "9999px",
  // Product card.
  // The product photo's shape on a card (square in the base design).
  "--card-media-aspect": "1 / 1",
  // The thread a preset's hang-tag hangs from (Tahafi's hero).
  "--tag-thread": "rgb(var(--color-ink-300))",
  "--card-lift": "-0.25rem",
  "--card-frame-border": "rgb(var(--color-ink-100))",
  "--card-frame-shadow": "0 1px 2px 0 rgba(20,20,20,0.06)",
  "--card-frame-shadow-hover": "0 2px 6px -1px rgba(20,20,20,0.07), 0 8px 20px -4px rgba(20,20,20,0.10)",
  "--card-image-zoom": "1.05",
  // Off on cards: every product carries a tier ("Premium"), so on a card it is a line that says nothing; the product page
  // still shows it beside the brand (--product-tier-display).
  "--card-tier-display": "none",
  "--product-tier-display": "inline",
  "--card-title-tracking": "0.025em",
  // Content tiles (values grid, info panels): their hairline frame.
  "--panel-border": "rgb(var(--color-ink-100))",
  "--panel-shadow": "0 1px 2px 0 rgba(20,20,20,0.06)",
  // Product page title.
  // Phones get a smaller title so the price and sizes reach the first screen; from ~900px it is the full 1.875rem.
  "--product-title-size": "clamp(1.5rem, 1.2rem + 1.2vw, 1.875rem)",
  "--product-title-leading": "1.2",
  "--product-title-weight": "500",
  "--product-title-tracking": "0.025em",
  // Section titles (carousels and other homepage/product-page rails): mobile, then ≥640px.
  "--section-title-size": "1.25rem",
  "--section-title-leading": "1.75rem",
  "--section-title-size-sm": "1.5rem",
  "--section-title-leading-sm": "2rem",
  // Vertical rhythm: a multiplier on the block padding of homepage and product-page sections.
  "--section-rhythm": "1",
  // Page titles: the one <h1> size of every storefront and account page (StorefrontPageHeader): mobile, then ≥640px.
  "--page-title-size": "1.875rem",
  "--page-title-leading": "1.2",
  "--page-title-size-sm": "2.5rem",
  "--page-title-leading-sm": "1.1",
  // Homepage section headings ("Shop by Category", "What We Stand For", reviews): mobile, then ≥640px.
  "--section-heading-size": "1.5rem",
  "--section-heading-leading": "2rem",
  "--section-heading-size-sm": "1.5rem",
  "--section-heading-leading-sm": "2rem",
  // Eyebrows may differ from small labels: their own case and letter-spacing multiplier (default: the same as `.ui-caps`).
  "--eyebrow-transform": "var(--caps-transform)",
  "--eyebrow-spread": "var(--caps-spread)",
  // Corner radius of buttons and call-to-action links (a pill in the base design).
  "--control-radius": "9999px",
  // Hover fill of primary actions.
  "--accent-hover": "rgb(var(--color-ink-800))",
  // Primary navigation link: hover color and the hover underline.
  "--nav-hover": "rgb(var(--color-brass-500))",
  "--nav-underline": "rgb(var(--color-brass-500))",
  // Icon stroke (lucide icons drawn at the default width only — icons given another width keep it).
  "--icon-stroke": "2",
  // Hero: alignment, and from 1024px either the stacked composition (`block`) or copy beside the image (`grid`).
  "--hero-align": "center",
  "--hero-layout-lg": "block",
  "--hero-media-aspect-lg": "21 / 9",
  // From 1024px: the composition's maximum width, the copy's side padding, and the image's offset below the copy.
  "--hero-content-max-w-lg": "none",
  "--hero-copy-pad-lg": "1rem",
  "--hero-media-offset-lg": "3.5rem",
  // The secondary hero action: an outline ring around it (transparent = a plain text link), and the space between the
  // two actions (on the secondary's left by default; a left-aligned theme puts it after the primary, so a wrapped
  // secondary action lines up under the first).
  "--hero-secondary-ring": "transparent",
  "--hero-primary-mr": "0px",
  "--hero-secondary-ml": "0.5rem",
  // Category tiles: the caption sits over the image (`absolute`) or below it (`static`), and its padding.
  "--tile-caption-position": "absolute",
  "--tile-caption-padding": "1rem",
  // The photograph's own corner radius (0: the tile's rounded clip shapes it, as in the base design).
  "--tile-media-radius": "0px",
  // Product page title face (the title face by default; a theme may set product data in the UI face).
  "--product-title-family": "var(--font-display-family), var(--font-taka), var(--font-bn), ui-serif, Georgia, serif",
  // Brand story image: its maximum width, and its height from 640px.
  "--story-media-max-w": "28rem",
  "--story-media-h-sm": "18rem",
  // Option chips (sizes), colour swatches, and floating round buttons (wishlist, contact): circles in the base design.
  "--chip-radius": "9999px",
  "--swatch-radius": "9999px",
  "--fab-radius": "9999px",
  // Height of the mobile bottom tab bar's row (iOS: 49pt), which the bottom-docked bars sit above; the bar adds the
  // home-indicator inset below it. 0rem in a preset without one; keep the unit.
  "--dock-tab-bar": "3.25rem",
  // Phone sheets (globals.css .ui-sheet): top corner radius, and the rise — iOS's sheet curve, quick then a long settle.
  "--sheet-radius": "1.375rem",
  "--sheet-duration": "0.44s",
  "--sheet-ease": toCubic(motion.easing.sheet),
};
Object.assign(cssVariables, componentTokens);

/* ───────────────────────────── brand themes ───────────────────────────── */

/**
 * Brand themes — the multi-brand layer. An installation picks one at runtime (STORE_THEME, see
 * packages/shared/src/runtime-config.ts); the root layout puts it on <html data-brand="…">, and the
 * Tailwind plugin emits each theme's overrides under `:root[data-brand="<id>"]`. A theme overrides
 * only raw values — palette steps, radii, the title face — and every semantic role follows. `default`
 * is the base tokens above, unchanged.
 */
const themeDefinitions = {
  default: { label: "Default (neutral editorial)" },
  // Nasihamart — "Mihrab" (docs/brand/nasihamart/THEME_BLUEPRINT.md). Night navy (#0B1F33) for type and actions, ivory
  // (#F8F6F1) page, sand (#EEE7DB) behind photography and in the footer, lapis (#123B73) for hover and interaction
  // (--accent-hover, --nav-hover), warm stone (#D6C1A2) for arch outlines and accents on navy only (1.6:1 on ivory — never
  // text there), mulberry (#8A2E3B) for promotions. Headings in Newsreader, the serif of the logo's wordmark, so the logo and
  // the page speak with one voice; Instrument Sans for everything else. Its own layout preset (`mihrab`): the pointed arch of the logo frames
  // the photography.
  nasihamart: {
    label: "Nasihamart (Mihrab: navy · ivory · sand)",
    layout: "mihrab",
    palette: {
      ink: {
        50: "#f4f1eb", // subtle fills
        100: "#ece7de", // subtle hairlines
        200: "#e5e0d7", // warm border (lines, card outlines, inputs)
        300: "#d3ccbf", // strong line
        400: "#646976", // tertiary text (struck-through prices, hints) — 5.1:1 on ivory
        500: "#565c69", // secondary text — 6.2:1 on ivory
        600: "#3e4452",
        700: "#1a1f2e", // ink: body text — 15.2:1
        800: "#13223a", // deep navy-ink (secondary blue #123B73 is a token: --accent-hover, --nav-hover)
        900: "#0b1f33", // navy: headings, primary actions, focus — 15.5:1
        950: "#0b1f33", // navy: the dark sections and footer
      },
      // 200 = sand: arch backdrops, image wells, the footer.
      cream: { 50: "#ffffff", 100: "#f8f6f1", 200: "#eee7db", 300: "#e2d8c8" },
      // Mulberry, the one promotional accent: 8.3:1 under white badge text, 7.7:1 as text on ivory.
      sale: { 50: "#f6e9eb", 500: "#8a2e3b", 600: "#6f2330" },
    },
    radii: { sm: "2px", DEFAULT: "4px", md: "6px", lg: "8px", xl: "10px", "2xl": "12px", "3xl": "16px" },
    fontVariables: {
      "--font-body-family": "var(--font-grotesk)",
      // Headings: Newsreader, the logo's serif, at a calm book weight.
      "--font-display-family": "var(--font-editorial)",
      "--font-display-weight": "500",
      "--font-display-tracking": "-0.012em",
      "--eyebrow-weight": "600",
    },
    components: {
      // Sentence-case labels; eyebrows stay uppercase with open tracking.
      "--caps-transform": "none",
      "--caps-spread": "0",
      "--eyebrow-transform": "uppercase",
      "--eyebrow-spread": "0.6",
      "--gloss": "0",
      "--glass-alpha": "0.94",
      "--header-shadow": "0 1px 0 0 rgb(var(--color-ink-200))",
      "--control-radius": "var(--radius-default)",
      // Secondary blue (#123B73, 10.2:1 on ivory): hover and interactive states.
      "--accent-hover": "rgb(18 59 115)",
      // The same blue as the `accent-hover` role, which the Button primitive's hover reads.
      "--color-accent-hover": "18 59 115",
      "--nav-hover": "rgb(18 59 115)",
      "--nav-underline": "rgb(214 193 162)",
      "--icon-stroke": "1.5",
      // On navy (footer, editorial banner, flash sale) eyebrows and link hovers take the warm stone; the light sections
      // redeclare it (band components) because stone is unreadable on ivory.
      "--band-accent": "rgb(214 193 162)",
      "--badge-note-bg": "rgb(var(--color-surface) / 0.94)",
      "--badge-note-fg": "rgb(var(--color-ink-900))",
      "--media-scrim": "rgb(var(--color-ink-950) / 0.4)",
      // Category tiles: the name below the photograph.
      "--tile-caption-position": "static",
      "--tile-caption-padding": "0.875rem 0.125rem 0.125rem",
      "--tile-media-radius": "var(--radius-default)",
      "--line-item-radius": "var(--radius-md)",
      "--stepper-radius": "var(--radius-default)",
      // White cards with a warm hairline and no lift; a soft navy shadow on hover.
      "--card-lift": "0",
      "--card-frame-border": "rgb(var(--color-ink-200))",
      "--card-frame-shadow": "none",
      "--card-frame-shadow-hover": "0 12px 28px -18px rgb(11 31 51 / 0.35)",
      "--card-image-zoom": "1.04",
      "--card-tier-display": "none",
      "--product-tier-display": "none",
      "--card-title-tracking": "0",
      "--panel-border": "rgb(var(--color-ink-200))",
      "--panel-shadow": "none",
      // The product name in the heading serif, like every other title.
      "--product-title-family": "var(--font-display-family), var(--font-taka), var(--font-bn), ui-serif, Georgia, serif",
      "--product-title-size": "clamp(1.75rem, 1.5rem + 0.8vw, 2.25rem)",
      "--product-title-leading": "1.15",
      "--product-title-weight": "500",
      "--product-title-tracking": "-0.012em",
      // Option chips, colour swatches and the floating buttons: squared off, like the controls.
      "--chip-radius": "var(--radius-sm)",
      "--swatch-radius": "var(--radius-sm)",
      "--fab-radius": "var(--radius-default)",
      // One modest scale: titles lead, but never shout over the products.
      "--section-title-size": "1.5rem",
      "--section-title-leading": "1.2",
      "--section-title-size-sm": "1.75rem",
      "--section-title-leading-sm": "1.2",
      "--section-rhythm": "1.1",
      "--page-title-size": "2rem",
      "--page-title-leading": "1.1",
      "--page-title-size-sm": "2.625rem",
      "--page-title-leading-sm": "1.1",
      "--section-heading-size": "1.625rem",
      "--section-heading-leading": "1.2",
      "--section-heading-size-sm": "2.125rem",
      "--section-heading-leading-sm": "1.15",
      // Editorial hero: left-aligned copy beside a tall photograph from 1024px.
      "--hero-align": "left",
      "--hero-layout-lg": "grid",
      "--hero-media-aspect-lg": "4 / 5",
      "--hero-content-max-w-lg": "80rem",
      "--hero-copy-pad-lg": "2rem",
      "--hero-media-offset-lg": "0",
      "--hero-secondary-ring": "currentColor",
      "--hero-primary-mr": "0.75rem",
      "--hero-secondary-ml": "0px",
      "--story-media-max-w": "64rem",
      "--story-media-h-sm": "26rem",
      // Sheets squared off like the rest of the controls, still soft enough to read as a sheet.
      "--sheet-radius": "0.75rem",
    },
    // The hero and the brand story render on ivory; the footer, flash sale and editorial banner stay navy.
    lightBands: ["hero", "story"],
    bandSurface: "cream-100",
    // Inside the light sections: the filled primary action (cream-50 / ink-950 are navy / ivory there) and a blue accent.
    bandComponents: {
      "--hero-cta-fill": "rgb(var(--color-cream-50))",
      "--hero-cta-text": "rgb(var(--color-ink-950))",
      "--band-accent": "rgb(18 59 115)",
    },
    // Inside the navy sections: the mid tones the dark palette uses for text, re-valued light enough for navy.
    darkBandPalette: { ink: { 300: "#dcd6cb", 400: "#d6c1a2", 500: "#a3a9b4" } },
  },
  // Tahafi — modern modest menswear (docs/brand/tahafi/THEME_BLUEPRINT.md). Olive-black (#1E211B) for type, olive
  // (#3E4A33) for actions, warm cream (#F4F0E8) page, sand (#E9E2D2) wells, brass (#A8843C) only for small marks (nav
  // underline, badges, accents on dark), terracotta (#B4492F) for promotions. Instrument Serif titles over Geist; its own
  // layout preset (`tahafi`): the brand's hang-tag carries the hero's featured price.
  tahafi: {
    label: "Tahafi (olive · cream · brass)",
    layout: "tahafi",
    palette: {
      ink: {
        50: "#efeadf", // subtle fills
        100: "#e7e1d4", // subtle hairlines
        200: "#ddd6c8", // warm border (lines, inputs)
        300: "#cfc6b4", // strong line
        400: "#5f6357", // tertiary text (struck prices, hints) — 5.4:1 on cream, 4.7:1 on sand
        500: "#575b50", // secondary text — 6.1:1 on cream
        600: "#3b3f36",
        700: "#2a2e25", // body text
        800: "#303a27", // olive, deeper: hover of olive actions
        900: "#1e211b", // olive-black: headings, text — 14.6:1 on cream
        950: "#1e211b", // the dark sections and footer
      },
      // 100 = the cream page; 200 = sand wells behind product photos.
      cream: { 50: "#fbf9f5", 100: "#f4f0e8", 200: "#e9e2d2", 300: "#ddd4c0" },
      // Terracotta, the one promotional accent: 5.6:1 under the light badge text, 5.0:1 as text on cream.
      sale: { 50: "#f6e6e1", 500: "#b4492f", 600: "#963b26" },
    },
    radii: { sm: "2px", DEFAULT: "3px", md: "4px", lg: "6px", xl: "8px", "2xl": "10px", "3xl": "14px" },
    fontVariables: {
      "--font-body-family": "var(--font-geist)",
      "--font-display-family": "var(--font-instrument-serif)",
      "--font-display-weight": "400",
      "--font-display-tracking": "-0.01em",
      "--eyebrow-weight": "500",
    },
    components: {
      // Olive actions (9.9:1 under cream text) — the role, not a palette step, so text stays olive-black.
      "--color-accent": "62 74 51",
      "--color-accent-hover": "48 58 39",
      "--accent-hover": "rgb(48 58 39)",
      // Sentence case everywhere: no tracked-out capitals.
      "--caps-transform": "none",
      "--caps-spread": "0",
      "--eyebrow-transform": "none",
      "--eyebrow-spread": "0",
      "--gloss": "0",
      "--glass-alpha": "0.95",
      "--header-shadow": "0 1px 0 0 rgb(var(--color-ink-200))",
      "--nav-hover": "rgb(62 74 51)",
      "--nav-underline": "rgb(168 132 60)",
      "--tag-thread": "rgb(168 132 60)",
      "--icon-stroke": "1.5",
      "--band-accent": "rgb(200 184 154)",
      "--badge-note-bg": "rgb(168 132 60)",
      "--badge-note-fg": "rgb(30 33 27)",
      "--media-scrim": "rgb(var(--color-ink-950) / 0.4)",
      // Product cards: the photograph on sand, 4:5, no frame and no lift.
      "--card-media-aspect": "4 / 5",
      "--card-lift": "0",
      "--card-frame-border": "transparent",
      "--card-frame-shadow": "none",
      "--card-frame-shadow-hover": "none",
      "--card-image-zoom": "1.03",
      "--card-title-tracking": "0",
      "--card-tier-display": "none",
      "--product-tier-display": "none",
      "--panel-border": "rgb(var(--color-ink-200))",
      "--panel-shadow": "none",
      "--line-item-radius": "var(--radius-md)",
      // The serif runs large: it is narrow and light.
      "--product-title-family": "var(--font-display-family), var(--font-taka), var(--font-bn), ui-serif, Georgia, serif",
      "--product-title-size": "clamp(2.125rem, 1.75rem + 1.2vw, 2.875rem)",
      "--product-title-leading": "1.02",
      "--product-title-weight": "400",
      "--product-title-tracking": "-0.01em",
      "--section-title-size": "2rem",
      "--section-title-leading": "1.05",
      "--section-title-size-sm": "2.75rem",
      "--section-title-leading-sm": "1",
      "--section-rhythm": "1.15",
      "--page-title-size": "2.5rem",
      "--page-title-leading": "1.02",
      "--page-title-size-sm": "3.5rem",
      "--page-title-leading-sm": "1",
      "--section-heading-size": "2.125rem",
      "--section-heading-leading": "1.05",
      "--section-heading-size-sm": "3rem",
      "--section-heading-leading-sm": "1",
      // Editorial hero: left-aligned copy beside a tall photograph from 1024px.
      "--hero-align": "left",
      "--hero-layout-lg": "grid",
      "--hero-media-aspect-lg": "4 / 5",
      "--hero-content-max-w-lg": "80rem",
      "--hero-copy-pad-lg": "2rem",
      "--hero-media-offset-lg": "0",
      "--hero-secondary-ring": "transparent",
      "--hero-primary-mr": "1.25rem",
      "--hero-secondary-ml": "0px",
      "--tile-caption-padding": "1.125rem",
      "--story-media-max-w": "64rem",
      "--story-media-h-sm": "28rem",
      "--sheet-radius": "1rem",
    },
    // The hero and the brand story render on cream; the footer, flash sale and promo bands stay olive-black.
    lightBands: ["hero", "story"],
    bandSurface: "cream-100",
    bandComponents: {
      "--hero-cta-fill": "rgb(62 74 51)",
      "--hero-cta-text": "rgb(244 240 232)",
      "--band-accent": "rgb(62 74 51)",
    },
    // Inside the dark sections: sand and warm greys for the secondary text.
    darkBandPalette: { ink: { 300: "#dcd5c6", 400: "#c8b89a", 500: "#a9a493" } },
  },
};

/**
 * `.ui-band-inverse` marks a section designed on the dark palette (light text on ink-950); its `data-band` attribute names
 * the section (hero, story, footer, flash, promo). A theme renders some or all of them light by mirroring the palette
 * inside them: each ink step takes its opposite (ink-950 ↔ the light surface, ink-300 ↔ ink-700 …) and the cream (light)
 * steps take dark inks, so every pairing keeps its contrast relationship. `band: "light"` mirrors every band;
 * `lightBands: [names]` only those sections. The variables that are references (brass alias, semantic roles) are
 * re-declared in the scope so they follow.
 */
function lightBand(definition) {
  const ink = { ...palette.ink, ...(definition.palette?.ink ?? {}) };
  const cream = { ...palette.cream, ...(definition.palette?.cream ?? {}) };
  const mirror = { 50: 950, 100: 900, 200: 800, 300: 700, 400: 600, 500: 500, 600: 400, 700: 300, 800: 200, 900: 100 };
  const variables = {};
  for (const [step, opposite] of Object.entries(mirror)) variables[`--color-ink-${step}`] = hexToRgbChannels(ink[opposite]);
  // The band's own surface: the theme's choice (`bandSurface`), else its soft secondary background rather than pure white.
  const [surfaceScale, surfaceStep] = (definition.bandSurface ?? "cream-200").split("-");
  variables["--color-ink-950"] = hexToRgbChannels({ ink, cream }[surfaceScale][surfaceStep]);
  Object.assign(variables, {
    "--color-cream-50": hexToRgbChannels(ink[900]),
    "--color-cream-100": hexToRgbChannels(ink[800]),
    "--color-cream-200": hexToRgbChannels(ink[700]),
    "--color-cream-300": hexToRgbChannels(ink[600]),
  });
  Object.assign(variables, referenceVariables());
  variables["--band-dark-art"] = "none";
  variables["--band-light-art"] = "contents";
  return variables;
}

/** The variables that are references to palette steps — re-declared in a scope that re-values those steps. */
function referenceVariables() {
  const variables = {};
  for (const [name, value] of Object.entries(cssVariables)) {
    if (value.startsWith("var(--color-")) variables[name] = value;
  }
  return variables;
}

/** Palette steps a theme re-values inside the sections that stay dark (`darkBandPalette`). */
function darkBand(definition) {
  if (!definition.darkBandPalette) return {};
  const variables = {};
  for (const [scale, steps] of Object.entries(definition.darkBandPalette)) {
    for (const [step, hex] of Object.entries(steps)) variables[`--color-${scale}-${step}`] = hexToRgbChannels(hex);
  }
  return { ...variables, ...referenceVariables() };
}

/**
 * The base design's dark sections (`.ui-band-inverse`): palette steps that read differently on the dark palette. The grey
 * text steps are mid greys on light surfaces but must stay light on ink-950: ink-400 #b3b3b3 (9.6:1; the light-surface
 * #707070 would be 4.0:1) and ink-500 #8a8a8a (5.8:1, the fine print; #666666 was 3.5:1). Emitted for every store under
 * `.ui-band-inverse`; a theme's own band variables (`:root[data-brand] .ui-band-inverse…`) are more specific and win.
 */
const inverseBandVariables = {
  "--color-ink-400": hexToRgbChannels("#b3b3b3"),
  "--color-ink-500": hexToRgbChannels("#8a8a8a"),
  ...referenceVariables(),
};

/**
 * A band forced dark in a theme that may render it light: the theme's own (unmirrored) palette, the base dark-band steps,
 * the theme's dark-band steps, and its light-band component values put back to what they are outside the bands.
 */
function darkTone(definition) {
  const variables = {};
  for (const scale of ["ink", "cream"]) {
    const steps = { ...palette[scale], ...(definition.palette?.[scale] ?? {}) };
    for (const [step, hex] of Object.entries(steps)) variables[`--color-${scale}-${step}`] = hexToRgbChannels(hex);
  }
  Object.assign(variables, inverseBandVariables, darkBand(definition), referenceVariables());
  for (const name of Object.keys(definition.bandComponents ?? {})) {
    // `initial` makes the property guaranteed-invalid, so `var(--x, fallback)` uses the call site's own default.
    variables[name] = definition.components?.[name] ?? cssVariables[name] ?? "initial";
  }
  variables["--band-dark-art"] = "contents";
  variables["--band-light-art"] = "none";
  return variables;
}

const themes = {};
for (const [id, definition] of Object.entries(themeDefinitions)) {
  const variables = {};
  for (const [scale, steps] of Object.entries(definition.palette ?? {})) {
    for (const [step, hex] of Object.entries(steps)) variables[`--color-${scale}-${step}`] = hexToRgbChannels(hex);
  }
  for (const [step, value] of Object.entries(definition.radii ?? {})) variables[radiusVariable(step)] = value;
  Object.assign(variables, definition.fontVariables, definition.components);
  const hasLightBands = definition.band === "light" || (definition.lightBands?.length ?? 0) > 0;
  themes[id] = {
    label: definition.label,
    // The structural preset the storefront renders its chrome with (apps/web/lib/theme-layout.ts); `classic` = the base design.
    layout: definition.layout ?? "classic",
    cssVariables: variables,
    // Inside the light sections: every band (`lightBandRoles: null`) or the named ones.
    bandVariables: { ...(hasLightBands ? lightBand(definition) : {}), ...definition.bandComponents },
    lightBandRoles: definition.band === "light" ? null : (definition.lightBands ?? []),
    // Inside the bands that stay dark.
    darkBandVariables: darkBand(definition),
    // A band whose tone the store chose per section (Storefront Studio → Style → Tone, `data-tone` on the band).
    toneVariables: { light: { ...lightBand(definition), ...definition.bandComponents }, dark: darkTone(definition) },
  };
}
const DEFAULT_THEME = "default";

/* ───────────────────────────── surfaces ───────────────────────────── */

/**
 * Surfaces — a region of the app with its own visual identity, independent of the store's brand theme. The Tailwind
 * plugin emits each one under `[data-surface="<id>"]` with the COMPLETE variable set (base tokens, then the surface's
 * overrides), so nothing a brand theme set on :root leaks in: the admin looks the same in every installation. Semantic
 * roles are re-declared inside the scope, so they resolve against the surface's palette.
 *
 * `admin` — the Store Console (Blueprint V2 §H): Apple-style, light only, system type, one blue primary action.
 * `storefront` — resets a region inside the admin to the store's own look (the homepage builder's inline preview); the
 *  plugin layers the active brand theme on top of it.
 */
const surfaceDefinitions = {
  admin: {
    palette: {
      ink: {
        50: "#fbfbfd",
        100: "#f5f5f7",
        200: "#e8e8ed",
        300: "#d2d2d7",
        // P9 a11y (WCAG AA 4.5:1 for small text on white, the canvas #f5f5f7 AND the sidebar #efeff2): Apple's #86868b /
        // #6e6e73 measured 3.2–4.4:1 there, so the two text greys are a step darker.
        400: "#6a6a6f", // tertiary text — 5.4 / 4.9 / 4.7:1 (placeholders, hints, captions)
        500: "#5e5e63", // secondary text — 6.5 / 5.9 / 5.6:1
        600: "#515154",
        700: "#3a3a3c",
        800: "#2c2c2e",
        900: "#1d1d1f",
        950: "#111113",
      },
      cream: { 50: "#ffffff", 100: "#f5f5f7", 200: "#ececf0", 300: "#dedee3" },
      // Badge text on its pale fill ("Active"): #087d64 was 4.2:1 on success-100.
      success: { 700: "#06705a" },
      // Small warning text ("Unpaid", hints): #a66c1f was 4.0:1 on the canvas.
      warning: { 600: "#96611b" },
    },
    // Roles given a color of their own instead of a palette step. Blueprint V2 DR-3: Apple blue. P9 a11y: Apple's link blue
    // #0066cc (5.6:1 under white text, 5.1:1 as text on the canvas) — #0071e3 was 4.3:1 as link text on the canvas.
    roles: { accent: "#0066cc", "accent-hover": "#0071e3", "accent-fg": "#ffffff" },
    fontVariables: {
      // San Francisco on Apple devices, the app's sans face everywhere else. No serif titles in the admin.
      "--font-body-family": "-apple-system, BlinkMacSystemFont, var(--font-sans)",
      "--font-display-family": "-apple-system, BlinkMacSystemFont, var(--font-sans)",
      "--font-display-weight": "600",
      "--font-display-tracking": "-0.022em",
    },
    components: {
      "--gloss": "0", // flat fills: depth comes from shadow and translucency, not a sheen
      "--glass-alpha": "0.72",
      "--caps-transform": "none",
      "--caps-spread": "0",
      // ERP UI plan (tab 21 §1) data meaning: one look for a figure that is an estimate (Estimated, Provisional) and one
      // for a missing value (Cost missing), everywhere. Default to the existing neutral / warning badge pairs.
      "--data-estimate-bg": "rgb(var(--color-ink-100))",
      "--data-estimate-fg": "rgb(var(--color-ink-700))",
      // Money (finance) "Liquid Glass" — owner, 2026-10-31: the finance area alone gets an iPhone-style glossy feel; the
      // rest of the admin stays flat. Recipes .liquid, .liquid-pass, .liquid-key and .liquid-chip (globals.css) read these
      // inside [data-area="finance"], which also turns the shared button gloss on.
      "--finance-gloss": "0.75",
      "--liquid-fill": "linear-gradient(180deg, rgba(255,255,255,0.94) 0%, rgba(255,255,255,0.80) 100%)",
      "--liquid-shadow": "inset 0 1px 0 rgba(255,255,255,0.95), 0 0 0 0.5px rgba(0,0,0,0.07), 0 1px 2px rgba(0,0,0,0.04), 0 14px 34px -18px rgba(20,24,40,0.28)",
      "--liquid-shadow-hover": "inset 0 1px 0 rgba(255,255,255,0.95), 0 0 0 0.5px rgba(0,0,0,0.09), 0 2px 4px rgba(0,0,0,0.05), 0 20px 40px -18px rgba(20,24,40,0.34)",
      // The Money palette: neutrals almost everywhere, colour only where it means something. Graphite actions (no
      // system blue) and one deep money green for "up" — RGB channels, so the role variables can take them.
      "--finance-canvas": "246 245 242",
      "--finance-accent": "28 28 30",
      "--finance-accent-hover": "58 58 60",
      "--finance-money-500": "22 128 95",
      "--finance-money-600": "14 107 80",
      "--finance-money-700": "10 86 64",
      // The money card: deep graphite, the one dark thing on the screen, with a faint light streak across it.
      "--pass-fill": "linear-gradient(150deg, #2c2c2e 0%, #1c1c1e 55%, #141415 100%)",
      "--pass-sheen": "linear-gradient(115deg, rgba(255,255,255,0) 30%, rgba(255,255,255,0.07) 46%, rgba(255,255,255,0) 60%)",
      "--pass-shadow": "inset 0 1px 0 rgba(255,255,255,0.10), 0 0 0 0.5px rgba(0,0,0,0.30), 0 30px 60px -28px rgba(20,20,22,0.55), 0 8px 18px -10px rgba(20,20,22,0.30)",
      // Text on the money card (RGB channels): white, and a soft grey for the small print.
      "--pass-fg": "255 255 255",
      "--pass-fg-muted": "174 174 178",
      // Wallet cards: one white material — the kind shows in a small mark, not a pastel tint.
      "--pass-cash": "#ffffff",
      "--pass-bank": "#ffffff",
      "--pass-wallet": "#ffffff",
      // The small round mark on each wallet card: money green, graphite, and bKash's own pink for mobile wallets.
      "--mark-cash": "#16805f",
      "--mark-bank": "#1c1c1e",
      "--mark-wallet": "#e2136e",
      // An action key's icon well (round, glossy).
      "--key-fill": "linear-gradient(180deg, #ffffff 0%, #eef0f4 100%)",
      "--key-shadow": "inset 0 1px 0 rgba(255,255,255,1), inset 0 -1px 0 rgba(0,0,0,0.05), 0 0 0 0.5px rgba(0,0,0,0.08), 0 8px 18px -8px rgba(20,24,40,0.30)",
      "--data-missing-bg": "rgb(var(--color-warning-100))",
      "--data-missing-fg": "rgb(var(--color-warning-700))",
    },
    // Calmer corners: cards 16px, controls 10px.
    radii: { sm: "6px", DEFAULT: "8px", md: "10px", lg: "12px", xl: "16px", "2xl": "20px", "3xl": "28px" },
    // Near-flat content (a hairline border does the separating); real depth only on floating layers.
    shadows: {
      sm: "0 1px 1px 0 rgba(0,0,0,0.03)",
      DEFAULT: "0 1px 2px 0 rgba(0,0,0,0.04), 0 0 1px 0 rgba(0,0,0,0.03)",
      lg: "0 12px 32px -12px rgba(0,0,0,0.16), 0 2px 6px -2px rgba(0,0,0,0.05)",
      float: "0 4px 14px -4px rgba(0,0,0,0.10), 0 1px 3px 0 rgba(0,0,0,0.04)",
      floatLg: "0 24px 56px -16px rgba(0,0,0,0.24), 0 4px 12px -4px rgba(0,0,0,0.08)",
      glass: "0 0 0 0.5px rgba(0,0,0,0.08), 0 12px 32px -12px rgba(0,0,0,0.18)",
      "glass-lg": "0 0 0 0.5px rgba(0,0,0,0.10), 0 28px 64px -18px rgba(0,0,0,0.30)",
      inset: "0 0 #0000", // flat fields (a literal "none" would break Tailwind's composed box-shadow list)
      glow: "0 0 0 4px rgba(0,102,204,0.18)",
    },
    // Room to breathe: the airier Apple rhythm over the dense ERP baseline.
    density: { sidebar: "248px", "sidebar-collapsed": "84px", header: "64px", page: "32px", "page-compact": "20px", row: "48px", "row-dense": "40px", control: "36px", "filter-bar": "44px" },
  },
  storefront: {},
};

const surfaces = {};
for (const [id, definition] of Object.entries(surfaceDefinitions)) {
  const variables = { ...cssVariables };
  for (const [scale, steps] of Object.entries(definition.palette ?? {})) {
    for (const [step, hex] of Object.entries(steps)) variables[`--color-${scale}-${step}`] = hexToRgbChannels(hex);
  }
  for (const [role, hex] of Object.entries(definition.roles ?? {})) variables[`--color-${role}`] = hexToRgbChannels(hex);
  for (const [step, value] of Object.entries(definition.radii ?? {})) variables[radiusVariable(step)] = value;
  for (const [key, value] of Object.entries(definition.shadows ?? {})) variables[shadowVariable(key)] = value;
  for (const [name, value] of Object.entries(definition.density ?? {})) variables[`--density-${name}`] = value;
  Object.assign(variables, definition.fontVariables, definition.components);
  surfaces[id] = { cssVariables: variables };
}

module.exports = {
  themes,
  cornerPresets,
  inverseBandVariables,
  surfaces,
  DEFAULT_THEME,
  palette,
  semantic,
  cssVariables,
  colors,
  fontFamily,
  fontSize,
  borderRadius,
  boxShadow: boxShadowRefs,
  zIndex,
  density,
  densitySpacing,
  motion,
  transitionTimingFunction,
  transitionDuration,
};
