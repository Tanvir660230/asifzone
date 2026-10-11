"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { categoryGridConfigSchema, type CategoryGridConfig } from "@clothing-brand/shared";
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

/** The category grid's form: a heading override and an optional supporting line (`categoryGridConfigSchema`). */
export function HeadingOnlyForm({ initialConfig, onSubmit, onCancel, onValuesChange }: FormProps) {
  const {
    register,
    handleSubmit,
    watch,
    formState: { isSubmitting },
  } = useForm<CategoryGridConfig>({
    resolver: zodResolver(categoryGridConfigSchema),
    defaultValues: initialConfig as Partial<CategoryGridConfig>,
  });
  useFormPreviewSync(watch, onValuesChange);

  return (
    <form onSubmit={handleSubmit(async (values) => onSubmit(values))} className="space-y-4">
      <div>
        <Label htmlFor="heading">Heading (optional)</Label>
        <p className="mb-1 text-xs text-ink-400">Falls back to &quot;Shop by Category&quot; if left blank.</p>
        <Input id="heading" {...register("heading")} />
      </div>
      <div>
        <Label htmlFor="subtitle">Supporting line (optional)</Label>
        <p className="mb-1 text-xs text-ink-400">A short line under the heading, e.g. what the collections are.</p>
        <Input id="subtitle" {...register("subtitle")} />
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
