"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Monitor, Smartphone, Tablet } from "lucide-react";
import type { Product } from "@clothing-brand/shared";
import { cn } from "@/lib/utils";
import {
  PREVIEW_DEVICE_WIDTH,
  PREVIEW_FRAME_PATH,
  type PreviewDevice,
  type PreviewMode,
  type PreviewReadyMessage,
  type PreviewUpdateMessage,
} from "@/lib/wizard/preview-protocol";

const MODES: { id: PreviewMode; label: string }[] = [
  { id: "product", label: "Product page" },
  { id: "listing", label: "Listing" },
  { id: "search", label: "Search" },
  { id: "social", label: "Social" },
  { id: "serp", label: "Google" },
];

const DEVICES: { id: PreviewDevice; label: string; icon: typeof Monitor }[] = [
  { id: "desktop", label: "Desktop", icon: Monitor },
  { id: "tablet", label: "Tablet", icon: Tablet },
  { id: "mobile", label: "Mobile", icon: Smartphone },
];

/** The customer's view of the product being edited, updated as the admin types. The storefront runs inside an iframe
 * at the chosen device's real width — so its own sm/lg breakpoints decide the layout, exactly as on that device — and
 * the iframe is then scaled down to fit this column. */
export function PreviewPane({ product, height }: { product: Product; height: number }) {
  const [mode, setMode] = useState<PreviewMode>("product");
  const [device, setDevice] = useState<PreviewDevice>("desktop");
  const frameRef = useRef<HTMLIFrameElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxWidth, setBoxWidth] = useState(0);

  const latest = useRef<PreviewUpdateMessage>({ type: "pim-preview:update", mode, product });
  latest.current = { type: "pim-preview:update", mode, product };

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setBoxWidth(entry?.contentRect.width ?? 0));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  function send() {
    frameRef.current?.contentWindow?.postMessage(latest.current, window.location.origin);
  }

  // The frame asks for the current state once its listener is attached; after that, every change is pushed.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin || e.source !== frameRef.current?.contentWindow) return;
      if ((e.data as PreviewReadyMessage)?.type === "pim-preview:ready") send();
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Coalesce bursts of keystrokes into one re-render of the frame.
  useEffect(() => {
    const t = setTimeout(send, 120);
    return () => clearTimeout(t);
  }, [product, mode]);

  const deviceWidth = PREVIEW_DEVICE_WIDTH[device];
  const scale = boxWidth > 0 ? Math.min(1, boxWidth / deviceWidth) : 1;

  return (
    <div className="flex flex-col gap-3" data-testid="preview-pane">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Preview surface">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={mode === m.id}
              onClick={() => setMode(m.id)}
              data-testid={`preview-mode-tab-${m.id}`}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors duration-150 ease-smooth",
                mode === m.id ? "bg-ink-900 text-cream-50" : "text-ink-500 hover:bg-ink-50 hover:text-ink-900",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1" aria-label="Device">
          {DEVICES.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-label={label}
              aria-pressed={device === id}
              onClick={() => setDevice(id)}
              data-testid={`preview-device-${id}`}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-150 ease-smooth",
                device === id ? "bg-ink-900 text-cream-50" : "text-ink-400 hover:bg-ink-50 hover:text-ink-900",
              )}
            >
              <Icon size={14} />
            </button>
          ))}
        </div>
      </div>

      <div ref={boxRef} className="w-full">
        <div className="mx-auto overflow-hidden rounded-xl border border-ink-100 bg-white" style={{ width: deviceWidth * scale, height }}>
          <iframe
            ref={frameRef}
            src={PREVIEW_FRAME_PATH}
            title="Customer preview"
            data-testid="preview-frame"
            data-device-width={deviceWidth}
            style={{ width: deviceWidth, height: height / scale, transform: `scale(${scale})`, transformOrigin: "top left", border: 0 }}
          />
        </div>
      </div>
      <p className="text-[11px] text-ink-400">
        {deviceWidth}px wide{scale < 1 ? `, shown at ${Math.round(scale * 100)}%` : ""} · updates as you type, before anything is saved
      </p>
    </div>
  );
}
