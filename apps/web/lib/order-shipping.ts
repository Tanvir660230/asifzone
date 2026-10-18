import type { Order } from "@clothing-brand/shared";

/** The delivery the customer was actually charged. `shippingFee` keeps the zone's fee even when delivery was waived (free
 * delivery, a coupon, free over an amount), so showing it as "Shipping ৳60" above a total without it read as a wrong sum.
 * Orders from before the waiver was recorded (`shippingWaived` null) were charged their fee. */
export function orderShippingCharged(order: Pick<Order, "shippingFee"> & { shippingWaived?: boolean | null }): number {
  return order.shippingWaived ? 0 : Number(order.shippingFee);
}
