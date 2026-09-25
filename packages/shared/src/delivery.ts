/** "Inside Dhaka" means Dhaka district only — not the whole Dhaka division, which also covers
 * Gazipur, Tangail, Faridpur, Kishoreganj etc. that couriers charge (and deliver) at the
 * outside-Dhaka rate. The one place this rule lives: shipping fee, courier return fee and the
 * delivery estimate all go through it. */
export function isInsideDhaka(district: string | null | undefined): boolean {
  return district === "Dhaka";
}

/** Same Dhaka-vs-outside-Dhaka split used for shipping fees — 1–2 business days inside Dhaka,
 * 3–5 outside. Display-only estimate, never stored: the real delivery date depends on real-world
 * logistics, not something we can promise from a formula. */
const DHAKA_DELIVERY_DAYS: [number, number] = [1, 2];
const OUTSIDE_DHAKA_DELIVERY_DAYS: [number, number] = [3, 5];

export interface DeliveryEstimate {
  minDays: number;
  maxDays: number;
  minDate: Date;
  maxDate: Date;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function estimateDelivery(district: string, from: Date = new Date()): DeliveryEstimate {
  const [minDays, maxDays] = isInsideDhaka(district) ? DHAKA_DELIVERY_DAYS : OUTSIDE_DHAKA_DELIVERY_DAYS;
  return { minDays, maxDays, minDate: addDays(from, minDays), maxDate: addDays(from, maxDays) };
}
