import { contrastRatio, hexToRgb, isHexColor, validateStorefrontDesign, type StorefrontDesign } from "./storefront-design";
import {
  configSchemaByType,
  REPEATABLE_SECTION_TYPES,
  type HomepageSectionType,
  type SectionAppearance,
  type StudioSection,
} from "./schemas/homepage-section";

/**
 * The Storefront Studio's rules, shared by the admin editor (live, as the admin types) and the API (on publish), so
 * both always agree on what can go live.
 */

/** Every problem that blocks publishing, keyed by section id. Empty object = publishable. */
export function validateStudioSections(sections: StudioSection[]): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  const add = (id: string, message: string) => (errors[id] ??= []).push(message);
  const seen = new Set<HomepageSectionType>();

  for (const section of sections) {
    if (!REPEATABLE_SECTION_TYPES.includes(section.type)) {
      if (seen.has(section.type)) add(section.id, "The homepage can have only one of this section.");
      seen.add(section.type);
    }
    const result = configSchemaByType[section.type].safeParse(section.config ?? {});
    if (!result.success) {
      for (const issue of result.error.issues) add(section.id, issueMessage(issue.path, issue.message));
    }
    if (section.startsAt && section.endsAt && new Date(section.startsAt) > new Date(section.endsAt)) {
      add(section.id, "The schedule ends before it starts.");
    }
  }
  return errors;
}

/** Field-level errors for one section (path joined with "."), for the inspector to show next to each field. */
export function studioFieldErrors(section: StudioSection): Record<string, string> {
  const result = configSchemaByType[section.type].safeParse(section.config ?? {});
  if (result.success) return {};
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) errors[issue.path.join(".")] ??= friendly(issue.message);
  return errors;
}

function issueMessage(path: (string | number)[], message: string) {
  const field = path.length ? `${humanize(path)}: ` : "";
  return `${field}${friendly(message)}`;
}

function humanize(path: (string | number)[]) {
  return path
    .map((p) => (typeof p === "number" ? `#${p + 1}` : p.replace(/([A-Z])/g, " $1").toLowerCase()))
    .join(" ");
}

function friendly(message: string) {
  if (/at least 1 character/.test(message)) return "Required";
  if (/^Required$/.test(message)) return "Required";
  if (/Invalid url/.test(message)) return "Upload an image";
  return message;
}

export type StudioCheckLevel = "error" | "warning" | "tip";
export interface StudioCheck {
  sectionId: string | null;
  level: StudioCheckLevel;
  code:
    | "invalid"
    | "schedule-expired"
    | "missing-alt"
    | "long-heading"
    | "cta-incomplete"
    | "dark-bands-adjacent"
    | "no-hero"
    | "wide-promo-no-mobile-image"
    | "accent-low-contrast"
    | "announcement-long";
  message: string;
}

export interface StudioCheckOptions {
  /** The bands the store's theme already renders light (`lightBands` in ui-tokens), or "all". */
  lightBands?: string[] | "all";
}

/** Headings longer than this wrap to four or more lines on a 375px phone at the display sizes the sections use. */
const LONG_HEADING = 70;

/** Which sections paint a dark band by default, and the band name the theme uses for them. */
function bandOf(section: StudioSection): string | null {
  const config = section.config as Record<string, unknown>;
  if (section.type === "HERO") return "hero";
  if (section.type === "BRAND_STORY") return "story";
  if (section.type === "PROMO_BANNER" && !config.imageUrl) return "promo";
  return null;
}

function isDark(section: StudioSection, options: StudioCheckOptions) {
  const band = bandOf(section);
  if (!band) return false;
  const tone = (section.config.appearance as SectionAppearance | undefined)?.tone ?? "theme";
  if (tone !== "theme") return tone === "dark";
  const light = options.lightBands;
  return !(light === "all" || light?.includes(band));
}

function isLive(section: StudioSection, now: Date) {
  if (!section.isActive) return false;
  if (section.startsAt && new Date(section.startsAt) > now) return false;
  if (section.endsAt && new Date(section.endsAt) < now) return false;
  return true;
}

/** Site-design checks (Studio "Site design" tab). Section ids are `design:<group>`. */
export function studioDesignChecks(design: unknown): StudioCheck[] {
  const checks: StudioCheck[] = [];
  const { groups } = validateStorefrontDesign(design);
  for (const [group, messages] of Object.entries(groups)) {
    checks.push({ sectionId: `design:${group}`, level: "error", code: "invalid", message: messages![0]! });
  }
  const d = (design ?? {}) as StorefrontDesign;
  const accent = d.theme?.accent;
  // The accent is also link and focus colour on the page background: under 3:1 it stops reading as either.
  if (isHexColor(accent) && contrastRatio(hexToRgb(accent), [255, 255, 255]) < 3) {
    checks.push({ sectionId: "design:theme", level: "warning", code: "accent-low-contrast", message: "This brand colour is light — links and focus rings in it are hard to see. Pick a deeper shade." });
  }
  if (d.announcement?.enabled && d.announcement.messages?.some((m) => (m?.text ?? "").length > 70)) {
    checks.push({ sectionId: "design:announcement", level: "tip", code: "announcement-long", message: "Long announcements wrap to two lines on phones — aim for under 70 characters." });
  }
  return checks;
}

/** Page-health checks the Studio shows before publishing: errors block it, warnings and tips only advise. */
export function studioHealthChecks(sections: StudioSection[], now: Date, options: StudioCheckOptions = {}): StudioCheck[] {
  const checks: StudioCheck[] = [];
  const invalid = validateStudioSections(sections);
  for (const [sectionId, messages] of Object.entries(invalid)) {
    checks.push({ sectionId, level: "error", code: "invalid", message: messages[0]! });
  }

  for (const section of sections) {
    if (!section.isActive) continue;
    const config = section.config as Record<string, unknown>;
    const text = (key: string) => (typeof config[key] === "string" ? (config[key] as string).trim() : "");

    if (section.endsAt && new Date(section.endsAt) < now) {
      checks.push({ sectionId: section.id, level: "warning", code: "schedule-expired", message: "Its schedule has ended, so shoppers never see it." });
    }
    const heading = text("heading") || text("headline");
    if (heading.length > LONG_HEADING) {
      checks.push({ sectionId: section.id, level: "warning", code: "long-heading", message: `The heading is ${heading.length} characters — it wraps to many lines on phones. Aim for under ${LONG_HEADING}.` });
    }
    // Buttons that render only with both a label and a link (the hero's and brand story's main button fall back to the
    // shop page and a default label, so they are never incomplete). A promo banner may be clickable without a label.
    const incompleteButton =
      section.type === "PROMO_BANNER"
        ? Boolean(text("ctaLabel")) && !text("linkUrl")
        : section.type === "RICH_TEXT"
          ? Boolean(text("ctaLabel")) !== Boolean(text("ctaHref"))
          : section.type === "HERO" && Boolean(text("secondaryCtaLabel")) !== Boolean(text("secondaryCtaHref"));
    if (incompleteButton) {
      checks.push({ sectionId: section.id, level: "warning", code: "cta-incomplete", message: "This button needs both a label and a link, or it won't show." });
    }
    const hasImage = Boolean(text("imageUrl"));
    if (hasImage && !text("imageAltText") && ["HERO", "BRAND_STORY", "PROMO_BANNER"].includes(section.type)) {
      checks.push({ sectionId: section.id, level: "tip", code: "missing-alt", message: "Describe the image (alt text) for screen readers and Google Images." });
    }
    if (section.type === "IMAGE_GALLERY" && Array.isArray(config.items) && (config.items as { altText?: string | null }[]).some((i) => !i?.altText)) {
      checks.push({ sectionId: section.id, level: "tip", code: "missing-alt", message: "Some photos have no description (alt text)." });
    }
    if (section.type === "PROMO_BANNER" && hasImage && !text("mobileImageUrl")) {
      checks.push({ sectionId: section.id, level: "tip", code: "wide-promo-no-mobile-image", message: "Add a phone photograph (16:9, 1200 × 675 px) — phones show a taller frame, so the wide one loses its sides." });
    }
  }

  // Two dark bands in a row read as one heavy block; compare neighbours as shoppers will see them (live sections only).
  const live = sections.filter((s) => isLive(s, now));
  for (let i = 1; i < live.length; i++) {
    if (isDark(live[i - 1]!, options) && isDark(live[i]!, options)) {
      checks.push({ sectionId: live[i]!.id, level: "warning", code: "dark-bands-adjacent", message: "Two dark sections in a row — switch one to the light tone or move it." });
    }
  }

  if (!sections.some((s) => s.type === "HERO" && s.isActive)) {
    checks.push({ sectionId: null, level: "tip", code: "no-hero", message: "The hero is switched off — the page opens straight on the next section." });
  }
  return checks;
}
