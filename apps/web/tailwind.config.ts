import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";
import typography from "@tailwindcss/typography";
import tokens from "@clothing-brand/ui-tokens";

/** Every design value comes from @clothing-brand/ui-tokens — this file only wires it into Tailwind.
 * The color utilities resolve to CSS variables declared at :root by the plugin below, so a brand
 * theme can override them at runtime (see docs/DESIGN_SYSTEM.md). */
const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: tokens.colors,
      fontFamily: tokens.fontFamily,
      fontSize: tokens.fontSize,
      borderRadius: tokens.borderRadius,
      boxShadow: tokens.boxShadow,
      zIndex: tokens.zIndex,
      // Admin density baseline (P1.12): w-sidebar, h-header, h-row, h-control, px-page, max-w-drawer-md, …
      spacing: tokens.densitySpacing,
      maxWidth: tokens.densitySpacing,
      transitionTimingFunction: tokens.transitionTimingFunction,
      transitionDuration: tokens.transitionDuration,
      keyframes: {
        "modal-in": {
          from: { opacity: "0", transform: "scale(0.96) translateY(8px)" },
          to: { opacity: "1", transform: "scale(1) translateY(0)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        // Same lift-in as "modal-in", with the horizontal centering transform (translateX(-50%))
        // baked into both states — for elements centered via `left-1/2 -translate-x-1/2`, animating
        // plain scale()/translateY() would overwrite the centering transform mid-animation.
        "dropdown-in": {
          from: { opacity: "0", transform: "translateX(-50%) scale(0.96) translateY(8px)" },
          to: { opacity: "1", transform: "translateX(-50%) scale(1) translateY(0)" },
        },
        // Short lift for anchored menus/popovers — smaller travel than a modal.
        "pop-in": {
          from: { opacity: "0", transform: "scale(0.98) translateY(-4px)" },
          to: { opacity: "1", transform: "scale(1) translateY(0)" },
        },
        // Nudges a required-but-empty selector (e.g. size/color) when someone tries to add to cart early.
        shake: {
          "0%, 100%": { transform: "translateX(0)" },
          "20%": { transform: "translateX(-6px)" },
          "40%": { transform: "translateX(5px)" },
          "60%": { transform: "translateX(-4px)" },
          "80%": { transform: "translateX(3px)" },
        },
        "slide-in-right": {
          from: { transform: "translateX(100%)" },
          to: { transform: "translateX(0)" },
        },
        "slide-in-up": {
          from: { transform: "translateY(100%)" },
          to: { transform: "translateY(0)" },
        },
        shimmer: {
          from: { backgroundPosition: "200% 0" },
          to: { backgroundPosition: "-200% 0" },
        },
      },
      animation: {
        "modal-in": "modal-in 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
        "fade-in": "fade-in 0.2s ease-out",
        "dropdown-in": "dropdown-in 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
        "pop-in": "pop-in 0.18s cubic-bezier(0.16, 1, 0.3, 1)",
        shake: "shake 0.4s ease-in-out",
        "slide-in-right": "slide-in-right 0.32s cubic-bezier(0.16, 1, 0.3, 1)",
        "slide-in-up": "slide-in-up 0.32s cubic-bezier(0.16, 1, 0.3, 1)",
        shimmer: "shimmer 1.6s linear infinite",
      },
    },
  },
  plugins: [
    typography,
    plugin(({ addBase }) => {
      addBase({ ":root": tokens.cssVariables });
      // Brand themes override the same variables; `:root[data-brand]` outranks `:root`, whatever the order.
      for (const [id, theme] of Object.entries(tokens.themes)) {
        if (Object.keys(theme.cssVariables).length) addBase({ [`:root[data-brand="${id}"]`]: theme.cssVariables });
        // Dark-palette sections a theme renders light (see `lightBand` in @clothing-brand/ui-tokens).
        if (Object.keys(theme.bandVariables).length) addBase({ [`:root[data-brand="${id}"] .ui-band-inverse`]: theme.bandVariables });
      }
    }),
  ],
};

export default config;
