"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Order, OrderPaymentSummary, StoreSettings } from "@clothing-brand/shared";
import { LABEL_RENDER_SCALE, type FitResult } from "@/lib/label-fit";
import type { ResolvedGeometry } from "@/lib/label-templates";
import { LabelCard } from "./label-card";

interface LabelCaptureHostProps {
  /** Unique orders only — one label is rendered (and later rasterized) per order regardless of how
   * many page-slots or "copies" it occupies in the final layout. The caller mounts this component under a
   * `key` that changes whenever the orders, the template or the cell size change, so a fresh instance starts with
   * empty refs and state — a key-based remount instead of an internal reset effect, which raced against the
   * children's own ready callbacks in the same commit. */
  /** Each order carries its payment ledger position (`payment.codToCollect` is the COD amount printed). */
  orders: Array<Order & { payment: OrderPaymentSummary }>;
  store: StoreSettings | undefined;
  geometry: ResolvedGeometry;
  printedAt: Date;
  onReady: (nodes: Map<string, HTMLElement>, fits: Map<string, FitResult>) => void;
}

/** Hidden off-screen mount point the capture pipeline rasterizes from. Each LabelCard reports once it has fitted
 * itself to the cell (fonts loaded, barcode drawn); when every order has reported, a double requestAnimationFrame
 * (paint, then compositor flush) runs before the nodes and their fit results go back to the page. */
export function LabelCaptureHost({ orders, store, geometry, printedAt, onReady }: LabelCaptureHostProps) {
  const nodeRefs = useRef(new Map<string, HTMLDivElement>());
  const fitsRef = useRef(new Map<string, FitResult>());
  const [readyCount, setReadyCount] = useState(0);

  const markReady = useCallback((orderId: string, fit: FitResult) => {
    if (fitsRef.current.has(orderId)) return;
    fitsRef.current.set(orderId, fit);
    setReadyCount(fitsRef.current.size);
  }, []);

  useEffect(() => {
    if (orders.length === 0) {
      onReady(new Map(), new Map());
      return;
    }
    if (readyCount < orders.length) return;

    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => onReady(new Map(nodeRefs.current), new Map(fitsRef.current)));
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onReady intentionally excluded: one report per generation
  }, [orders.length, readyCount]);

  return (
    <div aria-hidden data-testid="label-capture-host" style={{ position: "fixed", top: 0, left: "-99999px", pointerEvents: "none" }}>
      {orders.map((order) => (
        <div
          key={order.id}
          data-label-order={order.orderNumber}
          ref={(el) => {
            if (el) nodeRefs.current.set(order.id, el);
          }}
          style={{ width: `${geometry.cellWmm * LABEL_RENDER_SCALE}mm`, height: `${geometry.cellHmm * LABEL_RENDER_SCALE}mm`, background: "#fff", overflow: "hidden" }}
        >
          <LabelCard
            order={order}
            store={store}
            wMm={geometry.cellWmm}
            hMm={geometry.cellHmm}
            printedAt={printedAt}
            onReady={(fit) => markReady(order.id, fit)}
          />
        </div>
      ))}
    </div>
  );
}
