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
    },
  },
  plugins: [],
};

export default config;
