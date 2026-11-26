"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, CloudOff, Flashlight, FlashlightOff, Loader2, RefreshCw, X, XCircle, ZoomIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** The browser's own detector where it exists (Chrome on Android, Edge) — fast, hardware-accelerated. */
type Detector = { detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>> };
type DetectorCtor = new (opts: { formats: string[] }) => Detector;

const NATIVE_FORMATS = ["code_128", "code_39", "ean_13", "ean_8", "qr_code", "data_matrix", "itf", "upc_a", "upc_e", "pdf417"];

/** Extended track capabilities supported on modern iOS Safari & Android Chrome (not in base TS lib.dom). */
interface ExtendedCapabilities extends MediaTrackCapabilities {
  torch?: boolean;
  zoom?: { min: number; max: number; step?: number };
  focusMode?: string[];
}

export interface CameraFeedback {
  tone: "ok" | "warn" | "error" | "waiting" | "busy";
  text: string;
}

export interface CameraScannerProps {
  onCode: (code: string) => void;
  onClose: () => void;
  /** Title shown in the top bar of the viewfinder (e.g. "Dispatch scanner", "Returns in"). */
  title?: string;
  /** Live count of accepted parcels in this session/batch, shown as a pill inside the viewfinder. */
  scannedCount?: number;
  /** Live feedback from the parent station so operators see Added / Duplicate / Error without closing the camera. */
  feedback?: CameraFeedback | null;
}

/**
 * Full-screen mobile-first barcode & QR scanner tuned for iPhone Safari and Android Chrome:
 * - Requests 1080p/720p rear camera with continuous autofocus (critical for sharp 1D courier barcodes like Code 128).
 * - Uses native BarcodeDetector when available, or @zxing/browser with TRY_HARDER + explicit parcel barcode formats on iPhone.
 * - Supports Torch (flashlight), optical/digital Zoom (1× / 1.5× / 2×), and switching rear lenses (wide / macro).
 * - Renders live scan feedback and batch count directly inside the viewfinder so continuous Dispatch scanning never stalls.
 */
export function CameraScanner({ onCode, onClose, title = "Scan parcel", scannedCount, feedback }: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const [state, setState] = useState<"starting" | "scanning" | "denied" | "unsupported">("starting");
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  // The lens the operator picked with "Switch lens"; undefined = let the browser choose the rear camera. Only a switch
  // re-opens the stream (listing the lenses after the first open must not restart the camera).
  const [deviceId, setDeviceId] = useState<string | undefined>(undefined);
  const currentDeviceRef = useRef<string | undefined>(undefined);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [zoomRange, setZoomRange] = useState<{ min: number; max: number } | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [flashTone, setFlashTone] = useState<"ok" | "warn" | "error" | null>(null);
  const lastRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  // Brief reticle flash whenever feedback updates so the operator sees instant confirmation even in peripheral vision.
  useEffect(() => {
    if (!feedback || feedback.tone === "busy" || feedback.tone === "waiting") return;
    setFlashTone(feedback.tone);
    const t = window.setTimeout(() => setFlashTone(null), 550);
    return () => window.clearTimeout(t);
  }, [feedback]);

  // Lock page scroll and close on Escape.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const activeDeviceId = deviceId;

  useEffect(() => {
    let stopped = false;
    let cleanup: (() => void) | null = null;
    setState("starting");
    setTorchOn(false);
    setTorchSupported(false);
    setZoomRange(null);
    setZoomLevel(1);

    const emit = (raw: string) => {
      const code = raw.trim();
      if (!code) return;
      const now = Date.now();
      // Ignore the exact same code held still for 1.8s so one parcel isn't double-scanned, while different parcels scan immediately.
      if (code === lastRef.current.code && now - lastRef.current.at < 1800) return;
      lastRef.current = { code, at: now };
      onCodeRef.current(code);
    };

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setState("unsupported");
        return;
      }

      // Build constraints: HD resolution is essential on iPhone Safari so thin Code 128 bars don't blur together.
      const hdVideo: MediaTrackConstraints = activeDeviceId
        ? { deviceId: { exact: activeDeviceId }, width: { ideal: 1920, min: 1280 }, height: { ideal: 1080, min: 720 } }
        : { facingMode: { ideal: "environment" }, width: { ideal: 1920, min: 1280 }, height: { ideal: 1080, min: 720 } };

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: hdVideo, audio: false });
      } catch (err) {
        const name = (err as { name?: string })?.name;
        if (name === "NotAllowedError" || name === "SecurityError") {
          if (!stopped) setState("denied");
          return;
        }
        // Fallback to standard constraints if a device rejects HD.
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: activeDeviceId ? { deviceId: { exact: activeDeviceId } } : { facingMode: "environment" },
            audio: false,
          });
        } catch (fallbackErr) {
          const fname = (fallbackErr as { name?: string })?.name;
          if (!stopped) setState(fname === "NotAllowedError" || fname === "SecurityError" ? "denied" : "unsupported");
          return;
        }
      }

      if (stopped) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      const track = stream.getVideoTracks()[0] ?? null;
      trackRef.current = track;
      currentDeviceRef.current = track?.getSettings?.().deviceId ?? activeDeviceId;

      // List the rear lenses once permission is granted (labels are empty before that) so the operator can switch lens.
      // This only fills the list — it never restarts the stream.
      if (cameras.length === 0 && navigator.mediaDevices.enumerateDevices) {
        try {
          const all = await navigator.mediaDevices.enumerateDevices();
          const videoInputs = all.filter((d) => d.kind === "videoinput");
          const rear = videoInputs.filter((d) => /back|rear|environment|wide|telephoto|macro/i.test(d.label));
          const list = rear.length > 0 ? rear : videoInputs;
          if (list.length > 1 && !stopped) setCameras(list);
        } catch {
          // Ignore device enumeration errors.
        }
      }

      // Inspect track capabilities: enable continuous autofocus, detect torch & zoom.
      if (track && typeof track.getCapabilities === "function") {
        try {
          const caps = track.getCapabilities() as ExtendedCapabilities;
          if (caps.torch) setTorchSupported(true);
          if (caps.zoom && caps.zoom.max > caps.zoom.min) {
            setZoomRange({ min: caps.zoom.min, max: caps.zoom.max });
            setZoomLevel(Math.max(1, caps.zoom.min));
          }
          if (Array.isArray(caps.focusMode) && caps.focusMode.includes("continuous")) {
            await track.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] }).catch(() => {});
          }
        } catch {
          // Capabilities not supported on this browser — scan continues normally.
        }
      }

      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        // iOS may already be playing inline.
      }

      const Native = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;

      if (Native) {
        const detector = new Native({ formats: NATIVE_FORMATS });
        let timer = 0;
        const tick = async () => {
          if (stopped) return;
          try {
            if (video.readyState >= 2) {
              const found = await detector.detect(video);
              if (found[0]?.rawValue) emit(found[0].rawValue);
            }
          } catch {
            // Frame not decodable — try next.
          }
          timer = window.setTimeout(tick, 110);
        };
        void tick();
        cleanup = () => {
          window.clearTimeout(timer);
          stream.getTracks().forEach((t) => t.stop());
        };
      } else {
        // iPhone Safari & Firefox path: ZXing with explicit parcel formats + TRY_HARDER for crisp 1D Code 128 / QR decoding.
        try {
          const { BarcodeFormat, BrowserMultiFormatReader } = await import("@zxing/browser");
          if (stopped) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          const formats = [
            BarcodeFormat.CODE_128,
            BarcodeFormat.CODE_39,
            BarcodeFormat.EAN_13,
            BarcodeFormat.EAN_8,
            BarcodeFormat.QR_CODE,
            BarcodeFormat.DATA_MATRIX,
            BarcodeFormat.ITF,
            BarcodeFormat.UPC_A,
            BarcodeFormat.UPC_E,
            BarcodeFormat.PDF_417,
          ];
          // DecodeHintType: POSSIBLE_FORMATS = 2, TRY_HARDER = 3
          const hints = new Map<number, unknown>([
            [2, formats],
            [3, true],
          ]);
          const reader = new BrowserMultiFormatReader(hints as never, {
            delayBetweenScanAttempts: 110,
            delayBetweenScanSuccess: 250,
          });
          const controls = await reader.decodeFromStream(stream, video, (result) => {
            if (result) emit(result.getText());
          });
          if (stopped) {
            controls.stop();
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          cleanup = () => {
            controls.stop();
            stream.getTracks().forEach((t) => t.stop());
          };
        } catch {
          stream.getTracks().forEach((t) => t.stop());
          if (!stopped) setState("unsupported");
          return;
        }
      }

      if (!stopped) setState("scanning");
    })();

    return () => {
      stopped = true;
      trackRef.current = null;
      cleanup?.();
    };
    // Re-open stream only when the user explicitly switches camera lens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDeviceId]);

  const toggleTorch = useCallback(async () => {
    const track = trackRef.current;
    if (!track || !torchSupported) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorchOn(next);
    } catch {
      setTorchSupported(false);
    }
  }, [torchOn, torchSupported]);

  const cycleZoom = useCallback(async () => {
    const track = trackRef.current;
    if (!track || !zoomRange) return;
    const steps = [1, 1.5, 2].filter((z) => z >= zoomRange.min && z <= zoomRange.max);
    if (steps.length <= 1) return;
    const curIdx = steps.findIndex((z) => Math.abs(z - zoomLevel) < 0.15);
    const next = steps[(curIdx + 1) % steps.length] ?? steps[0]!;
    try {
      await track.applyConstraints({ advanced: [{ zoom: next } as MediaTrackConstraintSet] });
      setZoomLevel(next);
    } catch {
      setZoomRange(null);
    }
  }, [zoomLevel, zoomRange]);

  const switchCamera = useCallback(() => {
    if (cameras.length <= 1) return;
    const at = cameras.findIndex((d) => d.deviceId === currentDeviceRef.current);
    setDeviceId(cameras[(at + 1) % cameras.length]!.deviceId);
  }, [cameras]);

  const cornerColor =
    flashTone === "ok"
      ? "border-success-500"
      : flashTone === "warn"
        ? "border-warning-500"
        : flashTone === "error"
          ? "border-danger-400"
          : "border-white";

  // Portalled to <body>: a transformed page wrapper would otherwise pin this "fixed" layer inside the page, under the toolbar.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-overlay flex flex-col bg-black text-white sm:items-center sm:justify-center sm:bg-black/80 sm:p-6 sm:backdrop-blur-md"
    >
      <div className="relative flex h-full w-full flex-col overflow-hidden bg-black sm:h-[min(86vh,720px)] sm:max-w-lg sm:rounded-3xl sm:border sm:border-white/15 sm:shadow-2xl">
        {/* Top bar (safe-area aware for iPhone notch / Dynamic Island) */}
        <div className="relative z-20 flex items-center justify-between gap-2 bg-gradient-to-b from-black/80 via-black/45 to-transparent px-4 pb-4 pt-[max(0.85rem,env(safe-area-inset-top))]">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-base font-semibold tracking-tight">{title}</span>
            {typeof scannedCount === "number" && (
              <span className="shrink-0 rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-semibold tabular-nums backdrop-blur-md">
                {scannedCount} scanned
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {torchSupported && (
              <button
                type="button"
                onClick={() => void toggleTorch()}
                aria-label={torchOn ? "Turn flashlight off" : "Turn flashlight on"}
                aria-pressed={torchOn}
                className={cn(
                  "flex h-11 w-11 items-center justify-center rounded-full backdrop-blur-md transition-colors active:scale-95",
                  torchOn ? "bg-warning-500 text-ink-900" : "bg-white/15 text-white hover:bg-white/25",
                )}
              >
                {torchOn ? <Flashlight size={19} /> : <FlashlightOff size={19} />}
              </button>
            )}
            {zoomRange && zoomRange.max >= 1.5 && (
              <button
                type="button"
                onClick={() => void cycleZoom()}
                aria-label={`Zoom ${zoomLevel}x`}
                className="flex h-11 min-w-[44px] items-center justify-center gap-0.5 rounded-full bg-white/15 px-2.5 text-xs font-semibold tabular-nums text-white backdrop-blur-md transition-colors hover:bg-white/25 active:scale-95"
              >
                <ZoomIn size={14} aria-hidden="true" />
                {zoomLevel}×
              </button>
            )}
            {cameras.length > 1 && (
              <button
                type="button"
                onClick={switchCamera}
                aria-label="Switch camera lens"
                className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-md transition-colors hover:bg-white/25 active:scale-95"
              >
                <RefreshCw size={18} />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close scanner"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-md transition-colors hover:bg-white/25 active:scale-95"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Full-bleed camera viewport */}
        <div className="relative flex-1 overflow-hidden">
          {state === "denied" || state === "unsupported" ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10">
                <AlertTriangle size={26} className="text-warning-500" />
              </div>
              <p className="mt-4 text-base font-semibold">
                {state === "denied" ? "Camera permission blocked" : "Camera not available here"}
              </p>
              <p className="mt-1.5 max-w-xs text-sm text-white/75">
                {state === "denied"
                  ? "Allow camera access for this site in Safari / Chrome settings, then reopen the scanner."
                  : "Make sure you opened the site over HTTPS, or type / scan the code into the box instead."}
              </p>
              <Button variant="outline" className="mt-5 border-white/25 bg-white/10 text-white hover:bg-white/20" onClick={onClose}>
                Back to manual input
              </Button>
            </div>
          ) : (
            <>
              {/* Muted + playsInline: mandatory on iPhone Safari so video plays inside the viewfinder, never native fullscreen player. */}
              <video ref={videoRef} className="absolute inset-0 h-full w-full object-cover" muted playsInline autoPlay aria-label="Camera preview" />

              {/* Viewfinder reticle */}
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6">
                <div
                  className={cn(
                    "relative aspect-[16/10] w-full max-w-[340px] rounded-2xl shadow-[0_0_0_9999px_rgba(0,0,0,0.48)] transition-colors duration-150",
                    flashTone === "ok" && "bg-success-500/15",
                    flashTone === "warn" && "bg-warning-500/15",
                    flashTone === "error" && "bg-danger-500/15",
                  )}
                >
                  {/* Four corner brackets */}
                  <span className={cn("absolute -left-0.5 -top-0.5 h-7 w-7 rounded-tl-2xl border-l-[3.5px] border-t-[3.5px] transition-colors", cornerColor)} />
                  <span className={cn("absolute -right-0.5 -top-0.5 h-7 w-7 rounded-tr-2xl border-r-[3.5px] border-t-[3.5px] transition-colors", cornerColor)} />
                  <span className={cn("absolute -bottom-0.5 -left-0.5 h-7 w-7 rounded-bl-2xl border-b-[3.5px] border-l-[3.5px] transition-colors", cornerColor)} />
                  <span className={cn("absolute -bottom-0.5 -right-0.5 h-7 w-7 rounded-br-2xl border-b-[3.5px] border-r-[3.5px] transition-colors", cornerColor)} />
                  {/* Center laser guide line */}
                  <div className="absolute inset-x-4 top-1/2 h-[2px] -translate-y-1/2 rounded-full bg-danger-500 shadow-[0_0_12px_rgb(var(--color-danger-500)/0.85)]" />
                </div>
              </div>

              {state === "starting" && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/55 backdrop-blur-sm">
                  <div className="flex items-center gap-2.5 rounded-full bg-black/75 px-4 py-2 text-sm font-medium">
                    <Loader2 size={16} className="animate-spin" /> Starting camera…
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Bottom HUD: live scan result banner + thumb-friendly Done button */}
        <div className="relative z-20 space-y-3 bg-gradient-to-t from-black/90 via-black/70 to-transparent px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
          {feedback ? (
            <div
              role="status"
              aria-live="assertive"
              className={cn(
                "flex items-center gap-2.5 rounded-2xl px-3.5 py-2.5 text-sm font-medium backdrop-blur-md",
                feedback.tone === "ok" && "bg-success-600/90 text-white",
                feedback.tone === "warn" && "bg-warning-500/95 text-ink-900",
                feedback.tone === "error" && "bg-danger-600/90 text-white",
                (feedback.tone === "waiting" || feedback.tone === "busy") && "bg-white/15 text-white",
              )}
            >
              {feedback.tone === "ok" && <CheckCircle2 size={17} className="shrink-0" aria-hidden="true" />}
              {feedback.tone === "warn" && <AlertTriangle size={17} className="shrink-0" aria-hidden="true" />}
              {feedback.tone === "error" && <XCircle size={17} className="shrink-0" aria-hidden="true" />}
              {feedback.tone === "waiting" && <CloudOff size={17} className="shrink-0" aria-hidden="true" />}
              {feedback.tone === "busy" && <Loader2 size={17} className="shrink-0 animate-spin" aria-hidden="true" />}
              <span className="min-w-0 flex-1 truncate">{feedback.text}</span>
            </div>
          ) : (
            <p className="text-center text-xs text-white/80" aria-live="polite">
              Hold the barcode or QR code inside the frame — about 15–20 cm away.
            </p>
          )}

          <button
            type="button"
            onClick={onClose}
            className="flex h-12 w-full items-center justify-center rounded-2xl bg-white text-base font-semibold text-ink-900 shadow-lg transition active:scale-[0.99]"
          >
            {typeof scannedCount === "number" && scannedCount > 0 ? `Done (${scannedCount} scanned)` : "Done"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
