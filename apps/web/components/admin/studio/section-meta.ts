import {
  AlignLeft,
  BookOpen,
  FolderTree,
  Heart,
  Image as ImageIcon,
  LayoutGrid,
  Mail,
  Megaphone,
  MessageSquareQuote,
  Shield,
  ShoppingBag,
  Sparkles,
  UserCheck,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { DEFAULT_TRUST_STRIP_ITEMS, DEFAULT_VALUES_GRID_ITEMS, type HomepageSectionType } from "@clothing-brand/shared";

export interface SectionMeta {
  label: string;
  /** One line for the add-section gallery and the inspector header. */
  description: string;
  icon: LucideIcon;
  /** The config a newly added section starts with — valid where the type allows, so it shows something at once. */
  starter: Record<string, unknown>;
  /** Where the content comes from when it isn't edited here (shown in the inspector). */
  managedElsewhere?: { label: string; href: string };
}

export const SECTION_META: Record<HomepageSectionType, SectionMeta> = {
  HERO: {
    label: "Hero",
    description: "The opening band: headline, buttons and an optional photograph.",
    icon: ImageIcon,
    starter: {},
    managedElsewhere: { label: "While hero banners are active they replace this — manage them in Banners", href: "/admin/banners" },
  },
  TRUST_STRIP: { label: "Trust strip", description: "Short promises under the hero — delivery, returns, payment.", icon: Shield, starter: { items: [...DEFAULT_TRUST_STRIP_ITEMS] } },
  PERSONALIZED_LEAD: {
    label: "Welcome back",
    description: "Shown only to returning visitors: more from the category they browsed last.",
    icon: UserCheck,
    starter: {},
  },
  PRODUCT_CAROUSEL: {
    label: "Product rail",
    description: "A row of products — featured, newest, or one category.",
    icon: ShoppingBag,
    starter: { heading: "New arrivals", source: "new", itemCount: 8 },
  },
  FLASH_SALE: {
    label: "Flash sale",
    description: "Appears by itself while a flash sale is running.",
    icon: Zap,
    starter: {},
    managedElsewhere: { label: "Products and timing come from Flash sales", href: "/admin/flash-sales" },
  },
  CATEGORY_GRID: {
    label: "Categories",
    description: "Every top-level category as photo tiles.",
    icon: FolderTree,
    starter: {},
    managedElsewhere: { label: "Category names and photos are edited in Categories", href: "/admin/categories" },
  },
  BRAND_STORY: {
    label: "Image with text",
    description: "A statement beside a photograph, or over it — your story, a campaign, a collection.",
    icon: BookOpen,
    starter: {},
  },
  VALUES_GRID: { label: "Values", description: "What you stand for, as short points with icons.", icon: Heart, starter: { items: [...DEFAULT_VALUES_GRID_ITEMS] } },
  SMART_RECOMMENDATIONS: {
    label: "Recommended for you",
    description: "Trending and recently viewed products, picked per visitor.",
    icon: Sparkles,
    starter: {},
  },
  PROMO_BANNER: {
    label: "Promo banner",
    description: "A campaign banner — a photograph, or a bold text band.",
    icon: Megaphone,
    starter: { heading: "Your offer headline" },
  },
  RICH_TEXT: {
    label: "Text",
    description: "A heading and a few lines — an announcement, a delivery or sizing note.",
    icon: AlignLeft,
    starter: { heading: "A few words from us" },
  },
  TESTIMONIALS: {
    label: "Customer reviews",
    description: "Your best real reviews, picked automatically from approved ones.",
    icon: MessageSquareQuote,
    starter: { count: 6, minRating: 4 },
    managedElsewhere: { label: "Only approved reviews appear — moderate them in Reviews", href: "/admin/reviews" },
  },
  NEWSLETTER: { label: "Newsletter", description: "An email sign-up for offers and new arrivals.", icon: Mail, starter: {} },
  IMAGE_GALLERY: {
    label: "Lookbook",
    description: "2–8 photographs, each linking to a product or collection.",
    icon: LayoutGrid,
    starter: { layout: "mosaic", items: [] },
  },
};
