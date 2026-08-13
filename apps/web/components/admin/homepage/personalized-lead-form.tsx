"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { personalizedLeadConfigSchema, type PersonalizedLeadConfig } from "@clothing-brand/shared";
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

/** Only shown to a returning visitor with browsing history — its content still needs to be
 * editable copy, just aware it never renders for a first-time visitor. */
export function PersonalizedLeadForm({ initialConfig, onSubmit, onCancel, onValuesChange }: FormProps) {
  const {
    register,
    handleSubmit,
    watch,
    formState: { isSubmitting },
  } = useForm<PersonalizedLeadConfig>({
    resolver: zodResolver(personalizedLeadConfigSchema),
    defaultValues: initialConfig as Partial<PersonalizedLeadConfig>,
  });
  useFormPreviewSync(watch, onValuesChange);

  return (
    <form onSubmit={handleSubmit(async (values) => onSubmit(values))} className="space-y-4">
      <p className="rounded-lg bg-cream-200 px-3 py-2 text-xs text-ink-600">
        Only shown to returning visitors who have browsed a category recently — hidden for first-time visitors.
      </p>
      <div>
        <Label htmlFor="eyebrow">Eyebrow text (optional)</Label>
        <p className="mb-1 text-xs text-ink-400">Falls back to &quot;Welcome back&quot; if left blank.</p>
        <Input id="eyebrow" {...register("eyebrow")} />
      </div>
      <div>
        <Label htmlFor="titleTemplate">Title (optional)</Label>
        <p className="mb-1 text-xs text-ink-400">
          Use <code className="rounded bg-ink-100 px-1 py-0.5">{"{category}"}</code> anywhere — it&rsquo;s replaced with
          the visitor&rsquo;s most-viewed category, e.g. &quot;More Shirts, picked for you&quot;.
        </p>
        <Input id="titleTemplate" placeholder="More {category}, picked for you" {...register("titleTemplate")} />
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
