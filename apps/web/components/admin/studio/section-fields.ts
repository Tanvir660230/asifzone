import type { HomepageSectionType } from "@clothing-brand/shared";
import { heroPhotoSpecKey, type ImageSpecKey } from "@/lib/image-specs";
import type { StoreLayout } from "@/lib/theme-layout";

/**
 * What the Storefront Studio's inspector shows for each section type — one declarative list instead of a hand-built form
 * per type. Keys are paths into the section's config (`appearance.tone`); the shared zod schema stays the validator.
 */

export interface ChoiceOption<T extends string | number = string | number> {
  value: T;
  label: string;
}

interface FieldBase {
  key: string;
  label: string;
  hint?: string;
  placeholder?: string;
  /** Only for these structural presets (a style option one preset doesn't draw). */
  presets?: StoreLayout[];
  /** Shown only when this returns true for the section's current config. */
  showIf?: (config: Record<string, unknown>) => boolean;
}

export type FieldDef =
  | (FieldBase & { kind: "text"; max: number })
  | (FieldBase & { kind: "textarea"; max: number; rows?: number })
  | (FieldBase & { kind: "link" })
  | (FieldBase & {
      kind: "image";
      altKey?: string;
      /** Free-text shape advice, for a frame without an entry in lib/image-specs.ts. */
      aspectHint?: string;
      /** The storefront frame it fills (exact pixel size + fit check), or a function of the config when the section's
       * style changes the frame. Takes precedence over aspectHint. */
      spec?: ImageSpecKey | ((config: Record<string, unknown>) => ImageSpecKey | undefined);
    })
  | (FieldBase & { kind: "choice"; options: ChoiceOption[]; defaultValue: string | number })
  | (FieldBase & { kind: "number"; min: number; max: number; defaultValue: number })
  | (FieldBase & { kind: "category" })
  | (FieldBase & { kind: "icon" })
  /** A brand colour: suggested swatches, the system picker and a hex field; empty = the theme's. */
  | (FieldBase & { kind: "color"; swatches: string[] })
  | (FieldBase & { kind: "toggle"; defaultValue: boolean })
  | (FieldBase & {
      kind: "items";
      itemLabel: string;
      min: number;
      max: number;
      fields: FieldDef[];
      newItem: () => Record<string, unknown>;
      /** The line shown for a collapsed item. */
      summary: (item: Record<string, unknown>) => string;
    });

export interface SectionFields {
  content: FieldDef[];
  style: FieldDef[];
}

const has = (key: string) => (config: Record<string, unknown>) => Boolean(config[key]);
const lacks = (key: string) => (config: Record<string, unknown>) => !config[key];

const TONE: FieldDef = {
  key: "appearance.tone",
  label: "Tone",
  kind: "choice",
  defaultValue: "theme",
  options: [
    { value: "theme", label: "Theme" },
    { value: "dark", label: "Dark" },
    { value: "light", label: "Light" },
  ],
  hint: "Theme follows your store's design. Dark and light keep text readable automatically.",
  presets: ["classic"],
};

const BACKGROUND: FieldDef = {
  key: "appearance.background",
  label: "Background",
  kind: "choice",
  defaultValue: "default",
  options: [
    { value: "default", label: "Page" },
    { value: "muted", label: "Tinted" },
  ],
  hint: "A tinted band sets the section apart from its neighbours.",
};

const BUTTON = (labelKey: string, hrefKey: string, labelPlaceholder: string): FieldDef[] => [
  { key: labelKey, label: "Button text", kind: "text", max: 60, placeholder: labelPlaceholder },
  { key: hrefKey, label: "Button link", kind: "link" },
];

export const SPACING_FIELD: FieldDef = {
  key: "appearance.spacing",
  label: "Space above and below",
  kind: "choice",
  defaultValue: "default",
  options: [
    { value: "compact", label: "Compact" },
    { value: "default", label: "Normal" },
    { value: "spacious", label: "Airy" },
  ],
};

export const SHOW_ON_FIELD: FieldDef = {
  key: "appearance.showOn",
  label: "Show on",
  kind: "choice",
  defaultValue: "all",
  options: [
    { value: "all", label: "All screens" },
    { value: "desktop", label: "Computers" },
    { value: "mobile", label: "Phones & tablets" },
  ],
  hint: "Computers means 1024px and wider.",
};

export const SECTION_FIELDS: Record<HomepageSectionType, SectionFields> = {
  HERO: {
    content: [
      { key: "subtext", label: "Small text above the headline", kind: "text", max: 300, placeholder: "New season" },
      { key: "headline", label: "Headline", kind: "text", max: 200, hint: "Empty uses your store tagline, then the store name." },
      { key: "bodyText", label: "Supporting line", kind: "textarea", max: 300, rows: 2 },
      ...BUTTON("ctaLabel", "ctaHref", "Explore the collection"),
      { key: "secondaryCtaLabel", label: "Second button text", kind: "text", max: 60 },
      { key: "secondaryCtaHref", label: "Second button link", kind: "link" },
      {
        key: "imageUrl",
        label: "Photograph",
        kind: "image",
        altKey: "imageAltText",
        spec: (c) => heroPhotoSpecKey((c.appearance as { layout?: string } | undefined)?.layout),
      },
      // Phones draw the hero photo as a tall 4:5 frame — a wide photograph loses its sides there, so it gets its own.
      {
        key: "mobileImageUrl",
        label: "Phone photograph (optional)",
        kind: "image",
        spec: "heroSectionPhone",
        hint: "Without it, phones show the middle of the photograph above.",
        presets: ["classic"],
        showIf: has("imageUrl"),
      },
    ],
    style: [
      TONE,
      {
        key: "appearance.layout",
        label: "Photo position (computers)",
        kind: "choice",
        defaultValue: "theme",
        options: [
          { value: "theme", label: "Theme" },
          { value: "stacked", label: "Below text" },
          { value: "split", label: "Beside text" },
        ],
        presets: ["classic"],
        showIf: has("imageUrl"),
      },
    ],
  },
  TRUST_STRIP: {
    content: [
      {
        key: "items",
        label: "Promises",
        kind: "items",
        itemLabel: "promise",
        min: 1,
        max: 8,
        newItem: () => ({ icon: "Truck", label: "" }),
        summary: (item) => String(item.label || "New promise"),
        fields: [
          { key: "icon", label: "Icon", kind: "icon" },
          { key: "label", label: "Text", kind: "text", max: 60, placeholder: "Cash on delivery" },
        ],
      },
    ],
    style: [],
  },
  PERSONALIZED_LEAD: {
    content: [
      { key: "eyebrow", label: "Small text above the title", kind: "text", max: 60, placeholder: "Welcome back" },
      {
        key: "titleTemplate",
        label: "Title",
        kind: "text",
        max: 200,
        placeholder: "More {category}, picked for you",
        hint: "{category} becomes the category the visitor looked at last.",
      },
    ],
    style: [],
  },
  PRODUCT_CAROUSEL: {
    content: [
      { key: "heading", label: "Heading", kind: "text", max: 200 },
      { key: "subtitle", label: "Supporting line", kind: "text", max: 300 },
      {
        key: "source",
        label: "Products",
        kind: "choice",
        defaultValue: "featured",
        options: [
          { value: "featured", label: "Featured" },
          { value: "new", label: "Newest" },
          { value: "category", label: "A category" },
        ],
        hint: "Featured falls back to the newest products when none are marked featured.",
      },
      { key: "category", label: "Category", kind: "category", showIf: (c) => c.source === "category" },
      { key: "itemCount", label: "How many", kind: "number", min: 1, max: 24, defaultValue: 8 },
    ],
    style: [
      {
        key: "appearance.rows",
        label: "Rows",
        kind: "choice",
        defaultValue: 2,
        options: [
          { value: 1, label: "One row" },
          { value: 2, label: "Two rows" },
        ],
        presets: ["classic"],
      },
    ],
  },
  FLASH_SALE: { content: [], style: [] },
  CATEGORY_GRID: {
    content: [
      { key: "heading", label: "Heading", kind: "text", max: 200, placeholder: "Shop by Category" },
      { key: "subtitle", label: "Supporting line", kind: "text", max: 300 },
    ],
    style: [BACKGROUND],
  },
  BRAND_STORY: {
    content: [
      { key: "eyebrow", label: "Small text above the heading", kind: "text", max: 60, placeholder: "Our Philosophy" },
      { key: "heading", label: "Heading", kind: "text", max: 200, hint: "Empty uses your store tagline, then the store name." },
      { key: "bodyText", label: "Text", kind: "textarea", max: 1000, rows: 4 },
      ...BUTTON("ctaLabel", "ctaHref", "Explore the collection"),
      {
        key: "imageUrl",
        label: "Photograph",
        kind: "image",
        altKey: "imageAltText",
        aspectHint: "Landscape, at least 1800px wide, for the backdrop.",
        spec: (c) => ((c.appearance as { layout?: string } | undefined)?.layout === "backdrop" ? undefined : "brandStory"),
      },
    ],
    style: [
      { ...TONE, showIf: (c) => !(c.imageUrl && (c.appearance as { layout?: string } | undefined)?.layout === "backdrop") },
      {
        key: "appearance.layout",
        label: "Photo",
        kind: "choice",
        defaultValue: "image-right",
        options: [
          { value: "image-left", label: "Left" },
          { value: "image-right", label: "Right" },
          { value: "backdrop", label: "Behind text" },
        ],
        presets: ["classic"],
        showIf: has("imageUrl"),
      },
      {
        key: "appearance.layout",
        label: "Photo",
        kind: "choice",
        defaultValue: "image-left",
        options: [
          { value: "image-left", label: "Left" },
          { value: "image-right", label: "Right" },
        ],
        presets: ["mihrab"],
        showIf: has("imageUrl"),
      },
    ],
  },
  VALUES_GRID: {
    content: [
      { key: "eyebrow", label: "Small text above the heading", kind: "text", max: 60 },
      { key: "heading", label: "Heading", kind: "text", max: 200, placeholder: "What We Stand For" },
      {
        key: "items",
        label: "Values",
        kind: "items",
        itemLabel: "value",
        min: 1,
        max: 8,
        newItem: () => ({ icon: "Sparkles", title: "", description: "" }),
        summary: (item) => String(item.title || "New value"),
        fields: [
          { key: "icon", label: "Icon", kind: "icon" },
          { key: "title", label: "Title", kind: "text", max: 60 },
          { key: "description", label: "Description", kind: "textarea", max: 300, rows: 2 },
        ],
      },
    ],
    style: [BACKGROUND],
  },
  SMART_RECOMMENDATIONS: {
    content: [{ key: "title", label: "Title", kind: "text", max: 200, placeholder: "Trending In Your Budget" }],
    style: [],
  },
  PROMO_BANNER: {
    content: [
      { key: "heading", label: "Heading", kind: "text", max: 200 },
      { key: "bodyText", label: "Text", kind: "textarea", max: 500, rows: 2 },
      { key: "ctaLabel", label: "Button text", kind: "text", max: 60 },
      { key: "linkUrl", label: "Link", kind: "link", hint: "The whole banner links here." },
      { key: "imageUrl", label: "Photograph (optional)", kind: "image", altKey: "imageAltText", spec: "promoDesktop", hint: "Without a photo it is a text band." },
      { key: "mobileImageUrl", label: "Phone photograph (optional)", kind: "image", spec: "promoPhone", hint: "Without it, phones show the middle of the photograph above.", showIf: has("imageUrl") },
    ],
    style: [
      { ...TONE, showIf: lacks("imageUrl") },
      {
        key: "appearance.width",
        label: "Width",
        kind: "choice",
        defaultValue: "contained",
        options: [
          { value: "contained", label: "In page" },
          { value: "full", label: "Edge to edge" },
        ],
        presets: ["classic"],
        showIf: has("imageUrl"),
      },
      {
        key: "appearance.align",
        label: "Text",
        kind: "choice",
        defaultValue: "center",
        options: [
          { value: "start", label: "Left" },
          { value: "center", label: "Centred" },
        ],
        presets: ["classic"],
      },
    ],
  },
  RICH_TEXT: {
    content: [
      { key: "eyebrow", label: "Small text above the heading", kind: "text", max: 60 },
      { key: "heading", label: "Heading", kind: "text", max: 200 },
      { key: "bodyText", label: "Text", kind: "textarea", max: 2000, rows: 5, hint: "Line breaks are kept." },
      ...BUTTON("ctaLabel", "ctaHref", "Read more"),
      {
        key: "align",
        label: "Alignment",
        kind: "choice",
        defaultValue: "start",
        options: [
          { value: "start", label: "Left" },
          { value: "center", label: "Centred" },
        ],
      },
    ],
    style: [BACKGROUND],
  },
  TESTIMONIALS: {
    content: [
      { key: "eyebrow", label: "Small text above the heading", kind: "text", max: 60, placeholder: "Customer reviews" },
      { key: "heading", label: "Heading", kind: "text", max: 200, placeholder: "What our customers say" },
      { key: "count", label: "How many reviews", kind: "number", min: 3, max: 12, defaultValue: 6 },
      {
        key: "minRating",
        label: "Lowest rating shown",
        kind: "choice",
        defaultValue: 4,
        options: [
          { value: 3, label: "3★ and up" },
          { value: 4, label: "4★ and up" },
          { value: 5, label: "5★ only" },
        ],
        hint: "The newest approved reviews with written text are shown.",
      },
    ],
    style: [BACKGROUND],
  },
  NEWSLETTER: {
    content: [
      { key: "heading", label: "Heading", kind: "text", max: 200, placeholder: "Be the first to know" },
      { key: "bodyText", label: "Text", kind: "textarea", max: 400, rows: 2 },
    ],
    style: [BACKGROUND],
  },
  IMAGE_GALLERY: {
    content: [
      { key: "eyebrow", label: "Small text above the heading", kind: "text", max: 60 },
      { key: "heading", label: "Heading", kind: "text", max: 200 },
      {
        key: "layout",
        label: "Arrangement",
        kind: "choice",
        defaultValue: "mosaic",
        options: [
          { value: "mosaic", label: "Feature + grid" },
          { value: "grid", label: "Even grid" },
        ],
      },
      {
        key: "items",
        label: "Photos",
        kind: "items",
        itemLabel: "photo",
        min: 2,
        max: 8,
        newItem: () => ({ imageUrl: "", altText: "", caption: "", linkUrl: "" }),
        summary: (item) => String(item.caption || item.altText || (item.imageUrl ? "Photo" : "New photo")),
        fields: [
          { key: "imageUrl", label: "Photo", kind: "image", altKey: "altText", spec: "galleryPhoto" },
          { key: "caption", label: "Caption", kind: "text", max: 80 },
          { key: "linkUrl", label: "Link", kind: "link" },
        ],
      },
    ],
    style: [BACKGROUND],
  },
};

/* ── config path helpers ── */

export function getAt(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => (value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined), obj);
}

/** Immutable set; an empty string or a default removes the key (so the stored config stays minimal). */
export function setAt(obj: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const [head, ...rest] = path.split(".");
  if (rest.length === 0) {
    const next = { ...obj };
    if (value === undefined || value === "") delete next[head!];
    else next[head!] = value;
    return next;
  }
  const child = (obj[head!] && typeof obj[head!] === "object" ? obj[head!] : {}) as Record<string, unknown>;
  const updated = setAt(child, rest.join("."), value);
  const next = { ...obj };
  if (Object.keys(updated).length === 0) delete next[head!];
  else next[head!] = updated;
  return next;
}

export function visibleFields(fields: FieldDef[], config: Record<string, unknown>, layout: StoreLayout) {
  return fields.filter((f) => (!f.presets || f.presets.includes(layout)) && (!f.showIf || f.showIf(config)));
}
