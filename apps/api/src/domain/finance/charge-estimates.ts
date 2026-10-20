/**
 * Estimates of what a courier and a payment gateway keep (docs/FINANCE_OWNER_BOOKS.md §3.1, §4) — pure, minor units.
 * An estimate is booked when the parcel is delivered or comes back (or the payment arrives), so each order's profit shows
 * its real delivery cost the same day; the courier's / gateway's payout statement replaces it with the actual figure.
 */

export interface RateCardZone {
  name: string;
  districts: string[];
  areas: string[];
  /** Minor units. */
  charge: number;
}

export interface RateCard {
  id: string;
  /** YYYY-MM-DD */
  effectiveFrom: string;
  zones: RateCardZone[];
  /** Minor units — where no zone matches. */
  defaultCharge: number;
  /** Percent of the cash collected on delivery. */
  codPercent: number;
  /** Percent of the zone fee charged for a parcel that comes back. */
  returnChargePercent: number;
}

export interface FeeRate {
  id: string;
  effectiveFrom: string;
  percent: number;
  /** Minor units. */
  fixed: number;
}

export type ParcelOutcome = "DELIVERED" | "PARTIAL" | "RETURNED";

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** The latest card (or rate) effective on or before `date`; null before the first one. */
export function rateCardFor<T extends { effectiveFrom: string }>(cards: T[], date: string): T | null {
  return [...cards].filter((c) => c.effectiveFrom <= date).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] ?? null;
}

/** The zone of a delivery address: an area match first (a sub-district charged differently), then the district. */
export function zoneOf(card: RateCard, district: string | null | undefined, area: string | null | undefined): { zone: string; charge: number } {
  const d = norm(district);
  const a = norm(area);
  const byArea = a ? card.zones.find((z) => z.areas.some((x) => norm(x) === a)) : undefined;
  const hit = byArea ?? (d ? card.zones.find((z) => z.districts.some((x) => norm(x) === d)) : undefined);
  return hit ? { zone: hit.name, charge: hit.charge } : { zone: "Outside", charge: card.defaultCharge };
}

/** What happened to the parcel, from the courier's status (Steadfast's words) and, without one, the order's status. Null
 * while the parcel is still on its way (nothing is charged yet). */
export function courierOutcome(courierStatus: string | null | undefined, orderStatus: string): ParcelOutcome | null {
  const s = norm(courierStatus);
  if (s.startsWith("partial_delivered")) return "PARTIAL";
  if (s.startsWith("delivered")) return "DELIVERED";
  if (s.startsWith("cancelled")) return "RETURNED";
  if (s && s !== "unknown") return null;
  if (orderStatus === "DELIVERED") return "DELIVERED";
  if (orderStatus === "PARTIALLY_DELIVERED") return "PARTIAL";
  if (orderStatus === "RETURNED") return "RETURNED";
  return null;
}

const pct = (amount: number, percent: number) => Math.round((amount * percent) / 100);

export interface CourierChargeEstimate {
  cardId: string;
  zone: string;
  delivery: number;
  cod: number;
  returnCharge: number;
  total: number;
}

/** A parcel's estimated charge: delivered or partly delivered → the zone fee + COD % of what was collected; returned → the
 * return charge only. Null when no card is in force on the date. */
export function courierChargeEstimate(input: { outcome: ParcelOutcome; collected: number; district: string | null; area: string | null; date: string; cards: RateCard[] }): CourierChargeEstimate | null {
  const card = rateCardFor(input.cards, input.date);
  if (!card) return null;
  const { zone, charge } = zoneOf(card, input.district, input.area);
  if (input.outcome === "RETURNED") {
    const returnCharge = pct(charge, card.returnChargePercent);
    return { cardId: card.id, zone, delivery: 0, cod: 0, returnCharge, total: returnCharge };
  }
  const cod = pct(Math.max(0, input.collected), card.codPercent);
  return { cardId: card.id, zone, delivery: charge, cod, returnCharge: 0, total: charge + cod };
}

/** A gateway payment's estimated fee (percent + fixed); null when no rate is in force on the payment's date. */
export function gatewayFeeEstimate(amount: number, rates: FeeRate[], date: string): { rateId: string; fee: number } | null {
  const rate = rateCardFor(rates, date);
  if (!rate) return null;
  return { rateId: rate.id, fee: pct(amount, rate.percent) + rate.fixed };
}
