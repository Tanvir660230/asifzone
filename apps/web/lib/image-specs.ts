import tokens from "@clothing-brand/ui-tokens";
import { publicRuntimeConfig } from "@/lib/runtime-config";
import { resolveThemeId } from "@/lib/theme";
import { storeLayout } from "@/lib/theme-layout";

/**
 * The shape and size every storefront image slot is drawn at — one list, so the admin can ask for exactly the picture
 * each frame needs (and say so in pixels) instead of one photo being cropped into several different shapes.
 *
 * Each value mirrors the frame in the storefront component named in `frame`; change both together.
 */
export interface ImageSpec {
  /** Width : height of the frame. */
  ratio: readonly [number, number];
  /** The size to export at — sharp on a 3× phone screen or a large monitor. */
  width: number;
  height: number;
  /** Below this width the image looks soft where it is shown. */
  minWidth: number;
  /** Where it appears, in the shopkeeper's words. */
  usedIn: string;
  /** The storefront component that draws the frame. */
  frame: string;
}

const SPECS = {
  // Banners → Hero: components/storefront/hero-carousel.tsx (aspect-square, lg:aspect-[3/1]).
  bannerDesktop: { ratio: [3, 1], width: 1920, height: 640, minWidth: 1440, usedIn: "the homepage hero on computers (1024px and wider)", frame: "hero-carousel" },
  bannerPhone: { ratio: [1, 1], width: 1200, height: 1200, minWidth: 900, usedIn: "the homepage hero on phones and tablets", frame: "hero-carousel" },
  // Homepage → Promo banner: components/storefront/promo-banner-section.tsx (aspect-[16/9], sm:aspect-[3/1]).
  promoDesktop: { ratio: [3, 1], width: 1800, height: 600, minWidth: 1440, usedIn: "the promo banner from tablet width up", frame: "promo-banner-section" },
  promoPhone: { ratio: [16, 9], width: 1200, height: 675, minWidth: 900, usedIn: "the promo banner on phones (under 640px)", frame: "promo-banner-section" },
  // Homepage → Hero section: .ui-hero-media-frame in globals.css (4:5, sm 16:9, lg 21:9 stacked / 4:5 split).
  heroSectionWide: { ratio: [21, 9], width: 2100, height: 900, minWidth: 1600, usedIn: "the hero photograph from tablet width up", frame: "hero" },
  heroSectionSplit: { ratio: [4, 5], width: 1200, height: 1500, minWidth: 900, usedIn: "the hero photograph beside the headline", frame: "hero" },
  heroSectionPhone: { ratio: [4, 5], width: 1200, height: 1500, minWidth: 900, usedIn: "the hero photograph on phones (under 640px)", frame: "hero" },
  // Homepage → Brand story: components/storefront/brand-story.tsx (4:5, sm 5:4, lg 4:5).
  brandStory: { ratio: [4, 5], width: 1200, height: 1500, minWidth: 900, usedIn: "the brand story photo (keep the subject in the middle — tablets show it wider)", frame: "brand-story" },
  // Homepage → Photo gallery: components/storefront/image-gallery-section.tsx (aspect-[4/5]).
  galleryPhoto: { ratio: [4, 5], width: 1200, height: 1500, minWidth: 800, usedIn: "a photo gallery tile", frame: "image-gallery-section" },
  // Categories: components/storefront/category-grid.tsx (4:5 half-width tiles, 16:10 full-width and large tiles).
  categoryPortrait: { ratio: [4, 5], width: 1200, height: 1500, minWidth: 800, usedIn: "half-width category tiles (most tiles on phones, the small ones on computers)", frame: "category-grid" },
  categoryWide: { ratio: [16, 10], width: 1600, height: 1000, minWidth: 1200, usedIn: "wide category tiles (the first tile on phones, the two large ones on computers)", frame: "category-grid" },
  // Settings → Share image: Open Graph.
  shareImage: { ratio: [1200, 630], width: 1200, height: 630, minWidth: 1200, usedIn: "the preview when a link is shared on Facebook or WhatsApp", frame: "og:image" },
} as const satisfies Record<string, ImageSpec>;

export type ImageSpecKey = keyof typeof SPECS | "productPhoto";

/** Product photos take the product card / gallery frame of the installed theme: square in classic, 4:5 in mihrab. */
function productPhotoSpec(): ImageSpec {
  return storeLayout() === "mihrab"
    ? { ratio: [4, 5], width: 1600, height: 2000, minWidth: 1000, usedIn: "product cards and the product page", frame: "mihrab/product-card" }
    : { ratio: [1, 1], width: 1600, height: 1600, minWidth: 1000, usedIn: "product cards and the product page", frame: "product-card" };
}

export function imageSpec(key: ImageSpecKey): ImageSpec {
  return key === "productPhoto" ? productPhotoSpec() : SPECS[key];
}

/** The hero section's photograph frame: beside the copy (4:5) when the section or the theme composes it that way — and
 * always in the mihrab preset's arch — otherwise the wide band under the copy. */
export function heroPhotoSpecKey(layout: unknown): ImageSpecKey {
  if (storeLayout() === "mihrab") return "heroSectionSplit";
  if (layout === "split") return "heroSectionSplit";
  if (layout === "stacked") return "heroSectionWide";
  const themeLayout = tokens.themes[resolveThemeId(publicRuntimeConfig().theme)]?.cssVariables["--hero-layout-lg"];
  return themeLayout === "grid" ? "heroSectionSplit" : "heroSectionWide";
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** "3:1", "4:5", "1.91:1" … — the ratio as people say it. */
export function ratioLabel([w, h]: readonly [number, number]): string {
  // Small ratios read as written ("16:10", not "8:5"); pixel pairs are reduced.
  if (w <= 21 && h <= 21) return `${w}:${h}`;
  const d = gcd(w, h);
  if (w / d <= 21 && h / d <= 21) return `${w / d}:${h / d}`;
  return `${(w / h).toFixed(2).replace(/\.?0+$/, "")}:1`;
}

export function shapeName([w, h]: readonly [number, number]): string {
  if (w === h) return "square";
  return w > h ? "landscape" : "portrait";
}

/** One line for under an upload box: "1920 × 640 px (3:1, landscape) — the homepage hero on computers". */
export function specSummary(spec: ImageSpec): string {
  return `${spec.width} × ${spec.height} px (${ratioLabel(spec.ratio)}, ${shapeName(spec.ratio)}) — ${spec.usedIn}`;
}

/** `short` fits under a thumbnail; `message` is the full sentence for a form field. */
export type FitVerdict =
  | { kind: "ok" }
  | { kind: "small"; message: string; short: string }
  | { kind: "shape"; message: string; short: string };

/** How a picture of this size will sit in the frame. A ratio within 4% is a fit (the crop is a sliver); otherwise it
 * says which edges get cut. Too small is reported before shape, because a soft photo is the worse problem. */
export function checkFit(spec: ImageSpec, width: number, height: number): FitVerdict {
  if (width < spec.minWidth) {
    return {
      kind: "small",
      message: `${width} × ${height} px is small for ${spec.usedIn}; it may look blurry. Use at least ${spec.minWidth} px wide (${spec.width} × ${spec.height} is ideal).`,
      short: `${width} × ${height} px — too small, may look blurry`,
    };
  }
  const target = spec.ratio[0] / spec.ratio[1];
  const actual = width / height;
  if (Math.abs(actual - target) / target <= 0.04) return { kind: "ok" };
  const cut = actual > target ? "the left and right sides" : "the top and bottom";
  const lost = Math.round((1 - Math.min(actual, target) / Math.max(actual, target)) * 100);
  return {
    kind: "shape",
    message: `${width} × ${height} px is ${ratioLabel(simplify(width, height))}, but this frame is ${ratioLabel(spec.ratio)} — about ${lost}% of the picture (${cut}) will be cut off. Export it at ${spec.width} × ${spec.height} px.`,
    short: `${width} × ${height} px — not ${ratioLabel(spec.ratio)} ${shapeName(spec.ratio)}, ${actual > target ? "sides" : "top and bottom"} cut off`,
  };
}

function simplify(w: number, h: number): readonly [number, number] {
  // Snap near-standard photo ratios (e.g. 1600×1066) to their usual name instead of "800:533".
  const common: Array<readonly [number, number]> = [[1, 1], [4, 5], [5, 4], [3, 4], [4, 3], [2, 3], [3, 2], [16, 9], [9, 16], [16, 10], [3, 1], [21, 9]];
  const r = w / h;
  const near = common.find(([a, b]) => Math.abs(a / b - r) / r < 0.02);
  return near ?? [w, h];
}
