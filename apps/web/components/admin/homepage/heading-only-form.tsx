"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { categoryGridConfigSchema, type CategoryGridConfig } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface FormProps {
  initialConfig: Record<string, unknown>;
  onSubmit: (config: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}

/** Reused for any section whose only editable field is a heading override (currently just
 * CATEGORY_GRID) — its config shape (`{ heading? }`) matches `categoryGridConfigSchema`. */
export function HeadingOnlyForm({ initialConfig, onSubmit, onCancel }: FormProps) {
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<CategoryGridConfig>({
    resolver: zodResolver(categoryGridConfigSchema),
    defaultValues: initialConfig as Partial<CategoryGridConfig>,
  });

  return (
    <form onSubmit={handleSubmit(async (values) => onSubmit(values))} className="space-y-4">
      <div>
        <Label htmlFor="heading">Heading (optional)</Label>
        <p className="mb-1 text-xs text-ink-400">Falls back to &quot;Shop by Category&quot; if left blank.</p>
        <Input id="heading" {...register("heading")} />
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
