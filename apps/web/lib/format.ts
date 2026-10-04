import { DISPLAY_LOCALE, currencySymbol, formatDate as formatZonedDate, formatDateTime, formatMoney, formatTime } from "@clothing-brand/shared";
import { getStoreConfig } from "./store-config";

/** A store amount in the store currency ("৳1,500" for BDT, "$1,500.25" for USD). `currency` overrides it for an amount that
 * carries its own (e.g. a product's server-resolved `pricing.currency` in a server component). */
export function formatPrice(value: string | number, currency?: string): string {
  const amount = typeof value === "string" ? Number(value) : value;
  return formatMoney(amount, currency ?? getStoreConfig().currency);
}

/** The store currency's symbol alone ("৳", "$") — for labels such as "Amount (৳)" and chart axes. */
export function storeCurrencySymbol(): string {
  return currencySymbol(getStoreConfig().currency);
}

/** The store currency code ("BDT") — for labels such as "Base price (BDT)". */
export function storeCurrencyCode(): string {
  return getStoreConfig().currency;
}

/** "1,204" for a plain count, no currency symbol — for KPI tiles (visitors, orders) that would
 * otherwise misleadingly borrow formatPrice's currency sign. */
export function formatCount(value: number): string {
  return value.toLocaleString(DISPLAY_LOCALE);
}

/** An instant's calendar date in the STORE timezone ("30 Sept 2026") — the same business day reports put it in, whatever the
 * viewer's own timezone (Phase 7). */
export function formatStoreDate(iso: string | Date, options?: Intl.DateTimeFormatOptions): string {
  return formatZonedDate(iso, getStoreConfig().timezone, options);
}

/** An instant as store-timezone wall-clock time ("30 Sept 2026, 18:30"). */
export function formatStoreDateTime(iso: string | Date): string {
  return formatDateTime(iso, getStoreConfig().timezone);
}

/** An instant's store-timezone clock time ("18:30"). */
export function formatStoreTime(iso: string | Date): string {
  return formatTime(iso, getStoreConfig().timezone);
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

/** A server business date ("2026-09-30", already in the store timezone — docs/METRICS_REGISTRY.md §1) as "Sep 30".
 * Formatted as a calendar date, never converted through the viewer's timezone (which could shift it a day). */
export function formatBusinessDate(date: string, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m) return date;
  return new Date(Date.UTC(y, m - 1, d || 1)).toLocaleDateString("en-US", { ...options, timeZone: "UTC" });
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
/** Hover text for the delivery-score badge. Checks before 2026-09-27 carry exact counts; newer ones
 * only have Steadfast's ratios and a volume range ("25+"), so word whichever we actually have. */
export function deliveryScoreSummary(score: {
  successRate: number | null;
  totalParcels: number;
  successParcels: number | null;
  cancelledParcels: number | null;
  cancellationRate: number | null;
  volumeRange: string | null;
  fraudReports: number | null;
}): string {
  if (score.successRate === null) return "No delivery history with Steadfast";
  const reports = score.fraudReports ? ` · ${score.fraudReports} fraud report(s)` : "";
  if (score.volumeRange !== null) {
    const cancelled = score.cancellationRate === null ? "" : `, ${score.cancellationRate}% cancelled`;
    return `${score.successRate}% delivered${cancelled} of ${score.volumeRange} parcel(s)${reports}`;
  }
  return `${score.successParcels ?? 0} delivered, ${score.cancelledParcels ?? 0} cancelled of ${score.totalParcels} parcel(s)${reports}`;
}

export function deliveryScoreBadgeClass(rate: number | null): string {
  if (rate === null) return "bg-ink-100 text-ink-700";
  if (rate >= 80) return "bg-success-100 text-success-700";
  if (rate >= 50) return "bg-warning-100 text-warning-700";
  return "bg-danger-100 text-danger-700";
}

// Payment status (a projection of the server's payment ledger, docs/PAYMENT_LEDGER.md) → label and color — one map for
// every screen. Before Phase 4 three inline ternaries showed anything that wasn't PAID/FAILED as "Unpaid", so a refunded
// order read as unpaid.
const PAYMENT_STATUS_LABELS: Record<string, string> = {
  UNPAID: "Unpaid",
  PAID: "Paid",
  FAILED: "Failed",
  PARTIALLY_REFUNDED: "Part refunded",
  REFUNDED: "Refunded",
};

const PAYMENT_STATUS_TEXT_CLASS: Record<string, string> = {
  UNPAID: "text-warning-600",
  PAID: "text-success-600",
  FAILED: "text-danger-600",
  PARTIALLY_REFUNDED: "text-info-600",
  REFUNDED: "text-ink-500",
};

export function paymentStatusLabel(status: string): string {
  return PAYMENT_STATUS_LABELS[status] ?? status;
}

export function paymentStatusTextClass(status: string): string {
  return PAYMENT_STATUS_TEXT_CLASS[status] ?? "text-ink-500";
}
