"use client";

import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Trash2, Upload } from "lucide-react";
import { promoBannerConfigSchema, type PromoBannerConfig } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import * as homepageSectionsApi from "@/lib/api/admin-homepage-sections";
import { ApiError } from "@/lib/api-client";
import { useFormPreviewSync } from "@/hooks/use-form-preview-sync";

interface FormProps {
  initialConfig: Record<string, unknown>;
  onSubmit: (config: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
  onValuesChange?: (values: Record<string, unknown>) => void;
}

// Rejected client-side rather than left to fail slowly server-side, particularly over a weak
// admin-on-mobile connection.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function PromoBannerForm({ initialConfig, onSubmit, onCancel, onValuesChange }: FormProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const uploadMutation = useMutation({ mutationFn: homepageSectionsApi.uploadHomepageSectionImage });

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<PromoBannerConfig>({
    resolver: zodResolver(promoBannerConfigSchema),
    defaultValues: { imageUrl: "", ...(initialConfig as Partial<PromoBannerConfig>) },
  });
  const imageUrl = watch("imageUrl");
  useFormPreviewSync(watch, onValuesChange);

  async function handleImageSelected(file: File | null) {
    if (!file) return;
    setUploadError(null);
    if (file.size > MAX_IMAGE_BYTES) {
      setUploadError("Image is too large — please use a file under 5MB.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    try {
      const { url } = await uploadMutation.mutateAsync(file);
      setValue("imageUrl", url, { shouldValidate: true });
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : "Image upload failed");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <form onSubmit={handleSubmit(async (values) => onSubmit(values))} className="space-y-4">
      {uploadError && <p className="text-sm text-danger-600">{uploadError}</p>}
      <div>
        <Label>Image</Label>
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
        <p className="mt-1 text-xs text-ink-400">
          Recommended size: 1920×1080px (16:9). This section crops to 16:9 on mobile and 3:1 on desktop — keep
          important content centered so it isn&rsquo;t cut off at either width.
        </p>
      </div>
      <div>
        <Label htmlFor="heading">Heading (optional)</Label>
        <Input id="heading" {...register("heading")} />
      </div>
      <div>
        <Label htmlFor="bodyText">Body text (optional)</Label>
        <Textarea id="bodyText" rows={2} {...register("bodyText")} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="linkUrl">Link URL (optional)</Label>
          <Input id="linkUrl" placeholder="/category/men" {...register("linkUrl")} />
        </div>
        <div>
          <Label htmlFor="ctaLabel">Button label (optional)</Label>
          <Input id="ctaLabel" placeholder="Shop now" {...register("ctaLabel")} />
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="brass" disabled={isSubmitting || !imageUrl}>
          {isSubmitting ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
