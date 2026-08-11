/** Matches the shape actually exported by index.js — plain nested string records, the same shape
 * Tailwind's own `theme.extend` accepts for colors/boxShadow/etc. */
type ColorScale = Record<string, string>;

interface UiTokens {
  colors: {
    ink: ColorScale;
    cream: ColorScale;
    brass: ColorScale;
    sale: ColorScale;
    success: ColorScale;
    warning: ColorScale;
    danger: ColorScale;
    info: ColorScale;
  };
  fontFamily: {
    sans: string[];
    display: string[];
  };
  borderRadius: Record<string, string>;
  boxShadow: Record<string, string>;
  transitionTimingFunction: Record<string, string>;
}

declare const tokens: UiTokens;
export = tokens;
