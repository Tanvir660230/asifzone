import {
  Award,
  Banknote,
  CheckCircle,
  Clock,
  Feather,
  Gem,
  Gift,
  Heart,
  Leaf,
  Package,
  RotateCcw,
  Ruler,
  ShieldCheck,
  Sparkles,
  Star,
  Truck,
  Zap,
  type LucideIcon,
} from "lucide-react";

/** String keys are what `HomepageSection.config` stores (JSON can't hold a component reference) —
 * this is the single lookup both the storefront (TrustStrip/ValuesGrid) and the admin builder's
 * icon picker resolve against, so the two stay in sync. */
export const HOMEPAGE_ICON_MAP: Record<string, LucideIcon> = {
  Truck,
  RotateCcw,
  ShieldCheck,
  Banknote,
  Feather,
  Ruler,
  Gem,
  Leaf,
  Star,
  Heart,
  Award,
  CheckCircle,
  Clock,
  Package,
  Zap,
  Gift,
};

export const HOMEPAGE_ICON_NAMES = Object.keys(HOMEPAGE_ICON_MAP);

export function resolveHomepageIcon(name: string): LucideIcon {
  return HOMEPAGE_ICON_MAP[name] ?? Sparkles;
}
