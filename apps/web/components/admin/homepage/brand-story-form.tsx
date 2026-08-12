"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { brandStoryConfigSchema, type BrandStoryConfig } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface FormProps {
  initialConfig: Record<string, unknown>;
  onSubmit: (config: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}

export function BrandStoryForm({ initialConfig, onSubmit, onCancel }: FormProps) {
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<BrandStoryConfig>({
    resolver: zodResolver(brandStoryConfigSchema),
    defaultValues: initialConfig as Partial<BrandStoryConfig>,
  });

  return (
    <form onSubmit={handleSubmit(async (values) => onSubmit(values))} className="space-y-4">
      <div>
        <Label htmlFor="heading">Heading (optional)</Label>
        <p className="mb-1 text-xs text-ink-400">Falls back to the store tagline set in Settings if left blank.</p>
        <Input id="heading" {...register("heading")} />
      </div>
      <div>
        <Label htmlFor="bodyText">Body text (optional)</Label>
        <Textarea id="bodyText" rows={3} {...register("bodyText")} />
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
