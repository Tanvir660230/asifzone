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

/** Layering scale — named so overlapping fixed elements never fight with ad-hoc numbers. */
const zIndex = {
  base: "0",
  raised: "10",
  sticky: "20",
  dock: "40", // fixed bottom bars
  overlay: "50", // modal / drawer / popover
  toast: "200",
};

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
  // Nasihamart — calm, product-first, sans throughout. Warm off-white canvas, warm near-black text,
  // softer and slightly larger radii. Still exactly one promotional accent (`sale`).
  nasihamart: {
    label: "Nasihamart (warm minimal)",
    palette: {
      ink: {
        50: "#faf9f7",
        100: "#f3f2ef",
        200: "#e7e5e0",
        300: "#d5d2cb",
        400: "#736e66", // tertiary text (struck-through prices, hints) — 4.7:1 on the canvas, AA for small text
        500: "#68645c", // secondary text — 5.4:1 on the canvas
        600: "#4e4a44",
        700: "#35322e",
        800: "#24221f",
        900: "#1b1a18",
        950: "#0f0e0d",
      },
      cream: { 50: "#ffffff", 100: "#f7f6f3", 200: "#efede8", 300: "#e3e0d9" },
      // The one promotional accent, a step deeper so white 10px badge text clears AA (5.0:1).
      sale: { 50: "#fdecea", 500: "#d32f2f", 600: "#b71c1c" },
    },
    radii: { sm: "6px", DEFAULT: "10px", md: "12px", lg: "18px", xl: "24px", "2xl": "28px", "3xl": "36px" },
    // Sans titles: semibold, tightly tracked, sentence-case labels.
    fontVariables: {
      "--font-display-family": "var(--font-sans)",
      "--font-display-weight": "600",
      "--font-display-tracking": "-0.022em",
      "--eyebrow-weight": "500",
    },
    components: {
      "--caps-transform": "none",
      "--caps-spread": "0",
      "--gloss": "0",
      "--glass-alpha": "0.86",
      "--header-shadow": "none",
      // Image-first cards: no frame, no lift, the gentlest zoom.
      "--badge-note-bg": "rgb(var(--color-surface) / 0.92)",
      "--badge-note-fg": "rgb(var(--color-ink-900))",
      "--tile-scrim": "rgb(var(--color-cream-50) / 0.6)",
      "--media-scrim": "rgb(var(--color-ink-950) / 0.22)",
      "--tile-label": "rgb(var(--color-ink-900))",
      "--line-item-radius": "var(--radius-md)",
      "--stepper-radius": "9999px",
      "--card-lift": "0",
      "--card-frame-border": "transparent",
      "--card-frame-shadow": "none",
      "--card-frame-shadow-hover": "none",
      "--card-image-zoom": "1.03",
      "--card-tier-display": "none",
      "--product-tier-display": "none",
      "--card-title-tracking": "-0.005em",
      "--panel-border": "transparent",
      "--panel-shadow": "none",
      "--product-title-size": "clamp(1.875rem, 1.35rem + 1.4vw, 2.5rem)",
      "--product-title-leading": "1.12",
      "--product-title-weight": "600",
      "--product-title-tracking": "-0.025em",
      "--section-title-size": "1.5rem",
      "--section-title-leading": "1.2",
      "--section-title-size-sm": "1.75rem",
      "--section-title-leading-sm": "1.15",
      "--section-rhythm": "1.3",
      "--page-title-size": "1.875rem",
      "--page-title-leading": "1.15",
      "--page-title-size-sm": "2.25rem",
      "--page-title-leading-sm": "1.1",
      "--section-heading-size": "1.75rem",
      "--section-heading-leading": "1.2",
      "--section-heading-size-sm": "2.25rem",
      "--section-heading-leading-sm": "1.1",
    },
    // Sections designed on the dark palette (`.ui-band-inverse`: footer, brand story, hero band) render light.
    band: "light",
    // Component tokens whose colors must resolve against the band's palette, so they are declared inside it.
    bandComponents: {
      // A filled primary button on the hero (cream-50 / ink-950 are dark / light inside a light band).
      "--hero-cta-fill": "rgb(var(--color-cream-50))",
      "--hero-cta-text": "rgb(var(--color-ink-950))",
    },
  },
};

/**
 * `.ui-band-inverse` marks a section designed on the dark palette (light text on ink-950). A theme
 * with `band: "light"` renders those sections light by mirroring the palette inside them: each ink
 * step takes its opposite (ink-950 ↔ the light canvas, ink-300 ↔ ink-700 …) and the cream (light)
 * steps take dark inks, so every pairing keeps its contrast relationship. The variables that are
 * references (brass alias, semantic roles) are re-declared in the scope so they follow.
 */
function lightBand(definition) {
  const ink = { ...palette.ink, ...(definition.palette?.ink ?? {}) };
  const cream = { ...palette.cream, ...(definition.palette?.cream ?? {}) };
  const mirror = { 50: 950, 100: 900, 200: 800, 300: 700, 400: 600, 500: 500, 600: 400, 700: 300, 800: 200, 900: 100 };
  const variables = {};
  for (const [step, opposite] of Object.entries(mirror)) variables[`--color-ink-${step}`] = hexToRgbChannels(ink[opposite]);
  // The band's own surface: the theme's soft secondary background rather than pure white.
  variables["--color-ink-950"] = hexToRgbChannels(cream[200]);
  Object.assign(variables, {
    "--color-cream-50": hexToRgbChannels(ink[900]),
    "--color-cream-100": hexToRgbChannels(ink[800]),
    "--color-cream-200": hexToRgbChannels(ink[700]),
    "--color-cream-300": hexToRgbChannels(ink[600]),
  });
  for (const [name, value] of Object.entries(cssVariables)) {
    if (value.startsWith("var(--color-")) variables[name] = value;
  }
  variables["--band-dark-art"] = "none";
  variables["--band-light-art"] = "contents";
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
  themes[id] = { label: definition.label, cssVariables: variables, bandVariables: { ...(definition.band === "light" ? lightBand(definition) : {}), ...definition.bandComponents } };
}
const DEFAULT_THEME = "default";

module.exports = {
  themes,
  DEFAULT_THEME,
  palette,
  semantic,
  cssVariables,
  colors,
  fontFamily,
  fontSize,
  borderRadius,
  boxShadow,
  zIndex,
  motion,
  transitionTimingFunction,
  transitionDuration,
};
