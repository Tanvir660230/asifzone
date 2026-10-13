import { z } from "zod";
import { nullableString } from "./schemas/common";

/**
 * The store's own design choices on top of its brand theme — set in the Storefront Studio's "Site design" tab and
 * published with the homepage. Every choice is a token value (colour channels, a font variable, a radius scale), so the
 * storefront still changes only through tokens; nothing here adds styling of its own. Empty = the theme as designed.
 */

/** A 6-digit hex colour (#1F3A5F) — the one form the design accepts, everywhere it's read. */
export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

const hexColor = z.string().refine(isHexColor, "Use a colour like #1F3A5F");

/** A link the store puts in its menus: a page of the store (/sale), a web address (https://…), email or phone. Not
 * protocol-relative (//host) or script URLs. */
export function isSafeHref(value: string) {
  return /^\/(?!\/)/.test(value) || /^https?:\/\/\S+$/i.test(value) || /^(mailto|tel):\S+$/i.test(value);
}

const hrefSchema = z.string().trim().min(1, "Add a link").max(300).refine(isSafeHref, "Use a page of your store (/sale) or a full web address (https://…)");

export const designHeadingFontEnum = z.enum(["playfair", "editorial", "grotesk", "inter"]);
export const designBodyFontEnum = z.enum(["inter", "grotesk"]);

export const designThemeSchema = z
  .object({
    /** Primary buttons, links and focus rings. Its text colour is picked automatically for contrast. */
    accent: hexColor.optional(),
    headingFont: designHeadingFontEnum.optional(),
    bodyFont: designBodyFontEnum.optional(),
    corners: z.enum(["sharp", "soft", "round"]).optional(),
    /** Space between homepage and product-page sections, store-wide. */
    rhythm: z.enum(["compact", "default", "airy"]).optional(),
    /** The sections designed as dark bands (hero, story, footer …): kept dark, or rendered light. */
    bands: z.enum(["dark", "light"]).optional(),
  })
  .strict();

const navLinkSchema = z.object({
  label: z.string().trim().min(1, "Add a label").max(40),
  href: hrefSchema,
});

export const announcementSchema = z
  .object({
    enabled: z.boolean().default(false),
    tone: z.enum(["dark", "accent", "light"]).optional(),
    messages: z
      .array(
        z.object({
          text: z.string().trim().min(1, "Write the message").max(120),
          href: z.preprocess((v) => (v === "" ? null : v), hrefSchema.nullable().optional()),
        }),
      )
      .max(3)
      .default([]),
  })
  .strict()
  .refine((a) => !a.enabled || a.messages.length > 0, { message: "Add a message, or switch the bar off", path: ["messages"] });

export const designHeaderSchema = z
  .object({
    /** Extra links in the main menu, before the categories (New in, Sale, Lookbook …). */
    menuLinks: z.array(navLinkSchema).max(6).default([]),
  })
  .strict();

export const designFooterSchema = z
  .object({
    /** The short line under the logo; empty keeps the store tagline. */
    about: nullableString(300),
    showNewsletter: z.boolean().optional(),
    linksTitle: nullableString(40),
    links: z.array(navLinkSchema).max(8).default([]),
  })
  .strict();

export const storefrontDesignSchema = z
  .object({
    theme: designThemeSchema.optional(),
    announcement: announcementSchema.optional(),
    header: designHeaderSchema.optional(),
    footer: designFooterSchema.optional(),
  })
  .strict();

export type StorefrontDesign = z.infer<typeof storefrontDesignSchema>;
export type DesignTheme = z.infer<typeof designThemeSchema>;
export type DesignAnnouncement = z.infer<typeof announcementSchema>;
export type DesignNavLink = z.infer<typeof navLinkSchema>;
export type StorefrontDesignGroup = "theme" | "announcement" | "header" | "footer";

/** Problems that block publishing the site design, keyed by group ("announcement") and by field path for the inspector. */
export function validateStorefrontDesign(design: unknown): { groups: Partial<Record<StorefrontDesignGroup, string[]>>; fields: Record<string, string> } {
  const result = storefrontDesignSchema.safeParse(design ?? {});
  const groups: Partial<Record<StorefrontDesignGroup, string[]>> = {};
  const fields: Record<string, string> = {};
  if (result.success) return { groups, fields };
  for (const issue of result.error.issues) {
    const [group, ...rest] = issue.path;
    const key = (typeof group === "string" ? group : "theme") as StorefrontDesignGroup;
    (groups[key] ??= []).push(issue.message);
    fields[[key, ...rest].join(".")] ??= issue.message;
  }
  return { groups, fields };
}

/* ── colour ── */

export function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]: [number, number, number]) {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two colours. */
export function contrastRatio(a: [number, number, number], b: [number, number, number]) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** White or near-black — whichever reads better on the accent. */
export function accentForeground(accent: [number, number, number]): [number, number, number] {
  const white: [number, number, number] = [255, 255, 255];
  const ink: [number, number, number] = [17, 17, 17];
  return contrastRatio(accent, white) >= contrastRatio(accent, ink) ? white : ink;
}

/** The accent a shade darker, for the pointer-over state of a filled button. */
export function darken([r, g, b]: [number, number, number], amount = 0.12): [number, number, number] {
  return [r, g, b].map((c) => Math.round(c * (1 - amount))) as [number, number, number];
}
