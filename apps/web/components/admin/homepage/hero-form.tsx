"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { heroConfigSchema, type HeroConfig } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFormPreviewSync } from "@/hooks/use-form-preview-sync";

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
    watch,
    formState: { isSubmitting },
  } = useForm<HeroConfig>({
    resolver: zodResolver(heroConfigSchema),
    defaultValues: initialConfig as Partial<HeroConfig>,
  });
  useFormPreviewSync(watch, onValuesChange);

  return (
    <form onSubmit={handleSubmit(async (values) => onSubmit(values))} className="space-y-4">
      <p className="rounded-lg bg-cream-200 px-3 py-2 text-xs text-ink-600">
        Only shown when there are no active hero banners — manage those in Banners.
      </p>
      <div>
        <Label htmlFor="headline">Headline (optional)</Label>
        <p className="mb-1 text-xs text-ink-400">Falls back to the store tagline set in Settings if left blank.</p>
        <Input id="headline" {...register("headline")} />
      </div>
      <div>
        <Label htmlFor="subtext">Small text above the headline (optional)</Label>
        <p className="mb-1 text-xs text-ink-400">e.g. &quot;New Season&quot;</p>
        <Input id="subtext" {...register("subtext")} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="ctaHref">Link URL (optional)</Label>
          <Input id="ctaHref" placeholder="/search" {...register("ctaHref")} />
        </div>
        <div>
          <Label htmlFor="ctaLabel">Button label (optional)</Label>
          <Input id="ctaLabel" placeholder="Shop the collection" {...register("ctaLabel")} />
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
