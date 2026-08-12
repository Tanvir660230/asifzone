export function formatPrice(value: string | number): string {
  const amount = typeof value === "string" ? Number(value) : value;
  return `৳${amount.toLocaleString("en-BD")}`;
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

const COURIER_STATUS_BADGE_CLASS: Record<string, string> = {
  delivered: "bg-success-100 text-success-700",
  partial_delivered: "bg-success-100 text-success-700",
  cancelled: "bg-danger-100 text-danger-700",
  hold: "bg-warning-100 text-warning-700",
};

/** Shared by the orders list and order detail pages so a given Steadfast `delivery_status` always
 * renders with the same color, whichever screen it's shown on. */
export function courierStatusBadgeClass(status: string): string {
  return COURIER_STATUS_BADGE_CLASS[status] ?? "bg-ink-100 text-ink-700";
}
