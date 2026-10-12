"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, ImagePlus, X } from "lucide-react";
import { REVIEW_IMAGE_LIMIT } from "@clothing-brand/shared";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/toast";
import { uploadReviewImage } from "@/lib/api/reviews";
import { ApiError } from "@/lib/api-client";
import { resolveImageUrl } from "@/lib/image-url";

const MAX_BYTES = 8 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp";

/** Photos for a review: up to REVIEW_IMAGE_LIMIT, each uploaded as soon as it's picked (so submitting the review is
 * instant), with a placeholder tile while it uploads and a remove button on each. */
export function ReviewPhotoPicker({ value, onChange, onBusyChange }: { value: string[]; onChange: (next: string[]) => void; onBusyChange?: (busy: boolean) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const room = REVIEW_IMAGE_LIMIT - value.length - uploading;

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    const picked = Array.from(files).slice(0, Math.max(0, room));
    if (files.length > picked.length) toast.error(`Up to ${REVIEW_IMAGE_LIMIT} photos per review`);
    const valid = picked.filter((file) => {
      if (!ACCEPT.split(",").includes(file.type)) {
        toast.error(`${file.name}: use a JPEG, PNG or WebP photo`);
        return false;
      }
      if (file.size > MAX_BYTES) {
        toast.error(`${file.name} is over 8 MB`);
        return false;
      }
      return true;
    });
    if (valid.length === 0) return;

    setUploading((n) => n + valid.length);
    onBusyChange?.(true);
    let next = value;
    for (const file of valid) {
      try {
        const { url } = await uploadReviewImage(file);
        next = [...next, url];
        onChange(next);
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : `Couldn't upload ${file.name}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    onBusyChange?.(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {value.map((url, i) => (
          <div key={url} className="relative h-20 w-20 overflow-hidden rounded-xl bg-surface-muted">
            <Image src={resolveImageUrl(url)} alt={`Your photo ${i + 1}`} fill sizes="80px" className="object-cover" />
            <button
              type="button"
              onClick={() => onChange(value.filter((u) => u !== url))}
              aria-label={`Remove photo ${i + 1}`}
              className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-ink-950/70 text-cream-50 transition-colors hover:bg-ink-950"
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        ))}
        {Array.from({ length: uploading }, (_, i) => (
          <div key={`uploading-${i}`} className="ui-skeleton h-20 w-20 rounded-xl" role="status" aria-label="Uploading photo" />
        ))}
        {room > 0 && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line-strong text-xs text-ink-600 transition-colors hover:border-ink-900 hover:text-ink-900"
          >
            <ImagePlus size={18} aria-hidden="true" />
            Add photo
          </button>
        )}
      </div>
      <input ref={inputRef} type="file" accept={ACCEPT} multiple hidden onChange={(e) => handleFiles(e.target.files)} data-testid="review-photo-input" />
      <p className="mt-2 text-xs text-ink-500">Up to {REVIEW_IMAGE_LIMIT} photos. They appear with your review once it&rsquo;s approved.</p>
    </div>
  );
}

/** A review's photos as a row of thumbnails; tapping one opens it large, with previous/next. */
export function ReviewPhotoStrip({ images, author }: { images: string[]; author: string }) {
  const [open, setOpen] = useState<number | null>(null);
  if (images.length === 0) return null;
  const current = open === null ? null : images[open];

  return (
    <>
      <ul className="mt-3 flex flex-wrap gap-2" aria-label={`Photos from ${author}`}>
        {images.map((url, i) => (
          <li key={url}>
            <button
              type="button"
              onClick={() => setOpen(i)}
              className="relative block h-20 w-20 overflow-hidden rounded-xl bg-surface-muted transition-transform duration-200 ease-smooth hover:scale-[1.03] active:scale-[0.98]"
              aria-label={`Open photo ${i + 1} of ${images.length}`}
            >
              <Image src={resolveImageUrl(url)} alt="" fill sizes="80px" className="object-cover" />
            </button>
          </li>
        ))}
      </ul>
      <Modal open={current != null} onClose={() => setOpen(null)} title={`Photo ${(open ?? 0) + 1} of ${images.length} from ${author}`} widthClassName="max-w-3xl">
        {current && (
          <div className="relative">
            <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-surface-muted sm:aspect-[4/3]">
              <Image src={resolveImageUrl(current)} alt={`Customer photo ${(open ?? 0) + 1}`} fill sizes="(min-width: 768px) 720px, 100vw" className="object-contain" />
            </div>
            {images.length > 1 && (
              <div className="mt-3 flex justify-between">
                <button
                  type="button"
                  onClick={() => setOpen((i) => ((i ?? 0) - 1 + images.length) % images.length)}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-line-strong text-ink-900 hover:bg-surface-muted"
                  aria-label="Previous photo"
                >
                  <ChevronLeft size={18} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => setOpen((i) => ((i ?? 0) + 1) % images.length)}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-line-strong text-ink-900 hover:bg-surface-muted"
                  aria-label="Next photo"
                >
                  <ChevronRight size={18} aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
