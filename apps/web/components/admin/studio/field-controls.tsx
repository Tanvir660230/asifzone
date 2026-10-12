"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { IconPicker } from "@/components/ui/icon-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ImageUploadField } from "@/components/admin/image-upload-field";
import { uploadHomepageSectionImage } from "@/lib/api/admin-homepage-sections";
import { resolveImageUrl } from "@/lib/image-url";
import { cn } from "@/lib/utils";
import type { StoreLayout } from "@/lib/theme-layout";
import { getAt, setAt, visibleFields, type FieldDef } from "./section-fields";

export interface FieldContext {
  /** id prefix, unique per section, so labels link to their controls. */
  idPrefix: string;
  layout: StoreLayout;
  /** Category slug → name, for the category picker and link suggestions. */
  categories: { slug: string; name: string }[];
  /** Validation errors by config path ("items.0.label"). */
  errors: Record<string, string>;
}

interface FieldListProps {
  fields: FieldDef[];
  config: Record<string, unknown>;
  /** `coalesce` = this change continues typing in one field (one undo step). */
  onChange: (config: Record<string, unknown>, coalesceKey?: string) => void;
  context: FieldContext;
  /** Prefix of these fields' paths in the section config (nested item lists). */
  pathPrefix?: string;
}

/** Renders a list of field definitions against a config object. */
export function FieldList({ fields, config, onChange, context, pathPrefix = "" }: FieldListProps) {
  return (
    <div className="space-y-5">
      {visibleFields(fields, config, context.layout).map((field) => (
        <FieldControl
          key={`${field.key}-${field.presets?.join() ?? ""}`}
          field={field}
          config={config}
          onChange={onChange}
          context={context}
          path={`${pathPrefix}${field.key}`}
        />
      ))}
    </div>
  );
}

function FieldControl({
  field,
  config,
  onChange,
  context,
  path,
}: {
  field: FieldDef;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>, coalesceKey?: string) => void;
  context: FieldContext;
  path: string;
}) {
  const id = `${context.idPrefix}-${path.replace(/\./g, "-")}`;
  const value = getAt(config, field.key);
  const error = context.errors[path];
  const set = (next: unknown, coalesce = false) => onChange(setAt(config, field.key, next), coalesce ? path : undefined);

  switch (field.kind) {
    case "text":
    case "textarea": {
      const text = typeof value === "string" ? value : "";
      const near = text.length >= field.max * 0.8;
      const hint = (
        <span className="flex justify-between gap-3">
          <span>{field.hint}</span>
          {near && <span className={cn("shrink-0 tabular-nums", text.length > field.max && "text-danger-600")}>{text.length}/{field.max}</span>}
        </span>
      );
      return (
        <Field htmlFor={id} label={field.label} hint={field.hint || near ? hint : undefined} error={error}>
          {field.kind === "text" ? (
            <Input id={id} value={text} placeholder={field.placeholder} onChange={(e) => set(e.target.value, true)} />
          ) : (
            <Textarea id={id} value={text} rows={field.rows ?? 3} placeholder={field.placeholder} onChange={(e) => set(e.target.value, true)} />
          )}
        </Field>
      );
    }
    case "link": {
      const listId = `${id}-suggestions`;
      return (
        <Field htmlFor={id} label={field.label} hint={field.hint ?? "A page of your store (/search, /category/…) or a full web address."} error={error}>
          <Input id={id} list={listId} spellCheck={false} autoComplete="off" value={typeof value === "string" ? value : ""} placeholder="/search" onChange={(e) => set(e.target.value, true)} />
          <datalist id={listId}>
            <option value="/search">All products</option>
            <option value="/search?sort=newest">Newest products</option>
            {context.categories.map((c) => (
              <option key={c.slug} value={`/category/${c.slug}`}>
                {c.name}
              </option>
            ))}
            <option value="/track-order">Track order</option>
            <option value="/contact">Contact</option>
          </datalist>
        </Field>
      );
    }
    case "choice": {
      const current = (value ?? field.defaultValue) as string | number;
      return (
        <div>
          <p className="ui-label mb-1.5" id={`${id}-label`}>
            {field.label}
          </p>
          <SegmentedControl
            aria-label={field.label}
            size="sm"
            className="w-full"
            options={field.options.map((o) => ({ value: o.value, label: o.label }))}
            value={current}
            // The default isn't stored — the config stays the store's actual choices.
            onChange={(next) => set(next === field.defaultValue ? undefined : next)}
          />
          {field.hint && <p className="ui-field-hint mt-1.5">{field.hint}</p>}
          {error && <p className="ui-field-error mt-1.5">{error}</p>}
        </div>
      );
    }
    case "number":
      return <NumberField field={field} value={typeof value === "number" ? value : field.defaultValue} id={id} error={error} onValue={(n) => set(n, true)} />;
    case "category":
      return (
        <Field htmlFor={id} label={field.label} error={error}>
          <Select id={id} value={typeof value === "string" ? value : ""} onChange={(e) => set(e.target.value)}>
            <option value="">Choose a category…</option>
            {context.categories.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      );
    case "icon":
      return (
        <div>
          <Label htmlFor={id}>{field.label}</Label>
          <IconPicker id={id} value={typeof value === "string" ? value : ""} onChange={(name) => set(name)} />
        </div>
      );
    case "image":
      return <ImageField field={field} config={config} onChange={onChange} id={id} error={error} altError={field.altKey ? context.errors[path.replace(/[^.]+$/, field.altKey)] : undefined} />;
    case "items":
      return (
        <ItemsField
          field={field}
          items={Array.isArray(value) ? (value as Record<string, unknown>[]) : []}
          onItems={(items, coalesceKey) => onChange(setAt(config, field.key, items), coalesceKey)}
          context={context}
          path={path}
          error={error}
        />
      );
  }
}

/** A whole number typed freely (so "10" can be typed through "1") — applied as soon as it's in range, and pulled back
 * into range when the field is left. */
function NumberField({
  field,
  value,
  id,
  error,
  onValue,
}: {
  field: Extract<FieldDef, { kind: "number" }>;
  value: number;
  id: string;
  error?: string;
  onValue: (n: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const clamp = (n: number) => Math.min(field.max, Math.max(field.min, n));
  return (
    <Field htmlFor={id} label={field.label} hint={`${field.min}–${field.max}`} error={error}>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={field.min}
        max={field.max}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const parsed = Number.parseInt(e.target.value, 10);
          if (!Number.isNaN(parsed) && parsed === clamp(parsed)) onValue(parsed);
        }}
        onBlur={() => {
          const parsed = Number.parseInt(text, 10);
          const next = Number.isNaN(parsed) ? value : clamp(parsed);
          setText(String(next));
          if (next !== value) onValue(next);
        }}
      />
    </Field>
  );
}

/** The shared image field, plus what makes a photo work on the page: its pixel size (a warning under 1200px wide) and a
 * description for screen readers and search. */
function ImageField({
  field,
  config,
  onChange,
  id,
  error,
  altError,
}: {
  field: Extract<FieldDef, { kind: "image" }>;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>, coalesceKey?: string) => void;
  id: string;
  error?: string;
  altError?: string;
}) {
  const url = typeof config[field.key] === "string" ? (config[field.key] as string) : "";
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    setSize(null);
    if (!url) return;
    const img = new window.Image();
    img.onload = () => setSize({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = resolveImageUrl(url);
  }, [url]);

  const lowRes = size !== null && size.w < 1200;
  return (
    <div className="space-y-3">
      <ImageUploadField
        label={field.label}
        value={url}
        upload={uploadHomepageSectionImage}
        onChange={(next) => onChange(setAt(config, field.key, next))}
        hint={
          size ? (
            <span className={cn(lowRes && "text-warning-700")}>
              {size.w}×{size.h}px{lowRes ? " — small for a large screen; it may look soft. Use 1600px or wider." : ""}
            </span>
          ) : (
            field.aspectHint
          )
        }
      />
      {error && <p className="ui-field-error">{error}</p>}
      {url && field.altKey && (
        <Field htmlFor={`${id}-alt`} label="Describe the photo" hint="For screen readers and Google Images, e.g. “Model in a navy linen panjabi”." error={altError}>
          <Input
            id={`${id}-alt`}
            value={typeof config[field.altKey] === "string" ? (config[field.altKey] as string) : ""}
            onChange={(e) => onChange(setAt(config, field.altKey!, e.target.value), `${id}-alt`)}
          />
        </Field>
      )}
    </div>
  );
}

function ItemsField({
  field,
  items,
  onItems,
  context,
  path,
  error,
}: {
  field: Extract<FieldDef, { kind: "items" }>;
  items: Record<string, unknown>[];
  onItems: (items: Record<string, unknown>[], coalesceKey?: string) => void;
  context: FieldContext;
  path: string;
  error?: string;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const move = (from: number, to: number) => {
    const next = [...items];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    onItems(next);
    setOpen(to);
  };

  return (
    <div>
      <p className="ui-label mb-1.5">
        {field.label} <span className="font-normal text-fg-subtle">· {items.length} of {field.max}</span>
      </p>
      <ol className="space-y-2">
        {items.map((item, i) => {
          const itemErrors = Object.keys(context.errors).some((k) => k.startsWith(`${path}.${i}.`));
          const expanded = open === i;
          return (
            <li key={i} className={cn("rounded-lg border bg-surface", itemErrors ? "border-danger-300" : "border-line")}>
              <div className="flex items-center gap-1 pl-3 pr-1">
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setOpen(expanded ? null : i)}
                  className="flex min-h-11 flex-1 items-center gap-2 text-left text-sm text-fg"
                >
                  <ChevronDown size={15} aria-hidden="true" className={cn("shrink-0 text-fg-subtle transition-transform duration-fast", expanded && "rotate-180")} />
                  <span className="truncate">{field.summary(item)}</span>
                </button>
                <IconButton size="md" aria-label={`Move ${field.itemLabel} up`} disabled={i === 0} onClick={() => move(i, i - 1)}>
                  <ArrowUp size={15} />
                </IconButton>
                <IconButton size="md" aria-label={`Move ${field.itemLabel} down`} disabled={i === items.length - 1} onClick={() => move(i, i + 1)}>
                  <ArrowDown size={15} />
                </IconButton>
                <IconButton
                  size="md"
                  aria-label={`Remove ${field.itemLabel}`}
                  disabled={items.length <= field.min}
                  onClick={() => {
                    onItems(items.filter((_, j) => j !== i));
                    setOpen(null);
                  }}
                >
                  <Trash2 size={15} />
                </IconButton>
              </div>
              {expanded && (
                <div className="border-t border-line-subtle p-3">
                  <FieldList
                    fields={field.fields}
                    config={item}
                    onChange={(next, coalesceKey) => onItems(items.map((it, j) => (j === i ? next : it)), coalesceKey)}
                    context={context}
                    pathPrefix={`${path}.${i}.`}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {items.length < field.max && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={() => {
            onItems([...items, field.newItem()]);
            setOpen(items.length);
          }}
        >
          <Plus size={15} aria-hidden="true" /> Add {field.itemLabel}
        </Button>
      )}
      {error && <p className="ui-field-error mt-1.5">{error}</p>}
    </div>
  );
}
