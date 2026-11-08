/**
 * The bell's two lists. "activity" is the routine stream — every new order, every courier status change, every low-stock
 * tick — tens a day on a busy store (~100 a day on a live store, 2026-11). It has its own tab and never counts towards the
 * bell's badge, so what needs a person (the morning brief, parcels needing a look, paid-but-cancelled orders, overpaid
 * orders, finance alerts) is not buried. Every other type is "important" — a new type is important until listed here.
 */
export const ACTIVITY_NOTIFICATION_TYPES = ["order.created", "order.courier_update", "order.courier_booked", "product.low_stock"] as const;

export type NotificationView = "important" | "activity";

export function notificationView(type: string): NotificationView {
  return (ACTIVITY_NOTIFICATION_TYPES as readonly string[]).includes(type) ? "activity" : "important";
}
