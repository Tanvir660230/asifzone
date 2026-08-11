/** Brand design tokens shared by Tailwind config and any raw CSS. Premium, minimal, neutral
 * palette — pure white surfaces, true neutral gray text/borders, one red accent reserved for
 * promotional labels (see `sale`). Swap these values to re-theme the whole site from one place. */
module.exports = {
  colors: {
    // True neutral gray scale (no warm/brown tint). Anchored at the brand spec: 900 = primary
    // text, 500 = secondary text, 200 = border.
    ink: {
      DEFAULT: "#111111",
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
    // Background family — pure/soft white instead of the old warm cream tint.
    cream: {
      DEFAULT: "#f8f8f8",
      50: "#ffffff",
      100: "#f8f8f8",
      200: "#f0f0f0",
      300: "#e0e0e0",
    },
    // `brass` was the old gold accent, used sitewide (~80 files) as a generic UI accent —
    // hover states, focus glow, active-nav highlight, toggle "on" state, small badges — almost
    // always paired with dark text on top (`bg-brass-400` + `text-ink-900`) or as a foreground
    // hover color (`text-brass-500/600`). The brand spec allows only one accent color (red, for
    // promo labels only), so every other accent must become neutral. Rather than hand-editing
    // every call site, this scale is aliased 1:1 to the neutral `ink` scale — same lightness at
    // each step, so existing dark-text-on-`brass-400` pairings stay legible, and every old gold
    // accent silently becomes a black/gray tone. New code should reach for `ink-*` directly.
    brass: {
      DEFAULT: "#b3b3b3",
      50: "#fafafa",
      100: "#f5f5f5",
      200: "#ececec",
      300: "#d9d9d9",
      400: "#b3b3b3",
      500: "#666666",
      600: "#4d4d4d",
      700: "#333333",
    },
    // The one and only accent color: promotional labels (Sale / % OFF / New Arrival / Limited
    // Item badges) only. Never use for errors/destructive actions — that's `danger`, below.
    sale: {
      DEFAULT: "#e53935",
      50: "#fdecea",
      500: "#e53935",
      600: "#c62828",
    },
    // Semantic status colors — muted to sit alongside ink/cream/brass instead of stock Tailwind hues.
    // The 500/600 anchors are validated as a set via the dataviz skill's validate_palette.js
    // (chroma floor, CVD separation, normal-vision floor, contrast) — don't tweak one in isolation
    // without re-running it against the other three.
    success: { 50: "#e9f9f4", 100: "#cdf0e4", 500: "#12b491", 600: "#0aa382", 700: "#087d64" },
    warning: { 50: "#fdf6ec", 100: "#faead0", 500: "#c8862c", 600: "#a66c1f", 700: "#855517" },
    danger: { 50: "#fbeeee", 100: "#f6d9d8", 500: "#c1443c", 600: "#a0332c", 700: "#7c2721" },
    info: { 50: "#eef4f9", 100: "#d7e6f0", 500: "#2b6aad", 600: "#1f5f9e", 700: "#1a4c80" },
  },
  fontFamily: {
    // --font-bn comes right after the Latin font so the browser only falls back to it
    // per-glyph (e.g. the ৳ sign or Bengali text), which Inter/Playfair don't cover.
    sans: ["var(--font-sans)", "var(--font-bn)", "ui-sans-serif", "system-ui", "sans-serif"],
    // "Ampersand Fix" (see globals.css) covers only U+0026 — Playfair Display's "&" swash reads
    // as broken at heading sizes, so that one glyph is swapped for a plain serif "&" instead.
    display: ["Ampersand Fix", "var(--font-display)", "var(--font-bn)", "ui-serif", "Georgia", "serif"],
  },
  // Soft-editorial radius scale — replaces the previous near-square 2-6px scale.
  borderRadius: {
    none: "0px",
    sm: "4px",
    DEFAULT: "8px",
    md: "10px",
    lg: "14px",
    xl: "20px",
    full: "9999px",
  },
  // Ink-tinted elevation (warmer than pure-black shadows, matches the neutral palette).
  // "float"/"floatLg" add a second, tighter shadow layer for hover/active lift states —
  // stacking a soft far shadow with a crisp near shadow is what makes Apple-style elevation
  // read as "lifting" rather than just "bigger blur."
  boxShadow: {
    sm: "0 1px 2px 0 rgba(20,20,20,0.06)",
    DEFAULT: "0 4px 12px -2px rgba(20,20,20,0.08), 0 2px 4px -2px rgba(20,20,20,0.04)",
    lg: "0 12px 32px -4px rgba(20,20,20,0.14), 0 4px 8px -4px rgba(20,20,20,0.06)",
    float: "0 2px 6px -1px rgba(20,20,20,0.07), 0 8px 20px -4px rgba(20,20,20,0.10)",
    floatLg: "0 8px 16px -4px rgba(20,20,20,0.10), 0 20px 48px -8px rgba(20,20,20,0.18)",
    glow: "0 0 0 4px rgba(17,17,17,0.10)",
  },
  // Apple's signature "ease-out-expo" curve — motion starts fast and settles gently, reads as
  // smoother/more considered than the browser default eases used everywhere else on the web.
  transitionTimingFunction: {
    smooth: "cubic-bezier(0.16, 1, 0.3, 1)",
  },
};
