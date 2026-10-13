"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { StorefrontDesign, StudioSection } from "@clothing-brand/shared";
import { Spinner } from "@/components/ui/spinner";
import {
  isStudioMessage,
  STUDIO_DEVICE_WIDTH,
  STUDIO_FRAME_PATH,
  type StudioDevice,
  type StudioReadyMessage,
  type StudioRenderedMessage,
  type StudioScrollToMessage,
  type StudioSelectMessage,
  type StudioUpdateMessage,
} from "@/lib/studio/preview-protocol";
import { cn } from "@/lib/utils";

interface CanvasProps {
  sections: StudioSection[];
  design: StorefrontDesign;
  selectedId: string | null;
  device: StudioDevice;
  onSelect: (id: string) => void;
  onEmptyIds: (ids: string[]) => void;
  /** Bumped by the outline to scroll the preview to the selected section. */
  scrollRequest: { id: string; at: number } | null;
}

/**
 * The live preview: the storefront running in an iframe at the device's real width (so its own breakpoints decide the
 * layout, exactly as on that device), scaled down to fit the canvas. Draft changes are posted to it as they happen.
 */
export function Canvas({ sections, design, selectedId, device, onSelect, onEmptyIds, scrollRequest }: CanvasProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [ready, setReady] = useState(false);

  const latest = useRef<StudioUpdateMessage>({ type: "studio:update", sections, design, selectedId });
  latest.current = { type: "studio:update", sections, design, selectedId };
  const handlers = useRef({ onSelect, onEmptyIds });
  handlers.current = { onSelect, onEmptyIds };

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setBox({ width: entry?.contentRect.width ?? 0, height: entry?.contentRect.height ?? 0 }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  function send(message: StudioUpdateMessage | StudioScrollToMessage) {
    frameRef.current?.contentWindow?.postMessage(message, window.location.origin);
  }

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin || e.source !== frameRef.current?.contentWindow) return;
      if (isStudioMessage<StudioReadyMessage>(e.data, "studio:ready")) {
        setReady(true);
        send(latest.current);
      }
      if (isStudioMessage<StudioSelectMessage>(e.data, "studio:select")) handlers.current.onSelect(e.data.id);
      if (isStudioMessage<StudioRenderedMessage>(e.data, "studio:rendered")) handlers.current.onEmptyIds(e.data.emptyIds);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Coalesce bursts of keystrokes into one re-render of the frame.
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => send(latest.current), 60);
    return () => clearTimeout(t);
  }, [sections, design, selectedId, ready]);

  useEffect(() => {
    if (ready && scrollRequest) send({ type: "studio:scroll-to", id: scrollRequest.id });
  }, [scrollRequest, ready]);

  const deviceWidth = STUDIO_DEVICE_WIDTH[device];
  // Leave a margin around the device; never upscale past real size.
  const available = Math.max(0, box.width - (device === "desktop" ? 32 : 48));
  const scale = available > 0 ? Math.min(1, available / deviceWidth) : 1;
  const frameHeight = scale > 0 ? Math.max(0, (box.height - 32) / scale) : box.height;

  return (
    <div ref={boxRef} className="relative h-full overflow-hidden bg-surface-muted" data-testid="studio-canvas">
      <div
        className={cn(
          "absolute left-1/2 top-4 origin-top overflow-hidden bg-canvas shadow-float",
          device === "desktop" ? "rounded-lg" : "rounded-[28px] ring-1 ring-line",
        )}
        style={{ width: deviceWidth, height: frameHeight, transform: `translateX(-50%) scale(${scale})` }}
      >
        <iframe
          ref={frameRef}
          src={STUDIO_FRAME_PATH}
          title={`Homepage preview — ${device}`}
          className="h-full w-full border-0"
          data-testid="studio-frame"
          data-device-width={deviceWidth}
        />
      </div>
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-fg-muted">
          <Spinner /> Loading your homepage…
        </div>
      )}
    </div>
  );
}
