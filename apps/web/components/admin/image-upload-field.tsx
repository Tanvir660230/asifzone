"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { CircleCheck, Ruler, Trash2, TriangleAlert, Upload } from "lucide-react";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import { resolveImageUrl } from "@/lib/image-url";
import { checkFit, imageSpec, ratioLabel, type ImageSpecKey } from "@/lib/image-specs";
import { cn } from "@/lib/utils";

// Rejected client-side rather than left to fail slowly server-side, particularly over a weak admin-on-mobile connection.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** How the chosen image is previewed: a wide cover crop, a small square crop, or shown whole (logos, payment graphics)
 * on a light or dark swatch — matching where it will actually appear, so the admin can judge it before saving. */
type Frame = "wide" | "square" | "logo" | "logo-dark";

const FRAME_CLASS: Record<Frame, string> = {
  wide: "h-32 w-full",
  square: "h-24 w-24",
  logo: "h-20 w-40 border-ink-100 bg-cream-50 p-3",
  "logo-dark": "h-20 w-40 border-ink-800 bg-ink-900 p-3",
};

interface ImageUploadFieldProps {
  label: string;
  /** The stored reference (`/uploads/…`) or an absolute URL; empty when no image is set. */
  value: string | null | undefined;
  /** Receives the uploaded image's stored reference, or "" when the image is removed. */
  onChange: (url: string) => void;
  /** The endpoint to upload through — each kind of image has its own server-side processing (favicons are squared, …). */
  upload: (file: File) => Promise<{ url: string }>;
  /** The storefront frame this image fills (lib/image-specs.ts). The field then asks for that exact size, previews the
   * image in that shape, and says when an uploaded picture is too small or will be cropped. */
  spec?: ImageSpecKey;
  hint?: ReactNode;
  frame?: Frame;
  uploadLabel?: string;
}

/**
 * THE admin image field — upload (through the store's normal upload pipeline), preview, replace, remove. Every
 * single-image setting (logo, favicon, category, banner, homepage section, payment graphic) uses this one component.
 */
export function ImageUploadField({ label, value, onChange, upload, spec: specKey, hint, frame = "wide", uploadLabel = "Click to upload an image" }: ImageUploadFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const mutation = useMutation({ mutationFn: upload });
  const isLogo = frame === "logo" || frame === "logo-dark";
  const spec = specKey ? imageSpec(specKey) : null;

  // The stored picture's real pixel size, read in the browser — the same check for a fresh upload and a saved one.
  useEffect(() => {
    setSize(null);
    if (!value || !specKey) return;
    let live = true;
    const img = new window.Image();
    img.onload = () => live && setSize({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = resolveImageUrl(value);
    return () => {
      live = false;
    };
  }, [value, specKey]);

  const verdict = spec && size ? checkFit(spec, size.w, size.h) : null;
  // With a spec, the preview and the empty drop zone take the frame's own shape: wide frames span the column, square
  // and portrait ones stay a thumbnail's width.
  const specFrame = spec ? { style: { aspectRatio: `${spec.ratio[0]} / ${spec.ratio[1]}` } as CSSProperties, className: spec.ratio[0] / spec.ratio[1] >= 1.3 ? "w-full max-w-md" : "w-32" } : null;

  async function handleSelected(file: File | null) {
    if (!file) return;
    setError(null);
    try {
      if (file.size > MAX_IMAGE_BYTES) throw new Error("Image is too large — please use a file under 5MB.");
      const { url } = await mutation.mutateAsync(file);
      onChange(url);
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "Image upload failed");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Label htmlFor={inputId}>{label}</Label>
        {spec && (
          <span className="inline-flex items-center gap-1 text-xs font-medium tabular-nums text-ink-600" data-testid="image-spec-size">
            <Ruler size={12} aria-hidden="true" />
            {spec.width} × {spec.height} px · {ratioLabel(spec.ratio)}
          </span>
        )}
      </div>
      {value ? (
        <div
          className={cn("relative mt-1 flex items-center justify-center overflow-hidden rounded-lg border border-ink-100", specFrame ? specFrame.className : FRAME_CLASS[frame])}
          style={specFrame?.style}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={resolveImageUrl(value)} alt="" className={cn("h-full w-full", isLogo ? "object-contain" : "object-cover")} />
          <button
            type="button"
            onClick={() => onChange("")}
            className="absolute right-1.5 top-1.5 rounded-full bg-ink-900/70 p-1 text-cream-50"
            aria-label={`Remove ${label.replace(/\s*\(optional\)\s*$/i, "").toLowerCase()}`}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={mutation.isPending}
          className={cn(
            "mt-1 flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-ink-300 text-ink-500 transition-colors hover:border-brass-400 hover:text-brass-500 disabled:opacity-50",
            specFrame ? specFrame.className : frame === "logo-dark" ? FRAME_CLASS.logo : FRAME_CLASS[frame],
          )}
          style={specFrame?.style}
        >
          <Upload size={18} aria-hidden="true" />
          <span className="px-1 text-center text-xs">{mutation.isPending ? "Uploading…" : uploadLabel}</span>
        </button>
      )}
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => handleSelected(e.target.files?.[0] ?? null)}
      />
      {error && <p className="ui-field-error">{error}</p>}
      {verdict && (
        <p
          className={cn("mt-1.5 flex items-start gap-1.5 text-xs", verdict.kind === "ok" ? "text-success-700" : "text-warning-700")}
          data-testid="image-fit"
          data-fit={verdict.kind}
        >
          {verdict.kind === "ok" ? <CircleCheck size={13} className="mt-px shrink-0" aria-hidden="true" /> : <TriangleAlert size={13} className="mt-px shrink-0" aria-hidden="true" />}
          <span>{verdict.kind === "ok" ? `${size!.w} × ${size!.h} px — fits the frame.` : verdict.message}</span>
        </p>
      )}
      {spec && <p className="mt-1 text-xs text-ink-400">Shown on {spec.usedIn}.</p>}
      {hint && <p className="mt-1 text-xs text-ink-400">{hint}</p>}
    </div>
  );
}
