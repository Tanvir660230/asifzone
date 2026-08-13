"use client";

import { Controller, useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { valuesGridConfigSchema, type ValuesGridConfig } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { IconPicker } from "@/components/ui/icon-picker";
import { useFormPreviewSync } from "@/hooks/use-form-preview-sync";

interface FormProps {
  initialConfig: Record<string, unknown>;
  onSubmit: (config: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
  onValuesChange?: (values: Record<string, unknown>) => void;
}

export function ValuesGridForm({ initialConfig, onSubmit, onCancel, onValuesChange }: FormProps) {
  const {
    register,
    control,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ValuesGridConfig>({
    resolver: zodResolver(valuesGridConfigSchema),
    defaultValues: (initialConfig as ValuesGridConfig)?.items?.length
      ? (initialConfig as ValuesGridConfig)
      : { items: [{ icon: "Star", title: "", description: "" }] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: "items" });
  useFormPreviewSync(watch, onValuesChange);

  return (
    <form onSubmit={handleSubmit(async (values) => onSubmit(values))} className="space-y-4">
      <div className="space-y-3">
        {fields.map((field, index) => (
          <div key={field.id} className="space-y-2 rounded-lg border border-ink-100 p-3">
            <div className="flex items-end gap-2">
              <div className="w-40">
                <Label htmlFor={`items.${index}.icon`}>Icon</Label>
                <Controller
                  name={`items.${index}.icon` as const}
                  control={control}
                  render={({ field }) => <IconPicker id={`items.${index}.icon`} value={field.value} onChange={field.onChange} />}
                />
              </div>
              <div className="flex-1">
                <Label htmlFor={`items.${index}.title`}>Title</Label>
                <Input id={`items.${index}.title`} {...register(`items.${index}.title` as const)} />
              </div>
              <button
                type="button"
                onClick={() => remove(index)}
                disabled={fields.length <= 1}
                className="mb-2 rounded p-1.5 text-ink-400 hover:bg-danger-50 hover:text-danger-600 disabled:opacity-40"
                aria-label="Remove item"
              >
                <Trash2 size={16} />
              </button>
            </div>
            <div>
              <Label htmlFor={`items.${index}.description`}>Description</Label>
              <Textarea id={`items.${index}.description`} rows={2} {...register(`items.${index}.description` as const)} />
            </div>
          </div>
        ))}
      </div>
      {errors.items?.message && <p className="text-xs text-danger-600">{errors.items.message}</p>}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => append({ icon: "Star", title: "", description: "" })}
        disabled={fields.length >= 8}
      >
        <Plus size={14} /> Add item
      </Button>
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
