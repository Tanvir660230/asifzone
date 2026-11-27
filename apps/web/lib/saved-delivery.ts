/**
 * This browser's last delivery details from a one-step order (landing page or the product page's quick order), offered
 * back next time. localStorage only: nothing is ever looked up by phone number.
 */
export interface SavedDelivery {
  name: string;
  phone: string;
  district: string | null;
  area: string | null;
  addressLine: string;
}

const SAVED_DELIVERY_KEY = "lp:lastDelivery";

export function readSavedDelivery(): SavedDelivery | null {
  try {
    const raw = window.localStorage.getItem(SAVED_DELIVERY_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<SavedDelivery>;
    return v && typeof v.name === "string" && typeof v.phone === "string" && typeof v.addressLine === "string"
      ? { name: v.name, phone: v.phone, district: v.district ?? null, area: v.area ?? null, addressLine: v.addressLine }
      : null;
  } catch {
    return null;
  }
}

export function saveDelivery(v: SavedDelivery) {
  try {
    window.localStorage.setItem(SAVED_DELIVERY_KEY, JSON.stringify(v));
  } catch {
    // storage blocked (private mode, in-app browser): nothing to offer next time
  }
}
