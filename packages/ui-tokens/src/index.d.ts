/** Mirrors the shape exported by index.js — plain records, the same shapes Tailwind's
 * `theme.extend` accepts, plus the raw palette/motion values for JS consumers. */
type Scale = Record<string, string>;
type CubicBezier = [number, number, number, number];

interface UiTokens {
  /** Raw hex values per scale — for places that genuinely need a literal color (e.g. canvas/SVG export). */
  palette: Record<string, Scale>;
  /** Semantic role -> palette reference ("canvas" -> "cream-100"). */
  semantic: Record<string, string>;
  /** `:root` custom properties: `--color-<scale>-<step>` (RGB channels) and `--color-<role>`. */
  cssVariables: Record<string, string>;
  colors: Record<string, Scale>;
  fontFamily: { sans: string[]; display: string[] };
  fontSize: Record<string, [string, { lineHeight: string; letterSpacing?: string }]>;
  borderRadius: Scale;
  boxShadow: Scale;
  zIndex: Scale;
  motion: {
    duration: { instant: number; fast: number; base: number; slow: number; slower: number };
    easing: { smooth: CubicBezier; standard: CubicBezier; exit: CubicBezier };
    spring: { stiffness: number; damping: number; mass: number };
  };
  transitionTimingFunction: Scale;
  transitionDuration: Scale;
}

declare const tokens: UiTokens;
export = tokens;
