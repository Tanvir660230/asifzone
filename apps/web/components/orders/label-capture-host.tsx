"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Order, StoreSettings } from "@clothing-brand/shared";
import type { LabelTemplate, ResolvedGeometry } from "@/lib/label-templates";
import { ShippingLabel } from "./shipping-label";
import { ShippingLabelCompact, isCompactTemplateId } from "./shipping-label-compact";

// ShippingLabel was hand-tuned for a ~95mm x 91mm cell (see its own doc comment) — every non-compact
// template reuses it unmodified at any target size via LabelScaleWrapper's uniform CSS-transform
// scale, rather than re-deriving font sizes per template.
const NATIVE_LABEL_WMM = 95;
const NATIVE_LABEL_HMM = 91;

interface LabelCaptureHostProps {
  /** Unique orders only — one label is rendered (and later rasterized) per order regardless of how
   * many page-slots or "copies" it occupies in the final layout. The caller is responsible for
   * mounting this component under a `key` that changes whenever `orders` (which orders, not just how
   * many) or `template.id` changes — see the print-labels page's `captureKey`. That's deliberate: a
   * fresh key gives this component a genuinely new instance with empty refs/state, which is what
   * makes a "reset" correct and race-free. An internal effect that tried to detect "orders changed"
   * and manually clear refs/state raced against this same commit's child effects (BarcodeSvg's
   * onReady, fired during the very same mount) — whichever ran last won, and since a plain
   * `setState(0)` call doesn't merge with a sibling `setState(size)` call in the same batch, the
   * manual reset routinely clobbered a readiness count the children had *just* finished reporting,
   * permanently stalling the capture pipeline. Keying the remount instead sidesteps the race by
   * construction: there's nothing to race when the old instance is simply gone. */
  orders: Order[];
  store: StoreSettings | undefined;
  template: LabelTemplate;
  geometry: ResolvedGeometry;
  onReady: (nodes: Map<string, HTMLElement>) => void;
}

/** Hidden off-screen mount point the capture pipeline rasterizes from. Readiness isn't guessed via a
 * fixed timeout (flaky at both a 1-order and a 500-order batch): each label reports back once its
 * barcode has actually drawn (JsBarcode mutates the SVG in an effect, after React's commit, via the
 * onBarcodeReady callback threaded down to BarcodeSvg's onReady), tracked as a plain ready *count*.
 * Once that count reaches the expected order count, a double-requestAnimationFrame (one for the
 * mutation to paint, one to be sure the compositor flushed it) runs before handing node refs back.
 *
 * That completion check re-fires on every `geometry` change too, not just when the ready count first
 * reaches its target — an edit to margin/orientation resizes each cell's container (and rescales
 * LabelScaleWrapper's content) without changing any label's actual barcode/text content, so there's
 * no need to wait on the per-child callbacks again; the already-accumulated ready count is reused
 * as-is and just a couple of frames are given for the resized layout to settle before re-capturing. */
export function LabelCaptureHost({ orders, store, template, geometry, onReady }: LabelCaptureHostProps) {
  const nodeRefs = useRef(new Map<string, HTMLDivElement>());
  const readyIdsRef = useRef(new Set<string>());
  const [readyCount, setReadyCount] = useState(0);

  function markOrderReady(orderId: string) {
    if (readyIdsRef.current.has(orderId)) return;
    readyIdsRef.current.add(orderId);
    setReadyCount(readyIdsRef.current.size);
  }

  useEffect(() => {
    if (orders.length === 0) {
      onReady(new Map());
      return;
    }
    if (readyCount < orders.length) return;

    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => onReady(new Map(nodeRefs.current)));
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onReady/store intentionally excluded, see doc comment
  }, [orders.length, geometry.cellWmm, geometry.cellHmm, readyCount]);

  return (
    <div aria-hidden style={{ position: "fixed", top: 0, left: "-99999px", pointerEvents: "none" }}>
      {orders.map((order) => (
        <div
          key={order.id}
          ref={(el) => {
            if (el) nodeRefs.current.set(order.id, el);
          }}
          style={{ width: `${geometry.cellWmm}mm`, height: `${geometry.cellHmm}mm`, background: "#fff", overflow: "hidden" }}
        >
          {isCompactTemplateId(template.id) ? (
            <ShippingLabelCompact
              order={order}
              store={store}
              templateId={template.id}
              onBarcodeReady={() => markOrderReady(order.id)}
            />
          ) : (
            <LabelScaleWrapper targetWmm={geometry.cellWmm} targetHmm={geometry.cellHmm}>
              <ShippingLabel order={order} store={store} onBarcodeReady={() => markOrderReady(order.id)} />
            </LabelScaleWrapper>
          )}
        </div>
      ))}
    </div>
  );
}

interface LabelScaleWrapperProps {
  targetWmm: number;
  targetHmm: number;
  children: ReactNode;
}

/** Renders `children` at ShippingLabel's native 95x91mm size, then uniformly scales (never distorts)
 * to fit the target cell, centering the scaled box on whichever axis has leftover space. This is what
 * lets the same tuned design serve everything from a 210mm-wide A4 full-page label to a compact 100mm
 * sticker without touching ShippingLabel's internals per template. */
function LabelScaleWrapper({ targetWmm, targetHmm, children }: LabelScaleWrapperProps) {
  const scale = Math.min(targetWmm / NATIVE_LABEL_WMM, targetHmm / NATIVE_LABEL_HMM);
  const leftoverXmm = (targetWmm - NATIVE_LABEL_WMM * scale) / 2;
  const leftoverYmm = (targetHmm - NATIVE_LABEL_HMM * scale) / 2;

  return (
    <div style={{ position: "relative", width: `${targetWmm}mm`, height: `${targetHmm}mm`, background: "#fff", overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          left: `${leftoverXmm}mm`,
          top: `${leftoverYmm}mm`,
          width: `${NATIVE_LABEL_WMM}mm`,
          height: `${NATIVE_LABEL_HMM}mm`,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        {children}
      </div>
    </div>
  );
}
