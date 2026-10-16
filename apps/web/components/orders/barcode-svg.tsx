"use client";

import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

interface BarcodeSvgProps {
  value: string;
  height?: number;
  width?: number;
  fontSize?: number;
  /** False hides the human-readable digits row beneath the bars — used on the smallest sticker
   * templates, where there's no vertical room for both and the bars alone stay fully scannable. */
  displayValue?: boolean;
  /** Called once JsBarcode has actually drawn into the SVG — the label-printing capture pipeline
   * waits on this (via LabelCard) to know the barcode is paint-ready before
   * rasterizing, since JsBarcode's DOM mutation happens in an effect, after React's own commit. */
  onReady?: () => void;
  /** Stretch the bars to fill the parent box (width and height) instead of sizing from `width`/`height` — the label
   * layout engine sizes the box, so the barcode never changes the layout it measures. Stretching only widens every bar
   * by the same factor, which a scanner reads the same. Digits are the caller's own text in this mode. */
  fill?: boolean;
}

/** Renders a Code128 barcode straight into an <svg> node — no canvas, so it stays vector-crisp at
 * any print DPI (unlike a rasterized image). Used by LabelCard for shipping labels.
 *
 * Two scanner-reliability details that are easy to get wrong: a scanner needs real whitespace
 * ("quiet zone") immediately next to the bars on both sides, baked into the image itself — CSS
 * padding on a wrapper isn't the same thing, so this always reserves horizontal margin inside the
 * SVG rather than trusting the caller's layout. And `max-w-full`/`h-auto` on the <svg> means a long
 * value (a longer tracking code, say) scales the whole barcode down to fit its container instead of
 * quietly overflowing it — JsBarcode only controls the SVG's own intrinsic size, not how it behaves
 * when that's wider than the space available. */
export function BarcodeSvg({ value, height = 40, width = 1.4, fontSize = 11, displayValue = true, onReady, fill = false }: BarcodeSvgProps) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    JsBarcode(svg, value, {
      format: "CODE128",
      height,
      width,
      fontSize,
      marginTop: 0,
      marginBottom: 0,
      // Fill mode: a 10-module quiet zone each side (the Code 128 minimum), stretched along with the bars.
      marginLeft: fill ? width * 10 : 6,
      marginRight: fill ? width * 10 : 6,
      displayValue: fill ? false : displayValue,
    });
    if (fill) {
      const w = parseFloat(svg.getAttribute("width") ?? "0");
      const h = parseFloat(svg.getAttribute("height") ?? "0");
      svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
      svg.setAttribute("preserveAspectRatio", "none");
      svg.removeAttribute("width");
      svg.removeAttribute("height");
    }
    onReady?.();
  }, [value, height, width, fontSize, displayValue, onReady, fill]);

  return <svg ref={ref} className={fill ? "block h-full w-full" : "h-auto max-w-full"} shapeRendering={fill ? "crispEdges" : undefined} />;
}
