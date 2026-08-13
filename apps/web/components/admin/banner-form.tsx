"use client";

import { useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Trash2, Upload } from "lucide-react";
import { createBannerSchema, type Banner, type CreateBannerInput } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import * as bannersApi from "@/lib/api/admin-banners";
import { ApiError } from "@/lib/api-client";
import { toDatetimeLocalValue } from "@/lib/datetime-local";

interface BannerFormProps {
  banner?: Banner | null;
  submitLabel: string;
  onSubmit: (values: CreateBannerInput) => Promise<void>;
  onCancel: () => void;
}

function toFormValues(banner?: Banner | null): CreateBannerInput {
  return {
    placement: banner?.placement ?? "HERO_CAROUSEL",
    imageUrl: banner?.imageUrl ?? "",
    mobileImageUrl: banner?.mobileImageUrl ?? undefined,
    linkUrl: banner?.linkUrl ?? undefined,
    title: banner?.title ?? undefined,
    subtitle: banner?.subtitle ?? undefined,
    altText: banner?.altText ?? undefined,
    sortOrder: banner?.sortOrder ?? 0,
    isActive: banner?.isActive ?? true,
    // See section-config-panel.tsx's identical note — kept as datetime-local strings here, coerced
    // to real Dates by the server's zod schema at submit time.
    startsAt: toDatetimeLocalValue(banner?.startsAt) as unknown as Date | undefined,
    endsAt: toDatetimeLocalValue(banner?.endsAt) as unknown as Date | undefined,
  };
}

/** Shared by both the create and edit flows on the Banners page — extracted because edit needs the
 * exact same image-upload/field markup, not a parallel copy. */
export function BannerForm({ banner, submitLabel, onSubmit, onCancel }: BannerFormProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mobileFileInputRef = useRef<HTMLInputElement>(null);
  const uploadMutation = useMutation({ mutationFn: bannersApi.uploadBannerImage });

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateBannerInput>({
    resolver: zodResolver(createBannerSchema),
    defaultValues: toFormValues(banner),
  });
  const imageUrl = watch("imageUrl");
  const mobileImageUrl = watch("mobileImageUrl");

  async function handleImageSelected(file: File | null) {
    if (!file) return;
    try {
      const { url } = await uploadMutation.mutateAsync(file);
      setValue("imageUrl", url, { shouldValidate: true });
    } catch {
      // surfaced via uploadMutation.isError below
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleMobileImageSelected(file: File | null) {
    if (!file) return;
    try {
      const { url } = await uploadMutation.mutateAsync(file);
      setValue("mobileImageUrl", url, { shouldValidate: true });
    } catch {
      // surfaced via uploadMutation.isError below
    } finally {
      if (mobileFileInputRef.current) mobileFileInputRef.current.value = "";
    }
  }

  return (
    <form onSubmit={handleSubmit(async (values) => onSubmit(values))} className="space-y-4">
      {uploadMutation.isError && (
        <p className="text-sm text-danger-600">
          {uploadMutation.error instanceof ApiError ? uploadMutation.error.message : "Image upload failed"}
        </p>
      )}
      <div>
        <Label>Banner image</Label>
        <p className="mb-1 text-xs text-ink-400">
          Recommended size: 1920×640px (3:1). The homepage hero is locked to this ratio so the full image —
          including any text baked into it — always shows edge-to-edge with no cropping, at any screen size.
        </p>
        <input type="hidden" {...register("imageUrl")} />
        {imageUrl ? (
          <div className="relative mt-1 h-32 w-full overflow-hidden rounded-lg border border-ink-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt="" className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={() => setValue("imageUrl", "", { shouldValidate: true })}
              className="absolute right-2 top-2 rounded-full bg-ink-900/70 p-1 text-cream-50"
              aria-label="Remove image"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadMutation.isPending}
            className="mt-1 flex h-32 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-ink-300 text-ink-500 transition-colors hover:border-brass-400 hover:text-brass-500 disabled:opacity-50"
          >
            <Upload size={20} />
            <span className="text-xs">{uploadMutation.isPending ? "Uploading…" : "Click to upload an image"}</span>
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => handleImageSelected(e.target.files?.[0] ?? null)}
        />
        {errors.imageUrl && <p className="mt-1 text-xs text-danger-600">{errors.imageUrl.message}</p>}
      </div>
      <div>
        <Label>Mobile image (optional)</Label>
        <p className="mb-1 text-xs text-ink-400">
          Recommended size: 1254×1254px (square, 1:1) — the hero switches to a square frame below desktop width.
          Without this, phones fall back to a center-crop of the wide image above, which can cut off text baked
          into it. Upload a square crop of the same scene here to avoid that.
        </p>
        <input type="hidden" {...register("mobileImageUrl")} />
        {mobileImageUrl ? (
          <div className="relative mt-1 h-32 w-24 overflow-hidden rounded-lg border border-ink-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={mobileImageUrl} alt="" className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={() => setValue("mobileImageUrl", "", { shouldValidate: true })}
              className="absolute right-1 top-1 rounded-full bg-ink-900/70 p-1 text-cream-50"
              aria-label="Remove mobile image"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => mobileFileInputRef.current?.click()}
            disabled={uploadMutation.isPending}
            className="mt-1 flex h-32 w-24 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-ink-300 text-ink-500 transition-colors hover:border-brass-400 hover:text-brass-500 disabled:opacity-50"
          >
            <Upload size={18} />
            <span className="text-center text-[11px]">{uploadMutation.isPending ? "Uploading…" : "Upload"}</span>
          </button>
        )}
        <input
          ref={mobileFileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => handleMobileImageSelected(e.target.files?.[0] ?? null)}
        />
      </div>
      <div>
        <Label htmlFor="placement">Placement</Label>
        <Select id="placement" {...register("placement")}>
          <option value="HERO_CAROUSEL">Homepage hero</option>
          <option value="PROMO_STRIP">Promo strip</option>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="title">Title (optional)</Label>
          <Input id="title" {...register("title")} />
        </div>
        <div>
          <Label htmlFor="subtitle">Subtitle (optional)</Label>
          <Input id="subtitle" {...register("subtitle")} />
        </div>
      </div>
      <div>
        <Label htmlFor="linkUrl">Link URL (optional)</Label>
        <Input id="linkUrl" placeholder="/category/men" {...register("linkUrl")} />
      </div>
      <div>
        <Label htmlFor="altText">Image alt text (optional)</Label>
        <p className="mb-1 text-xs text-ink-400">
          Describes the image for screen readers and image search — falls back to the title above if left blank.
        </p>
        <Input id="altText" placeholder="Model wearing a navy panjabi against a beige backdrop" {...register("altText")} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="startsAt">Visible from (optional)</Label>
          <Input id="startsAt" type="datetime-local" {...register("startsAt")} />
        </div>
        <div>
          <Label htmlFor="endsAt">Visible until (optional)</Label>
          <Input id="endsAt" type="datetime-local" {...register("endsAt")} />
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="brass" disabled={isSubmitting || !imageUrl}>
          {isSubmitting ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
