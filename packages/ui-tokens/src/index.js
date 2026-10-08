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
  // True neutral gray scale. 900 = primary text, 500 = secondary text, 200 = border.
  ink: {
    50: "#fafafa",
    100: "#f5f5f5",
    200: "#ececec",
    300: "#d9d9d9",
    400: "#b3b3b3",
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
  success: { 50: "#e9f9f4", 100: "#cdf0e4", 200: "#a8e4d0", 500: "#12b491", 600: "#0aa382", 700: "#087d64" },
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
  // --font-bn follows the Latin font so the browser falls back per glyph (৳, Bengali text).
  sans: ["var(--font-body-family)", "var(--font-bn)", "ui-sans-serif", "system-ui", "sans-serif"],
  // `--font-display-family` (set below) is the title face; a theme can swap it, e.g. to the sans face.
  display: ["var(--font-display-family)", "var(--font-bn)", "ui-serif", "Georgia", "serif"],
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
  },
  spring: { stiffness: 420, damping: 32, mass: 0.9 },
};

const toCubic = (e) => `cubic-bezier(${e.join(", ")})`;

const transitionTimingFunction = {
  smooth: toCubic(motion.easing.smooth),
  standard: toCubic(motion.easing.standard),
  exit: toCubic(motion.easing.exit),
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
  // Category tiles: the scrim behind the name, and the name's color.
  "--tile-scrim": "rgb(var(--color-ink-950) / 0.6)",
  "--tile-label": "rgb(var(--color-cream-50))",
  // Primary call to action on the hero band: its fill and text (transparent = the outline style).
  "--hero-cta-fill": "transparent",
  // Cart line items: the product thumbnail on the cart page and the quantity stepper (square in the base design).
  "--line-item-radius": "0px",
  "--stepper-radius": "0px",
  // Product card.
  "--card-lift": "-0.25rem",
  "--card-frame-border": "rgb(var(--color-ink-100))",
  "--card-frame-shadow": "0 1px 2px 0 rgba(20,20,20,0.06)",
  "--card-frame-shadow-hover": "0 2px 6px -1px rgba(20,20,20,0.07), 0 8px 20px -4px rgba(20,20,20,0.10)",
  "--card-image-zoom": "1.05",
  "--card-tier-display": "block",
  "--product-tier-display": "inline",
  "--card-title-tracking": "0.025em",
  // Content tiles (values grid, info panels): their hairline frame.
  "--panel-border": "rgb(var(--color-ink-100))",
  "--panel-shadow": "0 1px 2px 0 rgba(20,20,20,0.06)",
  // Product page title.
  "--product-title-size": "1.875rem",
  "--product-title-leading": "2.25rem",
  "--product-title-weight": "500",
  "--product-title-tracking": "0.025em",
  // Section titles (carousels and other homepage/product-page rails): mobile, then ≥640px.
  "--section-title-size": "1.25rem",
  "--section-title-leading": "1.75rem",
  "--section-title-size-sm": "1.5rem",
  "--section-title-leading-sm": "2rem",
  // Vertical rhythm: a multiplier on the block padding of homepage and product-page sections.
  "--section-rhythm": "1",
  // Page titles (<h1> of cart, checkout, account, wishlist, order pages): mobile, then ≥640px.
  "--page-title-size": "1.5rem",
  "--page-title-leading": "2rem",
  "--page-title-size-sm": "1.5rem",
  "--page-title-leading-sm": "2rem",
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
  "--product-title-family": "var(--font-display-family), var(--font-bn), ui-serif, Georgia, serif",
  // Brand story image: its maximum width, and its height from 640px.
  "--story-media-max-w": "28rem",
  "--story-media-h-sm": "18rem",
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
  // Nasihamart — premium Islamic lifestyle, editorial. Deep navy (#0B1F33) for text, actions and the dark sections, soft
  // ivory (#F8F6F1) canvas with white surfaces, secondary blue (#123B73) for hover and interaction (--accent-hover,
  // --nav-hover), warm stone (#D6C1A2) as a restrained accent on navy only (1.6:1 on ivory — never text there). Editorial
  // serif titles (Newsreader) over a refined grotesk (Instrument Sans); near-square controls and cards instead of pills;
  // hairline warm borders.
  nasihamart: {
    label: "Nasihamart (navy · ivory · warm stone)",
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
      cream: { 50: "#ffffff", 100: "#f8f6f1", 200: "#f1ede5", 300: "#e5e0d7" },
      // The one promotional accent, deep enough that white 10px badge text clears AA (5.0:1).
      sale: { 50: "#fdecea", 500: "#d32f2f", 600: "#b71c1c" },
    },
    radii: { sm: "2px", DEFAULT: "4px", md: "6px", lg: "8px", xl: "10px", "2xl": "12px", "3xl": "16px" },
    fontVariables: {
      "--font-body-family": "var(--font-grotesk)",
      "--font-display-family": "var(--font-editorial)",
      "--font-display-weight": "400",
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
      // Category tiles: the name below the photograph in navy, no scrim.
      "--tile-scrim": "transparent",
      "--tile-label": "rgb(var(--color-ink-900))",
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
      // Product data is set in the UI face; the serif is for editorial headings.
      "--product-title-family": "var(--font-body-family), var(--font-bn), ui-sans-serif, system-ui, sans-serif",
      "--product-title-size": "clamp(1.75rem, 1.4rem + 1vw, 2.25rem)",
      "--product-title-leading": "1.15",
      "--product-title-weight": "500",
      "--product-title-tracking": "-0.018em",
      "--section-title-size": "1.625rem",
      "--section-title-leading": "1.2",
      "--section-title-size-sm": "2rem",
      "--section-title-leading-sm": "1.15",
      "--section-rhythm": "1.35",
      "--page-title-size": "2rem",
      "--page-title-leading": "1.15",
      "--page-title-size-sm": "2.5rem",
      "--page-title-leading-sm": "1.1",
      "--section-heading-size": "1.875rem",
      "--section-heading-leading": "1.15",
      "--section-heading-size-sm": "2.75rem",
      "--section-heading-leading-sm": "1.08",
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
    cssVariables: variables,
    // Inside the light sections: every band (`lightBandRoles: null`) or the named ones.
    bandVariables: { ...(hasLightBands ? lightBand(definition) : {}), ...definition.bandComponents },
    lightBandRoles: definition.band === "light" ? null : (definition.lightBands ?? []),
    // Inside the bands that stay dark.
    darkBandVariables: darkBand(definition),
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
