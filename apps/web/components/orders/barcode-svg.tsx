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
   * waits on this (via ShippingLabel/ShippingLabelCompact) to know the barcode is paint-ready before
   * rasterizing, since JsBarcode's DOM mutation happens in an effect, after React's own commit. */
  onReady?: () => void;
}

/** Renders a Code128 barcode straight into an <svg> node — no canvas, so it stays vector-crisp at
 * any print DPI (unlike a rasterized image). Used by ShippingLabel for the cut-and-paste print sheet.
 *
 * Two scanner-reliability details that are easy to get wrong: a scanner needs real whitespace
 * ("quiet zone") immediately next to the bars on both sides, baked into the image itself — CSS
 * padding on a wrapper isn't the same thing, so this always reserves horizontal margin inside the
 * SVG rather than trusting the caller's layout. And `max-w-full`/`h-auto` on the <svg> means a long
 * value (a longer tracking code, say) scales the whole barcode down to fit its container instead of
 * quietly overflowing it — JsBarcode only controls the SVG's own intrinsic size, not how it behaves
 * when that's wider than the space available. */
export function BarcodeSvg({ value, height = 40, width = 1.4, fontSize = 11, displayValue = true, onReady }: BarcodeSvgProps) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    JsBarcode(ref.current, value, {
      format: "CODE128",
      height,
      width,
      fontSize,
      marginTop: 0,
      marginBottom: 0,
      marginLeft: 6,
      marginRight: 6,
      displayValue,
    });
    onReady?.();
  }, [value, height, width, fontSize, displayValue, onReady]);

  return <svg ref={ref} className="h-auto max-w-full" />;
}
