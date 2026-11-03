"use client";

import type { ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import { LANDING_ICONS, type LandingBackground, type LandingIcon, type LandingSection } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { SegmentedControl } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ImageUploadField } from "@/components/admin/image-upload-field";
import { uploadLandingImage } from "@/lib/api/admin-landing-pages";
import { toDatetimeLocalValue } from "@/lib/datetime-local";

/* The fields of one landing page section, by type. Each control maps to a validated option (packages/shared
   schemas/landing-page.ts) — copy, a photo, a few switches, a background from the theme — never free CSS or HTML. */

type Patch = (next: LandingSection) => void;

const ICON_LABELS: Record<LandingIcon, string> = {
  truck: "Delivery truck",
  banknote: "Cash",
  rotate: "Returns",
  shield: "Shield",
  star: "Star",
  phone: "Phone",
  sparkles: "Sparkle",
  ruler: "Ruler",
  package: "Parcel",
  badge: "Badge",
};

function TextField({ id, label, value, onChange, max, multiline, placeholder, hint }: { id: string; label: string; value: string | undefined; onChange: (v: string) => void; max: number; multiline?: boolean; placeholder?: string; hint?: string }) {
  return (
    <div>
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      {multiline ? (
        <Textarea id={id} rows={3} value={value ?? ""} maxLength={max} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} lang="bn" />
      ) : (
        <Input id={id} value={value ?? ""} maxLength={max} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} lang="bn" />
      )}
      {hint && <p className="mt-1 text-xs text-fg-muted">{hint}</p>}
    </div>
  );
}

function SwitchRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <span className="text-sm text-fg">{label}</span>
      <Switch checked={checked} onChange={onChange} aria-label={label} />
    </div>
  );
}

/** An editable list (features, trust badges, specs, FAQs): add, edit, remove, within the type's limit. */
function ItemList<T>({ items, min = 1, max, onChange, blank, render, addLabel }: { items: T[]; min?: number; max: number; onChange: (items: T[]) => void; blank: T; render: (item: T, set: (item: T) => void, i: number) => ReactNode; addLabel: string }) {
  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <div key={i} className="relative rounded-lg border border-line-subtle bg-canvas p-3 pr-11">
          {render(item, (next) => onChange(items.map((x, j) => (j === i ? next : x))), i)}
          <IconButton
            aria-label="Remove"
            size="md"
            variant="ghost"
            className="absolute right-1.5 top-1.5"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            disabled={items.length <= 1 && min > 0}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </IconButton>
        </div>
      ))}
      {items.length < max && (
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...items, blank])}>
          <Plus className="h-4 w-4" aria-hidden /> {addLabel}
        </Button>
      )}
    </div>
  );
}

function IconSelect({ id, value, onChange }: { id: string; value: LandingIcon | undefined; onChange: (v: LandingIcon | undefined) => void }) {
  return (
    <Select id={id} aria-label="Icon" value={value ?? ""} onChange={(e) => onChange((e.target.value || undefined) as LandingIcon | undefined)} className="h-9 text-sm">
      <option value="">No icon</option>
      {LANDING_ICONS.map((icon) => (
        <option key={icon} value={icon}>
          {ICON_LABELS[icon]}
        </option>
      ))}
    </Select>
  );
}

type Item = { icon?: LandingIcon; title: string; text?: string };
function ItemFields({ id, item, set }: { id: string; item: Item; set: (i: Item) => void }) {
  return (
    <div className="space-y-2">
      <IconSelect id={id} value={item.icon} onChange={(icon) => set({ ...item, icon })} />
      <Input aria-label="Title" placeholder="Title" value={item.title} maxLength={80} onChange={(e) => set({ ...item, title: e.target.value })} lang="bn" />
      <Input aria-label="Text" placeholder="Short line (optional)" value={item.text ?? ""} maxLength={240} onChange={(e) => set({ ...item, text: e.target.value })} lang="bn" />
    </div>
  );
}

export function SectionFields({ section: s, onChange }: { section: LandingSection; onChange: Patch }) {
  const id = (f: string) => `${s.id}-${f}`;
  const fields = (() => {
    switch (s.type) {
      case "hero":
        return (
          <>
            <TextField id={id("eyebrow")} label="Small line above (optional)" value={s.eyebrow} max={60} onChange={(eyebrow) => onChange({ ...s, eyebrow })} />
            <TextField id={id("headline")} label="Headline" value={s.headline} max={120} onChange={(headline) => onChange({ ...s, headline })} />
            <TextField id={id("sub")} label="Supporting text" value={s.subheadline} max={240} multiline onChange={(subheadline) => onChange({ ...s, subheadline })} />
            <TextField id={id("cta")} label="Button text" value={s.ctaText} max={40} placeholder="এখনই অর্ডার করুন" onChange={(ctaText) => onChange({ ...s, ctaText })} />
            <ImageUploadField label="Photo" value={s.imageUrl} onChange={(url) => onChange({ ...s, imageUrl: url || undefined })} upload={uploadLandingImage} hint="Leave empty to use the product's first photo." />
            <div>
              <p className="mb-1.5 text-xs font-medium text-fg">Text alignment on phones</p>
              <SegmentedControl aria-label="Text alignment" value={s.align} onChange={(align) => onChange({ ...s, align })} options={[{ value: "start", label: "Left" }, { value: "center", label: "Centre" }]} />
            </div>
          </>
        );
      case "product":
        return (
          <>
            <SwitchRow label="Star rating" checked={s.showRating} onChange={(showRating) => onChange({ ...s, showRating })} />
            <SwitchRow label="Short description" checked={s.showShortDescription} onChange={(showShortDescription) => onChange({ ...s, showShortDescription })} />
            <SwitchRow label="Delivery, COD and returns strip" checked={s.showPromises} onChange={(showPromises) => onChange({ ...s, showPromises })} />
          </>
        );
      case "colors":
        return (
          <>
            <TextField id={id("title")} label="Title" value={s.title} max={80} onChange={(title) => onChange({ ...s, title })} />
            <TextField id={id("sub")} label="Subtitle" value={s.subtitle} max={200} onChange={(subtitle) => onChange({ ...s, subtitle })} />
          </>
        );
      case "features":
      case "trust": {
        const list = (
          <ItemList
            items={s.items}
            max={s.type === "features" ? 8 : 6}
            blank={{ icon: "badge", title: "" }}
            addLabel="Add item"
            onChange={(items) => onChange({ ...s, items } as LandingSection)}
            render={(item, set, i) => <ItemFields id={id(`icon-${i}`)} item={item} set={set} />}
          />
        );
        return s.type === "features" ? (
          <>
            <TextField id={id("title")} label="Title" value={s.title} max={80} onChange={(title) => onChange({ ...s, title })} />
            {list}
          </>
        ) : (
          list
        );
      }
      case "specs":
        return (
          <>
            <TextField id={id("title")} label="Title" value={s.title} max={80} onChange={(title) => onChange({ ...s, title })} />
            <ItemList
              items={s.rows}
              max={12}
              blank={{ label: "", value: "" }}
              addLabel="Add row"
              onChange={(rows) => onChange({ ...s, rows })}
              render={(row, set) => (
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input aria-label="Label" placeholder="e.g. কাপড়" value={row.label} maxLength={60} onChange={(e) => set({ ...row, label: e.target.value })} lang="bn" />
                  <Input aria-label="Value" placeholder="e.g. ১০০% কটন" value={row.value} maxLength={200} onChange={(e) => set({ ...row, value: e.target.value })} lang="bn" />
                </div>
              )}
            />
          </>
        );
      case "offer":
        return (
          <>
            <TextField id={id("badge")} label="Badge (optional)" value={s.badge} max={40} onChange={(badge) => onChange({ ...s, badge })} />
            <TextField id={id("title")} label="Title" value={s.title} max={120} onChange={(title) => onChange({ ...s, title })} />
            <TextField id={id("text")} label="Text" value={s.text} max={400} multiline onChange={(text) => onChange({ ...s, text })} />
            <div>
              <Label htmlFor={id("ends")} className="text-xs">
                Countdown to (optional)
              </Label>
              <Input
                id={id("ends")}
                type="datetime-local"
                value={toDatetimeLocalValue(s.endsAt)}
                onChange={(e) => onChange({ ...s, endsAt: e.target.value ? new Date(e.target.value).toISOString() : undefined })}
              />
              <p className="mt-1 text-xs text-fg-muted">The section hides itself when the time passes. It never changes the price — set prices on the product or with a flash sale.</p>
            </div>
          </>
        );
      case "description":
      case "delivery":
        return <TextField id={id("title")} label="Title" value={s.title} max={80} onChange={(title) => onChange({ ...s, title })} />;
      case "faq":
        return (
          <>
            <TextField id={id("title")} label="Title" value={s.title} max={80} onChange={(title) => onChange({ ...s, title })} />
            <SwitchRow label="Add the standard answers (delivery, charge, COD, returns)" checked={s.includeStandard} onChange={(includeStandard) => onChange({ ...s, includeStandard })} />
            <ItemList
              items={s.items}
              max={12}
              blank={{ q: "", a: "" }}
              min={0}
              addLabel="Add question"
              onChange={(items) => onChange({ ...s, items })}
              render={(item, set) => (
                <div className="space-y-2">
                  <Input aria-label="Question" placeholder="Question" value={item.q} maxLength={200} onChange={(e) => set({ ...item, q: e.target.value })} lang="bn" />
                  <Textarea aria-label="Answer" placeholder="Answer" rows={2} value={item.a} maxLength={1000} onChange={(e) => set({ ...item, a: e.target.value })} lang="bn" />
                </div>
              )}
            />
          </>
        );
      case "order":
        return (
          <>
            <TextField id={id("title")} label="Title" value={s.title} max={80} onChange={(title) => onChange({ ...s, title })} />
            <TextField id={id("sub")} label="Text under the title" value={s.subtitle} max={240} multiline onChange={(subtitle) => onChange({ ...s, subtitle })} />
            <TextField id={id("cta")} label="Button text" value={s.ctaText} max={40} placeholder="অর্ডার কনফার্ম করুন" onChange={(ctaText) => onChange({ ...s, ctaText })} />
          </>
        );
      case "reviews":
        return <p className="text-sm text-fg-muted">Shows the product&apos;s approved reviews. Hidden while there are none.</p>;
      case "moreProducts":
        return <p className="text-sm text-fg-muted">Shows other products from the same category.</p>;
    }
  })();

  return (
    <div className="space-y-4">
      {fields}
      <div>
        <Label htmlFor={id("bg")} className="text-xs">
          Background
        </Label>
        <Select id={id("bg")} value={s.background} onChange={(e) => onChange({ ...s, background: e.target.value as LandingBackground })} className="h-9 text-sm">
          <option value="canvas">Page</option>
          <option value="surface">Raised</option>
          <option value="muted">Soft tint</option>
        </Select>
      </div>
    </div>
  );
}
