import { normalizeBdPhone, type Address, type AdminOrderListItem } from "@clothing-brand/shared";

/** The one canonical 01XXXXXXXXX form (the shared normaliser), however the number was saved. */
export const phoneKey = (phone: string) => normalizeBdPhone(phone);

/** One place this customer has had parcels sent to (or saved in their account), ready to drop into the form. */
export interface PastAddress {
  customerName: string;
  shippingDistrict: string;
  shippingArea: string;
  shippingAddressLine: string;
  /** When it was last used (order date) or saved (account address). */
  lastUsed: string;
  /** How many of this number's orders went here; 0 for an account address never ordered to. */
  times: number;
  /** How many of those parcels were delivered here. */
  delivered: number;
}

export interface PhoneHistory {
  orders: number;
  delivered: number;
  refused: number;
  last: Pick<AdminOrderListItem, "customerName" | "shippingDistrict" | "shippingArea" | "shippingAddressLine" | "createdAt">;
  /** Every distinct address, newest first — the first one is the latest order's. */
  addresses: PastAddress[];
}

const MAX_ADDRESSES = 4;

/** Same place even if typed with other spacing, case or punctuation. */
const addressKey = (district: string, area: string, line: string) =>
  [district, area, line].map((s) => (s ?? "").toLowerCase().replace(/[\s,.\-/#]+/g, " ").trim()).join("|");

const isDelivered = (o: AdminOrderListItem) => o.status === "DELIVERED" || o.status === "PARTIALLY_DELIVERED";

/** What this number's past orders say: how many, how many arrived, how many were refused, and every address used. */
export function summarizePhoneHistory(orders: AdminOrderListItem[], phone: string): PhoneHistory | null {
  const key = phoneKey(phone);
  const mine = orders.filter((o) => !o.deletedAt && phoneKey(o.customerPhone) === key).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!mine.length) return null;
  const last = mine[0]!;

  const byPlace = new Map<string, PastAddress>();
  for (const o of mine) {
    const k = addressKey(o.shippingDistrict, o.shippingArea, o.shippingAddressLine);
    const seen = byPlace.get(k);
    if (seen) {
      seen.times += 1;
      if (isDelivered(o)) seen.delivered += 1;
      continue;
    }
    byPlace.set(k, {
      customerName: o.customerName,
      shippingDistrict: o.shippingDistrict,
      shippingArea: o.shippingArea,
      shippingAddressLine: o.shippingAddressLine,
      lastUsed: o.createdAt,
      times: 1,
      delivered: isDelivered(o) ? 1 : 0,
    });
  }

  return {
    orders: mine.length,
    delivered: mine.filter(isDelivered).length,
    refused: mine.filter((o) => o.status === "RETURNED").length,
    last: { customerName: last.customerName, shippingDistrict: last.shippingDistrict, shippingArea: last.shippingArea, shippingAddressLine: last.shippingAddressLine, createdAt: last.createdAt },
    addresses: [...byPlace.values()].slice(0, MAX_ADDRESSES),
  };
}

/**
 * Adds a linked customer's saved account addresses that no order has gone to yet (default first), after the ordered-to
 * ones. With no order history at all, the saved addresses alone make the suggestion list.
 */
export function withSavedAddresses(history: PhoneHistory | null, saved: Address[]): PastAddress[] {
  const list = [...(history?.addresses ?? [])];
  const known = new Set(list.map((a) => addressKey(a.shippingDistrict, a.shippingArea, a.shippingAddressLine)));
  const ordered = [...saved].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || b.createdAt.localeCompare(a.createdAt));
  for (const s of ordered) {
    const k = addressKey(s.district, s.area, s.addressLine);
    if (known.has(k) || !s.district) continue;
    known.add(k);
    list.push({ customerName: s.fullName, shippingDistrict: s.district, shippingArea: s.area, shippingAddressLine: s.addressLine, lastUsed: s.createdAt, times: 0, delivered: 0 });
  }
  return list.slice(0, MAX_ADDRESSES);
}
