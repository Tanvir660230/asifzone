import type { HomepageSectionType } from "@clothing-brand/shared";
import type { ArtKind } from "./placeholder-art";

/** A placeholder image to generate and upload for a homepage section field (`imageUrl`, `mobileImageUrl`). */
export interface SampleImage {
  art: ArtKind;
  tone: string;
  width: number;
  height: number;
}

/** A local-only sample store: placeholder content to build and review a storefront before its real catalog exists. */
export interface SampleStore {
  settings: {
    storeName: string;
    tagline: string;
    contactEmail: string;
    currency: string;
    // Store policy (Admin → Settings → Shipping, Tax & Rewards → Store policy).
    returnWindowDays: number | null;
    returnConditions: string | null;
    handlingDaysMin: number | null;
    handlingDaysMax: number | null;
    codEnabled: boolean;
    // Search and newsletter copy (Admin → Settings → Search engines / Newsletter).
    seoTitle: string | null;
    seoDescription: string | null;
    newsletterHeading: string | null;
    newsletterText: string | null;
  };
  /** Brand files (paths from the repository root), uploaded through the same pipeline as Admin → Settings. */
  brand: { logo: string; logoOnDark: string; favicon: string; socialImage: string };
  categories: { key: string; name: string; art: ArtKind; tone: string }[];
  products: SampleProduct[];
  /** The homepage, in order — only existing section types, each config validated by the admin's own schema. Image fields
   * listed in `images` are generated and uploaded, then set on the config. */
  homepage: { type: HomepageSectionType; config: Record<string, unknown>; images?: Partial<Record<"imageUrl" | "mobileImageUrl", SampleImage>> }[];
}

export interface SampleProduct {
  category: string;
  art: ArtKind;
  tone: string;
  name: string;
  slug: string;
  productType: "CLOTHING" | "FRAGRANCE" | "ACCESSORY" | "ISLAMIC_PRODUCT" | "HOME";
  price: number;
  compareAt?: number;
  featured?: boolean;
  brand: string;
  short: string;
  description: string;
  /** Every size × colour becomes one variant (a product with no colours gets one variant per size). */
  variants: { sizes: string[]; colors: [name: string, hex: string][]; stock: number };
}
