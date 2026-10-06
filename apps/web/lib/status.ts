import {
  Ban,
  CheckCircle2,
  Clock,
  Home,
  Loader2,
  PackageCheck,
  PackageX,
  RotateCcw,
  Truck,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import type { OrderStatus, PaymentStatus, ProductStatus } from "@clothing-brand/shared";

/**
 * The status presentation registry (P1.4) — for every status the UI shows, ONE entry: its words, its tone (meaning, not
 * colour), an icon where the status has one, and what it means in plain language. Badges, pills, timelines and tables
 * read from here; lib/format.ts's `orderStatusLabel` & co. are thin views over it, so existing call sites are unchanged.
 *
 * Presentation only: backend enums keep their values (the courier vocabulary is Steadfast's own `delivery_status`).
 */

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger" | "muted";

export interface StatusEntry {
  label: string;
  /** For fixed-width pills where the full label would wrap. */
  short?: string;
  tone: StatusTone;
  icon?: LucideIcon;
  /** What the status means, for hover titles and help text. */
  meaning?: string;
}

const ORDER: Record<OrderStatus, StatusEntry> = {
  PENDING: { label: "Pending confirmation", short: "Pending", tone: "warning", icon: Clock, meaning: "Placed — waiting for the shop to confirm it." },
  CONFIRMED: { label: "Confirmed", tone: "info", icon: CheckCircle2, meaning: "Accepted; not yet being prepared." },
  PROCESSING: { label: "Processing", tone: "info", icon: Loader2, meaning: "Being prepared." },
  PACKED: { label: "Packed", tone: "info", icon: PackageCheck, meaning: "Packed and ready for the courier." },
  SHIPPED: { label: "Shipped", tone: "info", icon: Truck, meaning: "With the courier." },
  DELIVERED: { label: "Delivered", tone: "success", icon: Home, meaning: "Received by the customer." },
  PARTIALLY_DELIVERED: { label: "Partially delivered", short: "Partial", tone: "warning", icon: PackageX, meaning: "Part delivered, part returned — needs reconciling." },
  CANCELLED: { label: "Cancelled", tone: "danger", icon: Ban, meaning: "Cancelled before delivery." },
  RETURNED: { label: "Returned", tone: "warning", icon: Undo2, meaning: "Came back to the shop." },
  REFUNDED: { label: "Refunded", tone: "muted", icon: RotateCcw, meaning: "Money returned to the customer." },
};

/** A projection of the server's payment ledger (docs/PAYMENT_LEDGER.md). */
const PAYMENT: Record<PaymentStatus, StatusEntry> = {
  UNPAID: { label: "Unpaid", tone: "warning" },
  PARTIALLY_PAID: { label: "Part paid", tone: "warning" },
  PAID: { label: "Paid", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
  PARTIALLY_REFUNDED: { label: "Part refunded", tone: "info" },
  REFUNDED: { label: "Refunded", tone: "muted" },
  CREDITED: { label: "Store credit", tone: "info", meaning: "Kept as the customer's store credit (Store Balance)." },
};

/** Steadfast `delivery_status` values in plain language — the courier's own vocabulary is internal jargon. */
const COURIER: Record<string, StatusEntry> = {
  in_review: { label: "In review", tone: "info", meaning: "Steadfast has the booking and is reviewing it before assigning a rider." },
  pending: { label: "Awaiting pickup", tone: "warning", meaning: "Booked with Steadfast — waiting for a rider to pick up the parcel." },
  hold: { label: "On hold", tone: "warning", meaning: "Steadfast has paused this delivery, often an address or phone issue — check the Steadfast panel or call support." },
  delivered_approval_pending: { label: "Delivered (confirming)", tone: "success", meaning: "The rider marked it delivered; Steadfast confirms this before it's final." },
  partial_delivered_approval_pending: { label: "Partly delivered (confirming)", tone: "warning", meaning: "The rider marked it partly delivered; Steadfast confirms this before it's final." },
  cancelled_approval_pending: { label: "Cancelled (confirming)", tone: "danger", meaning: "The delivery attempt failed or was cancelled; Steadfast confirms this before it's final." },
  unknown_approval_pending: { label: "Confirming with courier", tone: "info", meaning: "Steadfast reported a result it hasn't classified yet — confirmation pending." },
  delivered: { label: "Delivered", tone: "success", meaning: "Delivered to the customer and confirmed by Steadfast." },
  // Amber, not green — maps to the distinct PARTIALLY_DELIVERED order status, which needs reconciling before it's done.
  partial_delivered: { label: "Partly delivered", tone: "warning", meaning: "The customer received part of the order; the rest was returned to you." },
  cancelled: { label: "Cancelled / returned", tone: "danger", meaning: "Delivery failed or was cancelled — the parcel is coming back to you." },
  unknown: { label: "Unclear", tone: "neutral", meaning: "Steadfast hasn't reported a recognized status for this parcel yet." },
};

const PRODUCT: Record<ProductStatus, StatusEntry> = {
  DRAFT: { label: "Draft", tone: "neutral", meaning: "Being built — not on the storefront." },
  READY: { label: "Ready", tone: "info", meaning: "Complete and ready to publish." },
  PUBLISHED: { label: "Published", tone: "success", meaning: "Live on the storefront." },
  UNPUBLISHED: { label: "Unpublished", tone: "danger", meaning: "Taken off the storefront." },
};

/** Moderation-style workflows (return requests, reviews). */
const APPROVAL: Record<"PENDING" | "APPROVED" | "REJECTED", StatusEntry> = {
  PENDING: { label: "Pending", tone: "warning" },
  APPROVED: { label: "Approved", tone: "success" },
  REJECTED: { label: "Rejected", tone: "danger" },
};

export const STATUS_REGISTRY = { order: ORDER, payment: PAYMENT, courier: COURIER, product: PRODUCT, approval: APPROVAL } as const;
export type StatusDomain = keyof typeof STATUS_REGISTRY;

/** The entry for a status value — an unknown value (a newer backend, a stale cache) reads as itself, neutrally. */
export function statusOf(domain: StatusDomain, value: string): StatusEntry {
  const table = STATUS_REGISTRY[domain] as Record<string, StatusEntry>;
  return table[value] ?? { label: domain === "courier" ? value.replace(/_/g, " ") : value, tone: "neutral" };
}

/** Pill background + text for a tone (status pills, chips). */
export const TONE_PILL_CLASS: Record<StatusTone, string> = {
  neutral: "bg-ink-100 text-ink-700",
  muted: "bg-ink-200 text-ink-700",
  info: "bg-info-100 text-info-700",
  success: "bg-success-100 text-success-700",
  warning: "bg-warning-100 text-warning-700",
  danger: "bg-danger-100 text-danger-700",
};

/** Text-only colour for a tone (compact inline statuses). */
export const TONE_TEXT_CLASS: Record<StatusTone, string> = {
  neutral: "text-ink-500",
  muted: "text-ink-500",
  info: "text-info-600",
  success: "text-success-600",
  warning: "text-warning-600",
  danger: "text-danger-600",
};

/** The shared Badge variant for a tone (components/ui/badge.tsx). */
export const TONE_BADGE_VARIANT: Record<StatusTone, "neutral" | "info" | "success" | "warning" | "danger"> = {
  neutral: "neutral",
  muted: "neutral",
  info: "info",
  success: "success",
  warning: "warning",
  danger: "danger",
};
