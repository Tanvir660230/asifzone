"use client";

import { useFieldArray, type Control, type UseFormRegister } from "react-hook-form";
import { Plus, Trash2 } from "lucide-react";
import type { CreateProductInput } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface VariantEditorProps {
  control: Control<CreateProductInput>;
  register: UseFormRegister<CreateProductInput>;
}

export function VariantEditor({ control, register }: VariantEditorProps) {
  const { fields, append, remove } = useFieldArray({ control, name: "variants" });

  return (
    <div>
      <div className="mb-2 grid grid-cols-[1fr_1fr_1fr_1fr_1fr_auto] gap-2 text-xs font-medium uppercase tracking-wide text-ink-500">
        <span>SKU</span>
        <span>Size</span>
        <span>Color</span>
        <span>Price override</span>
        <span>Stock</span>
        <span />
      </div>

      <div className="space-y-2">
        {fields.map((field, index) => (
          <div key={field.id} className="grid grid-cols-[1fr_1fr_1fr_1fr_1fr_auto] items-center gap-2">
            <Input placeholder="SKU-001" {...register(`variants.${index}.sku`)} />
            <Input placeholder="M / L / XL" {...register(`variants.${index}.size`)} />
            <Input placeholder="Black" {...register(`variants.${index}.color`)} />
            <Input
              type="number"
              step="0.01"
              placeholder="—"
              {...register(`variants.${index}.price`, { valueAsNumber: true })}
            />
            <Input type="number" {...register(`variants.${index}.stock`, { valueAsNumber: true })} />
            <button
              type="button"
              onClick={() => remove(index)}
              className="text-ink-400 hover:text-danger-600"
              aria-label="Remove variant"
              disabled={fields.length === 1}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-3"
        onClick={() => append({ sku: "", size: "", color: "", stock: 0 })}
      >
        <Plus size={14} /> Add variant
      </Button>
    </div>
  );
}
