import { normalizeBdPhone, type AdminOrderListItem } from "@clothing-brand/shared";

/** The one canonical 01XXXXXXXXX form (the shared normaliser), however the number was saved. */
export const phoneKey = (phone: string) => normalizeBdPhone(phone);

export interface PhoneHistory {
  orders: number;
  delivered: number;
  refused: number;
  last: Pick<AdminOrderListItem, "customerName" | "shippingDistrict" | "shippingArea" | "shippingAddressLine" | "createdAt">;
}

/** What this number's past orders say: how many, how many arrived, how many were refused, and the latest address. */
export function summarizePhoneHistory(orders: AdminOrderListItem[], phone: string): PhoneHistory | null {
  const key = phoneKey(phone);
  const mine = orders.filter((o) => !o.deletedAt && phoneKey(o.customerPhone) === key).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!mine.length) return null;
  const last = mine[0]!;
  return {
    orders: mine.length,
    delivered: mine.filter((o) => o.status === "DELIVERED" || o.status === "PARTIALLY_DELIVERED").length,
    refused: mine.filter((o) => o.status === "RETURNED").length,
    last: { customerName: last.customerName, shippingDistrict: last.shippingDistrict, shippingArea: last.shippingArea, shippingAddressLine: last.shippingAddressLine, createdAt: last.createdAt },
  };
}
