"use client";

import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { createAttributeSchema, type Attribute, type CreateAttributeInput } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface AttributeFormProps {
  initial?: Attribute;
  onSubmit: (values: CreateAttributeInput) => Promise<void>;
  onCancel: () => void;
}

export function AttributeForm({ initial, onSubmit, onCancel }: AttributeFormProps) {
  const {
    register,
    control,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateAttributeInput>({
    resolver: zodResolver(createAttributeSchema),
    defaultValues: initial
      ? {
          name: initial.name,
          slug: initial.slug,
          sortOrder: initial.sortOrder,
          values: initial.values.map((v) => ({ id: v.id, value: v.value, colorHex: v.colorHex, sortOrder: v.sortOrder })),
        }
      : { sortOrder: 0, values: [{ value: "", sortOrder: 0 }] },
  });

  const { fields, append, remove } = useFieldArray({ control, name: "values" });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <Label htmlFor="name">Attribute name</Label>
        <Input id="name" placeholder="e.g. Fabric, Pattern, Material" {...register("name")} />
        {errors.name && <p className="mt-1 text-xs text-danger-600">{errors.name.message}</p>}
      </div>

      <div>
        <Label htmlFor="slug">Slug (auto-generated if left blank)</Label>
        <Input id="slug" placeholder="e.g. fabric" {...register("slug")} />
      </div>

      <div>
        <Label>Values</Label>
        <p className="mb-2 text-xs text-ink-400">
          The color swatch field only matters for a "Color" attribute — leave it blank for others.
        </p>
        <div className="space-y-2">
          {fields.map((field, index) => {
            const hex = watch(`values.${index}.colorHex`);
            const validHex = hex && /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : undefined;
            return (
              <div key={field.id} className="grid grid-cols-[1fr_7rem_auto] items-center gap-2">
                <Input placeholder="e.g. Cotton" {...register(`values.${index}.value`)} />
                <div className="flex items-center gap-1.5">
                  <span
                    className={cn("h-6 w-6 shrink-0 rounded-full border border-ink-200", !validHex && "bg-cream-100")}
                    style={validHex ? { backgroundColor: validHex } : undefined}
                  />
                  <Input placeholder="#000000" className="px-2 text-xs" {...register(`values.${index}.colorHex`)} />
                </div>
                <button
                  type="button"
                  onClick={() => remove(index)}
                  className="text-ink-400 hover:text-danger-600"
                  aria-label="Remove value"
                  disabled={fields.length === 1}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            );
          })}
        </div>
        {errors.values && <p className="mt-1 text-xs text-danger-600">Every value needs text.</p>}

        <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => append({ value: "", sortOrder: fields.length })}>
          <Plus size={14} /> Add value
        </Button>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="brass" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : "Save attribute"}
        </Button>
      </div>
    </form>
  );
}
