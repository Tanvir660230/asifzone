import { DISPLAY_LOCALE, currencySymbol, formatDate as formatZonedDate, formatDateTime, formatMoney, formatTime } from "@clothing-brand/shared";
import { getStoreConfig } from "./store-config";
import { statusOf, TONE_BADGE_VARIANT, TONE_PILL_CLASS, TONE_TEXT_CLASS } from "./status";

/** A store amount in the store currency ("৳1,500" for BDT, "$1,500.25" for USD). `currency` overrides it for an amount that
 * carries its own (e.g. a product's server-resolved `pricing.currency` in a server component). */
/** How a payment provider reads to staff — the order's payments card and Finance › Transactions. */
export const PAYMENT_PROVIDER_LABEL: Record<"SSLCOMMERZ" | "EPS_PG" | "COD" | "MANUAL" | "STORE_CREDIT", string> = {
  SSLCOMMERZ: "SSLCommerz",
  EPS_PG: "EPS",
  COD: "Cash on delivery (courier)",
  MANUAL: "Recorded by staff",
  STORE_CREDIT: "Store balance",
};

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

/** Moderation-style status (return requests, reviews) → shared Badge variant. One mapping for every
 * PENDING / APPROVED / REJECTED workflow — the status registry (lib/status.ts). */
export function approvalStatusBadgeVariant(status: "PENDING" | "APPROVED" | "REJECTED"): "warning" | "success" | "danger" {
  return TONE_BADGE_VARIANT[statusOf("approval", status).tone] as "warning" | "success" | "danger";
}

// Order status words and colour — views over the status registry (lib/status.ts), the one source of truth for every
// screen that shows an order's status (admin orders list/detail, account orders list/detail).
export function orderStatusBadgeClass(status: string): string {
  return TONE_PILL_CLASS[statusOf("order", status).tone];
}

export function orderStatusLabel(status: string): string {
  return statusOf("order", status).label;
}

/** Short label for fixed-size status pills (admin orders list), where the full label would wrap. */
export function orderStatusShortLabel(status: string): string {
  const entry = statusOf("order", status);
  return entry.short ?? entry.label;
}

/** A Steadfast `delivery_status` — colour, plain-language label and explanation — from the status registry
 * (lib/status.ts), so a given courier status reads the same on every screen. */
export function courierStatusBadgeClass(status: string): string {
  return TONE_PILL_CLASS[statusOf("courier", status).tone];
}

export function courierStatusLabel(status: string): string {
  return statusOf("courier", status).label;
}

/** Longer explanation of what a courier status means — the badge's hover title. */
export function courierStatusDescription(status: string): string {
  return statusOf("courier", status).meaning ?? "Status reported by Steadfast.";
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

// Payment status (a projection of the server's payment ledger, docs/PAYMENT_LEDGER.md) → label and colour, from the
// status registry (lib/status.ts). Before Phase 4 three inline ternaries showed anything that wasn't PAID/FAILED as
// "Unpaid", so a refunded order read as unpaid.
export function paymentStatusLabel(status: string): string {
  return statusOf("payment", status).label;
}

export function paymentStatusTextClass(status: string): string {
  return TONE_TEXT_CLASS[statusOf("payment", status).tone];
}
