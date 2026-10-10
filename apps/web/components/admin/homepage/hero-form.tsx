"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { heroConfigSchema, type HeroConfig } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFormPreviewSync } from "@/hooks/use-form-preview-sync";
import { ImageUploadField } from "@/components/admin/image-upload-field";
import { uploadHomepageSectionImage } from "@/lib/api/admin-homepage-sections";

interface FormProps {
  initialConfig: Record<string, unknown>;
  onSubmit: (config: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
  onValuesChange?: (values: Record<string, unknown>) => void;
}

export function HeroForm({ initialConfig, onSubmit, onCancel, onValuesChange }: FormProps) {
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { isSubmitting },
  } = useForm<HeroConfig>({
    resolver: zodResolver(heroConfigSchema),
    defaultValues: initialConfig as Partial<HeroConfig>,
  });
  const imageUrl = watch("imageUrl");
  useFormPreviewSync(watch, onValuesChange);

  return (
    <form onSubmit={handleSubmit(async (values) => onSubmit(values))} className="space-y-4">
      <p className="rounded-lg bg-cream-200 px-3 py-2 text-xs text-ink-600">
        Only shown when there are no active hero banners — manage those in Banners.
      </p>
      <div>
        <Label htmlFor="headline">Headline (optional)</Label>
        <p className="mb-1 text-xs text-ink-400">Falls back to the store tagline set in Settings, then the store name, if left blank.</p>
        <Input id="headline" {...register("headline")} />
      </div>
      <div>
        <Label htmlFor="subtext">Small text above the headline (optional)</Label>
        <p className="mb-1 text-xs text-ink-400">A short line such as a collection or campaign name. Hidden when blank.</p>
        <Input id="subtext" {...register("subtext")} />
      </div>
      <div>
        <Label htmlFor="bodyText">Supporting line (optional)</Label>
        <Input id="bodyText" {...register("bodyText")} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="ctaHref">Link URL (optional)</Label>
          <Input id="ctaHref" placeholder="/search" {...register("ctaHref")} />
        </div>
        <div>
          <Label htmlFor="ctaLabel">Button label (optional)</Label>
          <Input id="ctaLabel" placeholder="Explore the collection" {...register("ctaLabel")} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="secondaryCtaHref">Second link URL (optional)</Label>
          <Input id="secondaryCtaHref" placeholder="/category/gifts" {...register("secondaryCtaHref")} />
        </div>
        <div>
          <Label htmlFor="secondaryCtaLabel">Second link label (optional)</Label>
          <Input id="secondaryCtaLabel" {...register("secondaryCtaLabel")} />
        </div>
      </div>
      <input type="hidden" {...register("imageUrl")} />
      <ImageUploadField
        upload={uploadHomepageSectionImage}
        label="Image (optional)"
        value={imageUrl}
        onChange={(url) => setValue("imageUrl", url, { shouldValidate: true })}
        hint="4:5 on mobile and 16:9 on tablets; on desktop either full width beneath the copy (21:9) or a tall image beside it (4:5), as the store's theme sets it — keep the subject centred. 2400px wide or more."
      />
      <div>
        <Label htmlFor="imageAltText">Image description (optional)</Label>
        <p className="mb-1 text-xs text-ink-400">What the image shows, for screen readers and search engines.</p>
        <Input id="imageAltText" {...register("imageAltText")} />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="brass" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
