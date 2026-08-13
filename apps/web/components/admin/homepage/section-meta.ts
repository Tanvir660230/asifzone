import {
  BookOpen,
  FolderTree,
  Image as ImageIcon,
  Megaphone,
  Shield,
  ShoppingBag,
  Sparkles,
  UserCheck,
  Zap,
  Heart,
  type LucideIcon,
} from "lucide-react";
import type { HomepageSectionType } from "@clothing-brand/shared";

interface SectionMeta {
  label: string;
  description: string;
  icon: LucideIcon;
  /** Whether this type has an editable config panel — the purely behavioral/data-driven types
   * (Hero, FlashSale, PersonalizedLead, SmartRecommendations) only expose the position/toggle. */
  editable: boolean;
}

export const SECTION_META: Record<HomepageSectionType, SectionMeta> = {
  HERO: {
    label: "Hero banner",
    description: "Main banners are managed in Banners — edit here to set the fallback text shown when none are active.",
    icon: ImageIcon,
    editable: true,
  },
  TRUST_STRIP: {
    label: "Trust strip",
    description: "The short trust badges shown under the hero.",
    icon: Shield,
    editable: true,
  },
  PERSONALIZED_LEAD: {
    label: "Personalized lead",
    description: "Shown only to returning visitors with browsing history — edit the eyebrow and title text.",
    icon: UserCheck,
    editable: true,
  },
  PRODUCT_CAROUSEL: {
    label: "Product carousel",
    description: "A row of products — featured, newest, or one category.",
    icon: ShoppingBag,
    editable: true,
  },
  FLASH_SALE: {
    label: "Flash sale",
    description: "Shown only while a flash sale is active — managed in Flash Sales.",
    icon: Zap,
    editable: false,
  },
  CATEGORY_GRID: {
    label: "Category grid",
    description: "Shows every top-level category — managed in Categories.",
    icon: FolderTree,
    editable: true,
  },
  BRAND_STORY: {
    label: "Brand story",
    description: "The full-width dark philosophy block — text and an optional image.",
    icon: BookOpen,
    editable: true,
  },
  VALUES_GRID: {
    label: "Values grid",
    description: 'The "What We Stand For" cards.',
    icon: Heart,
    editable: true,
  },
  SMART_RECOMMENDATIONS: {
    label: "Smart recommendations",
    description: "Trending + recently viewed products — edit the title text.",
    icon: Sparkles,
    editable: true,
  },
  PROMO_BANNER: {
    label: "Promo banner",
    description: "A custom image banner with optional text and link.",
    icon: Megaphone,
    editable: true,
  },
};
