"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { smartRecommendationsConfigSchema, type SmartRecommendationsConfig } from "@clothing-brand/shared";
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

export function SmartRecommendationsForm({ initialConfig, onSubmit, onCancel, onValuesChange }: FormProps) {
  const {
    register,
    handleSubmit,
    watch,
    formState: { isSubmitting },
  } = useForm<SmartRecommendationsConfig>({
    resolver: zodResolver(smartRecommendationsConfigSchema),
    defaultValues: initialConfig as Partial<SmartRecommendationsConfig>,
  });
  useFormPreviewSync(watch, onValuesChange);

  return (
    <form onSubmit={handleSubmit(async (values) => onSubmit(values))} className="space-y-4">
      <p className="rounded-lg bg-cream-200 px-3 py-2 text-xs text-ink-600">
        Shows recently-viewed products plus trending items in the visitor&rsquo;s price range — only the title below is
        editable, the products themselves are picked automatically.
      </p>
      <div>
        <Label htmlFor="title">Title (optional)</Label>
        <p className="mb-1 text-xs text-ink-400">Falls back to &quot;Trending In Your Budget&quot; if left blank.</p>
        <Input id="title" {...register("title")} />
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
