"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createBannerSchema, type Banner, type CreateBannerInput } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import * as bannersApi from "@/lib/api/admin-banners";
import { ImageUploadField } from "@/components/admin/image-upload-field";
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



  return (
    <form onSubmit={handleSubmit(async (values) => onSubmit(values))} className="space-y-4">
      <input type="hidden" {...register("imageUrl")} />
      <input type="hidden" {...register("mobileImageUrl")} />
      <div>
        <ImageUploadField
          label="Computer image"
          upload={bannersApi.uploadBannerImage}
          value={imageUrl}
          onChange={(url) => setValue("imageUrl", url, { shouldValidate: true })}
          spec="bannerDesktop"
          hint="The hero is locked to this shape, so a picture exported at this size — including any text baked into it — shows edge to edge with nothing cut off."
        />
        {errors.imageUrl && <p className="ui-field-error">{errors.imageUrl.message}</p>}
      </div>
      <ImageUploadField
        label="Phone image (optional)"
        upload={bannersApi.uploadBannerImage}
        value={mobileImageUrl}
        onChange={(url) => setValue("mobileImageUrl", url, { shouldValidate: true })}
        spec="bannerPhone"
        uploadLabel="Upload"
        hint="Phones and tablets show a square hero. Without this picture they get the middle of the wide one, which cuts off text baked into it."
      />
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
