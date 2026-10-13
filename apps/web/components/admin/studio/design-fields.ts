import type { StorefrontDesignGroup } from "@clothing-brand/shared";
import type { FieldDef } from "./section-fields";

/** Deep, legible brand colours to start from (any colour can be picked; the contrast check warns about pale ones). */
const BRAND_SWATCHES = ["#1f3a5f", "#233e8b", "#0f5257", "#1f4d3a", "#6d1f2f", "#a4452c", "#4b2142", "#222222"];

const themeChoice = (key: string, label: string, options: { value: string; label: string }[], hint?: string): FieldDef => ({
  key,
  label,
  kind: "choice",
  defaultValue: "theme",
  options: [{ value: "theme", label: "Theme" }, ...options],
  hint,
});

const LINKS = (key: string, label: string, max: number, itemLabel: string): FieldDef => ({
  key,
  label,
  kind: "items",
  itemLabel,
  min: 0,
  max,
  newItem: () => ({ label: "", href: "" }),
  summary: (item) => String(item.label || "New link"),
  fields: [
    { key: "label", label: "Label", kind: "text", max: 40, placeholder: "Sale" },
    { key: "href", label: "Link", kind: "link" },
  ],
});

/** What the inspector shows for each Site design group — same declarative fields as the sections. */
export const DESIGN_FIELDS: Record<StorefrontDesignGroup, FieldDef[]> = {
  theme: [
    {
      key: "accent",
      label: "Brand colour",
      kind: "color",
      swatches: BRAND_SWATCHES,
      hint: "Buttons, links and highlights. Text on it switches between white and dark for contrast automatically.",
    },
    themeChoice("headingFont", "Heading font", [
      { value: "playfair", label: "Classic serif" },
      { value: "editorial", label: "Editorial serif" },
      { value: "grotesk", label: "Modern sans" },
      { value: "inter", label: "Clean sans" },
    ]),
    themeChoice("bodyFont", "Text font", [
      { value: "inter", label: "Clean sans" },
      { value: "grotesk", label: "Modern sans" },
    ]),
    themeChoice("corners", "Corners", [
      { value: "sharp", label: "Sharp" },
      { value: "soft", label: "Soft" },
      { value: "round", label: "Round" },
    ], "Buttons, cards and photos."),
    themeChoice("rhythm", "Spacing between sections", [
      { value: "compact", label: "Compact" },
      { value: "default", label: "Normal" },
      { value: "airy", label: "Airy" },
    ]),
    themeChoice("bands", "Dark sections", [
      { value: "dark", label: "Dark" },
      { value: "light", label: "Light" },
    ], "The hero, story, banners and footer. A section's own tone (its Style tab) still wins."),
  ],
  announcement: [
    { key: "enabled", label: "Show the announcement bar", kind: "toggle", defaultValue: false },
    {
      key: "tone",
      label: "Colour",
      kind: "choice",
      defaultValue: "dark",
      options: [
        { value: "dark", label: "Dark" },
        { value: "accent", label: "Brand colour" },
        { value: "light", label: "Light" },
      ],
    },
    {
      key: "messages",
      label: "Messages",
      kind: "items",
      itemLabel: "message",
      min: 0,
      max: 3,
      newItem: () => ({ text: "", href: "" }),
      summary: (item) => String(item.text || "New message"),
      fields: [
        { key: "text", label: "Message", kind: "text", max: 120, placeholder: "Free delivery inside Dhaka this week" },
        { key: "href", label: "Link (optional)", kind: "link" },
      ],
    },
  ],
  header: [LINKS("menuLinks", "Menu links", 6, "link")],
  footer: [
    { key: "about", label: "About your store", kind: "textarea", max: 300, rows: 3, hint: "Under the logo. Empty uses your tagline." },
    { key: "showNewsletter", label: "Newsletter sign-up", kind: "toggle", defaultValue: true },
    { key: "linksTitle", label: "Extra column title", kind: "text", max: 40, placeholder: "Explore" },
    LINKS("links", "Extra column links", 8, "link"),
  ],
};
