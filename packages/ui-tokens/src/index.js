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
  sale: { 50: "#fdecea", 500: "#e53935", 600: "#c62828" },
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
  sans: ["var(--font-sans)", "var(--font-bn)", "ui-sans-serif", "system-ui", "sans-serif"],
  // "Ampersand Fix" (globals.css) swaps only U+0026 — Playfair's "&" swash reads as broken.
  display: ["Ampersand Fix", "var(--font-display)", "var(--font-bn)", "ui-serif", "Georgia", "serif"],
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

// Soft-editorial radius scale.
const borderRadius = {
  none: "0px",
  sm: "4px",
  DEFAULT: "8px",
  md: "10px",
  lg: "14px",
  xl: "20px",
  "2xl": "24px",
  "3xl": "32px",
  full: "9999px",
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

module.exports = {
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
