/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import dynamic from "next/dynamic";
import { Controller } from "react-hook-form";
import type { ResolvedAttributeField } from "@clothing-brand/shared";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormSection } from "@/components/admin/form-section";
import { uploadEditorImage } from "@/lib/api/uploads";
import { cn } from "@/lib/utils";

// Tiptap is large and admin-only — only fetched once a rich-text attribute actually renders.
const RichTextEditor = dynamic(() => import("@/components/admin/rich-text-editor").then((m) => m.RichTextEditor), { ssr: false });

const WIDE_TYPES = new Set(["TEXTAREA", "RICH_TEXT", "MULTI_SELECT"]);

function AttributeInput({ field, value, onChange }: { field: ResolvedAttributeField; value: unknown; onChange: (v: unknown) => void }) {
  const id = `attr-${field.key}`;
  const text = value === undefined || value === null ? "" : String(value);

  switch (field.dataType) {
    case "TEXTAREA":
      return <Textarea id={id} rows={3} placeholder={field.placeholder ?? undefined} value={text} onChange={(e) => onChange(e.target.value)} />;
    case "RICH_TEXT":
      return <RichTextEditor value={text} onChange={onChange} uploadImage={uploadEditorImage} />;
    case "NUMBER":
    case "MEASUREMENT":
      return (
        <div className="flex items-center gap-2">
          <Input id={id} type="number" step="any" placeholder={field.placeholder ?? undefined} value={text} onChange={(e) => onChange(e.target.value)} />
          {field.unit && <span className="shrink-0 text-sm text-ink-500">{field.unit}</span>}
        </div>
      );
    case "BOOLEAN":
      return (
        <label className="flex items-center gap-2 pt-2 text-sm text-ink-700">
          <Checkbox id={id} checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          Yes
        </label>
      );
    case "SELECT":
      return (
        <Select id={id} value={text} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select {field.label}…</option>
          {field.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </Select>
      );
    case "MULTI_SELECT": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1" role="group" aria-labelledby={`${id}-label`}>
          {field.options.map((opt) => (
            <label key={opt} className="flex items-center gap-2 text-sm text-ink-700">
              <Checkbox
                checked={selected.includes(opt)}
                onChange={(e) => onChange(e.target.checked ? [...selected, opt] : selected.filter((s) => s !== opt))}
              />
              {opt}
            </label>
          ))}
        </div>
      );
    }
    case "DATE":
      return <Input id={id} type="date" value={text.slice(0, 10)} onChange={(e) => onChange(e.target.value)} />;
    case "URL":
      return <Input id={id} type="url" placeholder={field.placeholder ?? "https://"} value={text} onChange={(e) => onChange(e.target.value)} />;
    default:
      return <Input id={id} placeholder={field.placeholder ?? undefined} value={text} onChange={(e) => onChange(e.target.value)} />;
  }
}

interface AttributeFieldsProps {
  fields: ResolvedAttributeField[];
  control: any;
  errors: any;
  title: string;
  description?: string;
}

/** Renders the inputs a product type's template asks for, one per attribute, by data type. */
export function AttributeFields({ fields, control, errors, title, description }: AttributeFieldsProps) {
  if (fields.length === 0) return null;
  return (
    <FormSection title={title} description={description}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {fields.map((field) => {
          const error = errors?.attributes?.[field.key]?.message as string | undefined;
          return (
            <div key={field.key} className={cn(WIDE_TYPES.has(field.dataType) && "sm:col-span-2")}>
              <Label htmlFor={`attr-${field.key}`} id={`attr-${field.key}-label`}>
                {field.label}
                {field.required && <span className="text-danger-600"> *</span>}
              </Label>
              <Controller
                control={control}
                name={`attributes.${field.key}`}
                render={({ field: rhf }) => <AttributeInput field={field} value={rhf.value} onChange={rhf.onChange} />}
              />
              {field.helpText && <p className="mt-1 text-xs text-ink-400">{field.helpText}</p>}
              {error && <p className="mt-1 text-xs text-danger-600">{error}</p>}
            </div>
          );
        })}
      </div>
    </FormSection>
  );
}
