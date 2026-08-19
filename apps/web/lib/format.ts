export function formatPrice(value: string | number): string {
  const amount = typeof value === "string" ? Number(value) : value;
  return `৳${amount.toLocaleString("en-BD", { maximumFractionDigits: 2 })}`;
}

/** "1,204" for a plain count, no currency symbol — for KPI tiles (visitors, orders) that would
 * otherwise misleadingly borrow formatPrice's ৳ sign. */
export function formatCount(value: number): string {
  return value.toLocaleString("en-BD");
}

/** "3h ago" / "12m ago" / "just now" — shared by the notification bell and the BI activity feed so
 * an alert's age reads identically wherever it's shown. */
export function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** "John Doe" -> "JD" — first + last initial, for avatar-chip placeholders (orders list/detail,
 * anywhere a customer name needs a compact visual anchor without a real photo). */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase();
}

/** Plain-text fallback for contexts (meta tags, JSON-LD, previews) that can't render the rich-text
 * HTML a product description is actually stored as — strips tags rather than displaying them raw. */
export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/** Percent change vs. a prior-period baseline, for trend indicators. Null when there's no baseline to compare against. */
export function computeTrendPct(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? null : 100;
  return ((current - previous) / previous) * 100;
}

/** Milliseconds -> "2m 15s" / "45s" — for session-duration and time-per-page BI metrics. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

/** "3 hours ago" / "2 days ago" style relative time, for urgency signals like "Last purchased…". */
/** "August 20, 2026" style, for a real admin-set restock date. */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

/** "Aug 20" style — for a delivery-date estimate range, where the year is implied and two of
 * these get shown side by side ("Aug 6 – Aug 7"). */
export function formatDateShort(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Order status → color, one source of truth for every screen that shows an order's status
// (admin orders list/detail, account orders list/detail) — previously the admin orders list
// defined this mapping locally and the two account pages showed status as plain uncolored
// text/badge instead, so the same status read differently depending on which screen you were on.
const ORDER_STATUS_BADGE_CLASS: Record<string, string> = {
  PENDING: "bg-warning-100 text-warning-700",
  CONFIRMED: "bg-info-100 text-info-700",
  PROCESSING: "bg-info-100 text-info-700",
  PACKED: "bg-info-100 text-info-700",
  SHIPPED: "bg-info-100 text-info-700",
  DELIVERED: "bg-success-100 text-success-700",
  PARTIALLY_DELIVERED: "bg-warning-100 text-warning-700",
  CANCELLED: "bg-danger-100 text-danger-700",
  RETURNED: "bg-warning-100 text-warning-700",
  REFUNDED: "bg-ink-200 text-ink-700",
};

export function orderStatusBadgeClass(status: string): string {
  return ORDER_STATUS_BADGE_CLASS[status] ?? "bg-ink-100 text-ink-700";
}

// Plain-language order status labels — was independently defined in order-summary-card.tsx and
// the account order-detail page (identical wording in both), same "one source of truth" reasoning
// as ORDER_STATUS_BADGE_CLASS above.
const ORDER_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending confirmation",
  CONFIRMED: "Confirmed",
  PROCESSING: "Processing",
  PACKED: "Packed",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  PARTIALLY_DELIVERED: "Partially delivered",
  CANCELLED: "Cancelled",
  RETURNED: "Returned",
  REFUNDED: "Refunded",
};

export function orderStatusLabel(status: string): string {
  return ORDER_STATUS_LABELS[status] ?? status;
}

// Short labels for fixed-size status badges (admin orders list) — the full labels above wrap or
// overflow a pill that's meant to stay one fixed size across every status, so the compact badge
// gets its own shorter wording instead. A few keys here (AWAITING_PAYMENT etc.) aren't in the
// current OrderStatus union yet; they're harmless placeholders if that status list grows.
const ORDER_STATUS_SHORT_LABELS: Record<string, string> = {
  PENDING: "Pending",
  CONFIRMED: "Confirmed",
  PROCESSING: "Processing",
  PACKED: "Packed",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  PARTIALLY_DELIVERED: "Partial",
  CANCELLED: "Cancelled",
  RETURNED: "Returned",
  REFUNDED: "Refunded",
  AWAITING_PAYMENT: "Payment",
  PAYMENT_VERIFICATION: "Verify",
  FAILED_DELIVERY: "Failed",
  RETURN_REQUESTED: "Return",
};

export function orderStatusShortLabel(status: string): string {
  return ORDER_STATUS_SHORT_LABELS[status] ?? orderStatusLabel(status);
}

const COURIER_STATUS_BADGE_CLASS: Record<string, string> = {
  delivered: "bg-success-100 text-success-700",
  // Amber, not green — this now maps to the distinct PARTIALLY_DELIVERED order status (see
  // mapSteadfastStatusToOrderStatus in courier.service.ts), which needs an admin to reconcile
  // returned items before it's really "done", unlike a plain delivered.
  partial_delivered: "bg-warning-100 text-warning-700",
  delivered_approval_pending: "bg-success-100 text-success-700",
  partial_delivered_approval_pending: "bg-warning-100 text-warning-700",
  cancelled: "bg-danger-100 text-danger-700",
  cancelled_approval_pending: "bg-danger-100 text-danger-700",
  hold: "bg-warning-100 text-warning-700",
  pending: "bg-warning-100 text-warning-700",
  in_review: "bg-info-100 text-info-700",
  unknown_approval_pending: "bg-info-100 text-info-700",
  unknown: "bg-ink-100 text-ink-700",
};

/** Shared by the orders list and order detail pages so a given Steadfast `delivery_status` always
 * renders with the same color, whichever screen it's shown on. */
export function courierStatusBadgeClass(status: string): string {
  return COURIER_STATUS_BADGE_CLASS[status] ?? "bg-ink-100 text-ink-700";
}

/** Steadfast's own status vocabulary (in_review, *_approval_pending, etc.) is internal jargon —
 * these are the plain-language labels shown in the admin UI instead. */
const COURIER_STATUS_LABELS: Record<string, string> = {
  in_review: "In review",
  pending: "Awaiting pickup",
  hold: "On hold",
  delivered_approval_pending: "Delivered (confirming)",
  partial_delivered_approval_pending: "Partly delivered (confirming)",
  cancelled_approval_pending: "Cancelled (confirming)",
  unknown_approval_pending: "Confirming with courier",
  delivered: "Delivered",
  partial_delivered: "Partly delivered",
  cancelled: "Cancelled / returned",
  unknown: "Unclear",
};

export function courierStatusLabel(status: string): string {
  return COURIER_STATUS_LABELS[status] ?? status.replace(/_/g, " ");
}

/** Longer, plain-language explanation of what a Steadfast delivery_status actually means — shown as
 * a hover title on the status badge so an admin doesn't have to guess what "in_review" or
 * "*_approval_pending" implies for the parcel. */
const COURIER_STATUS_DESCRIPTIONS: Record<string, string> = {
  in_review: "Steadfast has the booking and is reviewing it before assigning a rider.",
  pending: "Booked with Steadfast — waiting for a rider to pick up the parcel.",
  hold: "Steadfast has paused this delivery, often an address or phone issue — check the Steadfast panel or call support.",
  delivered_approval_pending: "The rider marked it delivered; Steadfast confirms this before it's final.",
  partial_delivered_approval_pending: "The rider marked it partly delivered; Steadfast confirms this before it's final.",
  cancelled_approval_pending: "The delivery attempt failed or was cancelled; Steadfast confirms this before it's final.",
  unknown_approval_pending: "Steadfast reported a result it hasn't classified yet — confirmation pending.",
  delivered: "Delivered to the customer and confirmed by Steadfast.",
  partial_delivered: "The customer received part of the order; the rest was returned to you.",
  cancelled: "Delivery failed or was cancelled — the parcel is coming back to you.",
  unknown: "Steadfast hasn't reported a recognized status for this parcel yet.",
};

export function courierStatusDescription(status: string): string {
  return COURIER_STATUS_DESCRIPTIONS[status] ?? "Status reported by Steadfast.";
}

/** Tone thresholds for Steadfast's fraud_check delivery success rate (Customer.deliverySuccessRate)
 * — same red/amber/green vocabulary as courierStatusBadgeClass above, chosen so an admin scanning
 * the orders list gets an instant "safe to book COD" read without doing the math themselves. */
export function deliveryScoreBadgeClass(rate: number | null): string {
  if (rate === null) return "bg-ink-100 text-ink-700";
  if (rate >= 80) return "bg-success-100 text-success-700";
  if (rate >= 50) return "bg-warning-100 text-warning-700";
  return "bg-danger-100 text-danger-700";
}
