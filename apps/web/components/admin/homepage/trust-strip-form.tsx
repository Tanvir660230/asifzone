"use client";

import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { trustStripConfigSchema, type TrustStripConfig } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { HOMEPAGE_ICON_NAMES } from "@/lib/homepage-icons";

interface FormProps {
  initialConfig: Record<string, unknown>;
  onSubmit: (config: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}

export function TrustStripForm({ initialConfig, onSubmit, onCancel }: FormProps) {
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<TrustStripConfig>({
    resolver: zodResolver(trustStripConfigSchema),
    defaultValues: (initialConfig as TrustStripConfig)?.items?.length
      ? (initialConfig as TrustStripConfig)
      : { items: [{ icon: "Star", label: "" }] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: "items" });

  return (
    <form onSubmit={handleSubmit(async (values) => onSubmit(values))} className="space-y-4">
      <div className="space-y-3">
        {fields.map((field, index) => (
          <div key={field.id} className="flex items-end gap-2 rounded-lg border border-ink-100 p-3">
            <div className="w-32">
              <Label htmlFor={`items.${index}.icon`}>Icon</Label>
              <Select id={`items.${index}.icon`} {...register(`items.${index}.icon` as const)}>
                {HOMEPAGE_ICON_NAMES.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex-1">
              <Label htmlFor={`items.${index}.label`}>Label</Label>
              <Input id={`items.${index}.label`} {...register(`items.${index}.label` as const)} />
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
        ))}
      </div>
      {errors.items?.message && <p className="text-xs text-danger-600">{errors.items.message}</p>}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => append({ icon: "Star", label: "" })}
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
