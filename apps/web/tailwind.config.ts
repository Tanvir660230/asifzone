import type { Config } from "tailwindcss";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const tokens = require("@clothing-brand/ui-tokens");

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: tokens.colors,
      fontFamily: tokens.fontFamily,
      borderRadius: tokens.borderRadius,
      boxShadow: tokens.boxShadow,
      transitionTimingFunction: tokens.transitionTimingFunction,
      keyframes: {
        "modal-in": {
          from: { opacity: "0", transform: "scale(0.96) translateY(8px)" },
          to: { opacity: "1", transform: "scale(1) translateY(0)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        // Same lift-in as "modal-in", but with the horizontal centering transform (translateX(-50%))
        // baked into both keyframe states — for elements centered via `left-1/2 -translate-x-1/2`,
        // animating plain `scale()/translateY()` would overwrite that centering transform mid-animation
        // (transform is a single property) and the element would visibly jump right-to-center once the
        // animation finished. This variant keeps the centering offset constant throughout.
        "dropdown-in": {
          from: { opacity: "0", transform: "translateX(-50%) scale(0.96) translateY(8px)" },
          to: { opacity: "1", transform: "translateX(-50%) scale(1) translateY(0)" },
        },
      },
      animation: {
        "modal-in": "modal-in 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
        "fade-in": "fade-in 0.2s ease-out",
        "dropdown-in": "dropdown-in 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
