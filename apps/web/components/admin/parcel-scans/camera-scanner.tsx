"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";

/** The browser's own detector where it exists (Chrome on Android, Edge) — no download. */
type Detector = { detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>> };
type DetectorCtor = new (opts: { formats: string[] }) => Detector;

const FORMATS = ["code_128", "code_39", "ean_13", "ean_8", "qr_code", "data_matrix", "itf", "upc_a", "upc_e", "pdf417"];

/**
 * Camera fallback for scanning (Order Operations phase 4) — the USB wedge scanner is the main tool. Uses the built-in
 * BarcodeDetector when the browser has one, otherwise loads ZXing only now (it is never in the page bundle). Keeps
 * scanning until closed; the same code read again within two seconds is ignored, so holding a parcel still is one scan.
 * Without camera permission or support it says so — the code can always be typed instead.
 */
export function CameraScanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<"starting" | "scanning" | "denied" | "unsupported">("starting");
  const lastRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  useEffect(() => {
    let stopped = false;
    let stop: (() => void) | null = null;
    const emit = (code: string) => {
      const now = Date.now();
      if (code === lastRef.current.code && now - lastRef.current.at < 2000) return;
      lastRef.current = { code, at: now };
      onCodeRef.current(code);
    };

    (async () => {
      const Native = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
      if (!navigator.mediaDevices?.getUserMedia) return setState("unsupported");
      try {
        if (Native) {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
          if (stopped) return stream.getTracks().forEach((t) => t.stop());
          const video = videoRef.current!;
          video.srcObject = stream;
          await video.play();
          const detector = new Native({ formats: FORMATS });
          let timer = 0;
          const tick = async () => {
            if (stopped) return;
            try {
              const found = await detector.detect(video);
              if (found[0]?.rawValue) emit(found[0].rawValue);
            } catch {
              // A frame that couldn't be read — try the next one.
            }
            timer = window.setTimeout(tick, 150);
          };
          void tick();
          stop = () => {
            window.clearTimeout(timer);
            stream.getTracks().forEach((t) => t.stop());
          };
        } else {
          const { BrowserMultiFormatReader } = await import("@zxing/browser");
          if (stopped) return;
          const reader = new BrowserMultiFormatReader();
          const controls = await reader.decodeFromConstraints({ video: { facingMode: "environment" } }, videoRef.current!, (result) => {
            if (result) emit(result.getText());
          });
          if (stopped) return controls.stop();
          stop = () => controls.stop();
        }
        setState("scanning");
      } catch (err) {
        const name = (err as { name?: string })?.name;
        setState(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unsupported");
      }
    })();

    return () => {
      stopped = true;
      stop?.();
    };
  }, []);

  return (
    <Modal
      open
      onClose={onClose}
      title="Scan with the camera"
      widthClassName="max-w-md"
      footer={
        <Button variant="outline" size="sm" onClick={onClose}>
          Done
        </Button>
      }
    >
      {state === "denied" ? (
        <p className="text-sm text-fg">Camera access was refused. Allow the camera for this site in the browser settings, or type the code instead.</p>
      ) : state === "unsupported" ? (
        <p className="text-sm text-fg">This device can&apos;t scan with its camera here. Type the code instead, or use a USB scanner.</p>
      ) : (
        <div className="space-y-2">
          <div className="relative overflow-hidden rounded-xl bg-ink-900">
            {/* Muted, inline: no sound, and iOS plays it in the page rather than full screen. */}
            <video ref={videoRef} className="aspect-[4/3] w-full object-cover" muted playsInline aria-label="Camera preview" />
            <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-accent/80" aria-hidden="true" />
          </div>
          <p className="text-xs text-fg-muted" aria-live="polite">
            {state === "starting" ? "Starting the camera…" : "Point at the parcel's barcode or QR code. Each code is added once."}
          </p>
        </div>
      )}
    </Modal>
  );
}
