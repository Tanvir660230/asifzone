import { Sparkles, Flame, Star, Gem, Moon, Radar, AlertTriangle, Ban, type LucideIcon } from "lucide-react";
import type { CustomerTag } from "@clothing-brand/shared";

export const TAG_META: Record<CustomerTag, { label: string; icon: LucideIcon; className: string }> = {
  BLOCKED: { label: "Blocked", icon: Ban, className: "bg-danger-100 text-danger-700" },
  COD_RISK: { label: "COD Risk", icon: AlertTriangle, className: "bg-warning-100 text-warning-700" },
  // Auto-detected (fake-looking phone pattern, high cancel/hold rate) — distinct from COD_RISK,
  // which is a manual admin flag. See computeRiskSignals in the API's customer.service.ts.
  SUSPICIOUS: { label: "Suspicious", icon: Radar, className: "bg-danger-50 text-danger-600" },
  VIP: { label: "VIP", icon: Star, className: "bg-ink-900 text-cream-50" },
  HIGH_SPENDER: { label: "High Spender", icon: Gem, className: "bg-info-100 text-info-700" },
  REPEAT: { label: "Repeat Buyer", icon: Flame, className: "bg-success-100 text-success-700" },
  NEW: { label: "New Customer", icon: Sparkles, className: "bg-info-100 text-info-700" },
  INACTIVE: { label: "Inactive", icon: Moon, className: "bg-ink-100 text-ink-500" },
};

/** Priority order for the single badge shown in a compact table row — the drawer shows every tag
 * a customer has, but a row only has room for the one that matters most. */
const TAG_PRIORITY: CustomerTag[] = [
  "BLOCKED",
  "SUSPICIOUS",
  "COD_RISK",
  "VIP",
  "HIGH_SPENDER",
  "REPEAT",
  "NEW",
  "INACTIVE",
];

export function primaryTag(tags: CustomerTag[]): CustomerTag | null {
  for (const tag of TAG_PRIORITY) {
    if (tags.includes(tag)) return tag;
  }
  return null;
}
