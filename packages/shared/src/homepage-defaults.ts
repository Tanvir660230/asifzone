/**
 * Default content for the homepage sections that ship with items — the ONE copy, used by the API when it seeds a new
 * store's homepage and by the storefront when a section's config has no items. Category- and brand-neutral on purpose:
 * a new store sees these until it writes its own (Admin → Homepage); nothing here may assume what the store sells.
 */

export const DEFAULT_TRUST_STRIP_ITEMS = [
  { icon: "Truck", label: "Nationwide Delivery" },
  { icon: "RotateCcw", label: "Easy Returns" },
  { icon: "ShieldCheck", label: "Authentic Quality" },
  { icon: "Lock", label: "Secure Checkout" },
] as const satisfies readonly { icon: string; label: string }[];

export const DEFAULT_VALUES_GRID_ITEMS = [
  { icon: "Gem", title: "Carefully Selected", description: "Every product is chosen for quality and checked before it ships." },
  { icon: "ShieldCheck", title: "Authentic", description: "Genuine products from makers and suppliers we stand behind." },
  { icon: "Truck", title: "Reliable Delivery", description: "Packed with care and delivered to your door." },
  { icon: "Headphones", title: "Here to Help", description: "Real people ready to help before and after you order." },
] as const satisfies readonly { icon: string; title: string; description: string }[];
