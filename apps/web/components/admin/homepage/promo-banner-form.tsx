"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { promoBannerConfigSchema, type PromoBannerConfig } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useFormPreviewSync } from "@/hooks/use-form-preview-sync";
import { ImageUploadField } from "@/components/admin/image-upload-field";
import { uploadHomepageSectionImage } from "@/lib/api/admin-homepage-sections";

interface FormProps {
  initialConfig: Record<string, unknown>;
  onSubmit: (config: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
  onValuesChange?: (values: Record<string, unknown>) => void;
}

export function PromoBannerForm({ initialConfig, onSubmit, onCancel, onValuesChange }: FormProps) {

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


  return (
    <form onSubmit={handleSubmit(async (values) => onSubmit(values))} className="space-y-4">
      <input type="hidden" {...register("imageUrl")} />
      <input type="hidden" {...register("mobileImageUrl")} />
      <div>
        <ImageUploadField
          label="Image (optional)"
          upload={uploadHomepageSectionImage}
          value={imageUrl}
          onChange={(url) => setValue("imageUrl", url, { shouldValidate: true })}
          hint="Recommended size: 2400×800px (3:1). This section crops to 16:9 on mobile and 3:1 on desktop — keep important content centered so it isn’t cut off at either width. Leave it empty for a text-only editorial band (it then needs a heading)."
        />
        {errors.imageUrl && <p className="ui-field-error">{errors.imageUrl.message}</p>}
      </div>
      <ImageUploadField
        label="Mobile image (optional)"
        upload={uploadHomepageSectionImage}
        value={watch("mobileImageUrl")}
        onChange={(url) => setValue("mobileImageUrl", url, { shouldValidate: true })}
        hint="A 16:9 crop of the same scene for phones. Without it, the desktop image is cropped."
      />
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
        <Button type="submit" variant="brass" disabled={isSubmitting || (!imageUrl && !watch("heading"))}>
          {isSubmitting ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
