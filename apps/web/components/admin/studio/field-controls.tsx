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
import { Switch } from "@/components/ui/switch";
import { SegmentedControl } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ImageUploadField } from "@/components/admin/image-upload-field";
import { isHexColor } from "@clothing-brand/shared";
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
          {/* A segmented row while the options fit the inspector's width; more (or longer) ones wrap as a grid of choices. */}
          {field.options.length <= 4 && field.options.reduce((n, o) => n + o.label.length, 0) <= 28 ? (
            <SegmentedControl
              aria-label={field.label}
              size="sm"
              className="w-full"
              options={field.options.map((o) => ({ value: o.value, label: o.label }))}
              value={current}
              // The default isn't stored — the config stays the store's actual choices.
              onChange={(next) => set(next === field.defaultValue ? undefined : next)}
            />
          ) : (
            <div role="group" aria-label={field.label} className="grid grid-cols-2 gap-2">
              {field.options.map((o) => (
                <button
                  key={String(o.value)}
                  type="button"
                  aria-pressed={current === o.value}
                  onClick={() => set(o.value === field.defaultValue ? undefined : o.value)}
                  className={cn(
                    "min-h-10 rounded-lg border px-3 py-2 text-left text-sm transition-colors duration-fast",
                    current === o.value ? "border-accent bg-accent/10 font-medium text-fg" : "border-line text-fg-muted hover:border-line-strong hover:text-fg",
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
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
    case "color":
      return <ColorField field={field} value={typeof value === "string" ? value : ""} id={id} error={error} onValue={(next, typing) => set(next || undefined, typing)} />;
    case "toggle": {
      const on = typeof value === "boolean" ? value : field.defaultValue;
      return (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-line bg-surface px-4 py-3">
          <div>
            <p className="text-sm font-medium text-fg" id={`${id}-label`}>
              {field.label}
            </p>
            {field.hint && <p className="text-xs text-fg-muted">{field.hint}</p>}
          </div>
          {/* The default isn't stored, so the config holds only the store's actual choices. */}
          <Switch aria-label={field.label} checked={on} onChange={(next) => set(next === field.defaultValue ? undefined : next)} />
        </div>
      );
    }
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

/** A brand colour: one tap on a suggested swatch, the system colour picker, or a typed hex value — and "Theme" to go
 * back to the store theme's own colour. The swatches show the store's data, so they're drawn with an inline style. */
function ColorField({
  field,
  value,
  id,
  error,
  onValue,
}: {
  field: Extract<FieldDef, { kind: "color" }>;
  value: string;
  id: string;
  error?: string;
  onValue: (hex: string, typing?: boolean) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const current = value.toLowerCase();
  return (
    <div>
      <p className="ui-label mb-1.5">{field.label}</p>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`${field.label} suggestions`}>
        <button
          type="button"
          onClick={() => onValue("")}
          aria-pressed={!value}
          className={cn(
            "h-8 rounded-full border px-3 text-xs font-medium transition-colors duration-fast",
            !value ? "border-accent bg-accent/10 text-fg" : "border-line text-fg-muted hover:border-line-strong",
          )}
        >
          Theme
        </button>
        {field.swatches.map((hex) => (
          <button
            key={hex}
            type="button"
            onClick={() => onValue(hex)}
            aria-label={hex}
            aria-pressed={current === hex.toLowerCase()}
            title={hex}
            className={cn(
              "h-8 w-8 rounded-full ring-offset-2 ring-offset-surface transition-shadow duration-fast",
              current === hex.toLowerCase() ? "ring-2 ring-accent" : "ring-1 ring-line hover:ring-line-strong",
            )}
            style={{ backgroundColor: hex }}
          />
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <input
          type="color"
          aria-label="Pick any colour"
          value={isHexColor(value) ? value : "#222222"}
          onChange={(e) => onValue(e.target.value, true)}
          className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-line bg-surface p-1"
        />
        <Input
          id={id}
          value={text}
          placeholder="#1F3A5F"
          spellCheck={false}
          autoComplete="off"
          aria-label={`${field.label} hex value`}
          onChange={(e) => {
            const next = e.target.value.trim();
            setText(next);
            if (isHexColor(next)) onValue(next, true);
            else if (next === "") onValue("");
          }}
        />
      </div>
      {field.hint && <p className="ui-field-hint mt-1.5">{field.hint}</p>}
      {error && <p className="ui-field-error mt-1.5">{error}</p>}
    </div>
  );
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
  // A frame from lib/image-specs.ts: the field asks for its exact size and checks the picture against it.
  const spec = typeof field.spec === "function" ? field.spec(config) : field.spec;
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    setSize(null);
    if (!url || spec) return;
    const img = new window.Image();
    img.onload = () => setSize({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = resolveImageUrl(url);
  }, [url, spec]);

  const lowRes = size !== null && size.w < 1200;
  return (
    <div className="space-y-3">
      <ImageUploadField
        label={field.label}
        value={url}
        upload={uploadHomepageSectionImage}
        onChange={(next) => onChange(setAt(config, field.key, next))}
        spec={spec}
        hint={
          spec ? (
            field.hint
          ) : size ? (
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
                  className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left text-sm text-fg"
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
