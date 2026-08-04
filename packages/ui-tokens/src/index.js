/** Brand design tokens shared by Tailwind config and any raw CSS. Premium, minimal, neutral palette with a brass/gold accent — swap these values to re-theme the whole site from one place. */
module.exports = {
  colors: {
    ink: {
      DEFAULT: "#141414",
      50: "#f6f6f5",
      100: "#e7e6e4",
      200: "#cfccc8",
      300: "#a9a49d",
      400: "#7c766c",
      500: "#5c564c",
      600: "#46413a",
      700: "#38332e",
      800: "#242220",
      900: "#141414",
      950: "#0a0a0a",
    },
    cream: {
      DEFAULT: "#f8f6f2",
      50: "#fefdfb",
      100: "#f8f6f2",
      200: "#f0ece3",
      300: "#e4ddd0",
    },
    brass: {
      DEFAULT: "#b08d57",
      50: "#f8f2e9",
      100: "#efe1c9",
      200: "#ddc296",
      300: "#c9a56d",
      400: "#b08d57",
      500: "#93723f",
      600: "#755a32",
      700: "#5a4526",
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
    sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
    display: ["var(--font-display)", "ui-serif", "Georgia", "serif"],
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
  boxShadow: {
    sm: "0 1px 2px 0 rgba(20,20,20,0.06)",
    DEFAULT: "0 4px 12px -2px rgba(20,20,20,0.08), 0 2px 4px -2px rgba(20,20,20,0.04)",
    lg: "0 12px 32px -4px rgba(20,20,20,0.14), 0 4px 8px -4px rgba(20,20,20,0.06)",
  },
};
