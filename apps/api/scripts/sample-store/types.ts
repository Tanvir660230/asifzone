import type { BrandStoryConfig, HeroConfig, PromoBannerConfig } from "@clothing-brand/shared";
import type { ArtKind } from "./placeholder-art";

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
  };
  /** Rendered as a clearly labelled placeholder wordmark, replaced through Admin → Settings. */
  logo: { wordmark: string };
  categories: { key: string; name: string; art: ArtKind; tone: string }[];
  products: SampleProduct[];
  hero: { art: ArtKind; tone: string; config: Omit<HeroConfig, "imageUrl"> };
  brandStory: { art: ArtKind; tone: string; config: Omit<BrandStoryConfig, "imageUrl"> };
  promoBanner: { art: ArtKind; tone: string; config: Omit<PromoBannerConfig, "imageUrl" | "mobileImageUrl"> };
  valuesGrid: { eyebrow: string | null; heading: string | null; items: { icon: string; title: string; description: string }[] };
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
