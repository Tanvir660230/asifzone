import { z } from "zod";
import { bdPhoneSchema } from "./schemas/common";

/**
 * Incomplete orders (docs/INCOMPLETE_ORDERS.md). A shopper who typed a valid phone number at checkout or on a landing
 * page and left without ordering is a lead: staff call them in working hours, at most twice, and can turn the lead into
 * an order in one step. Owner decisions 2026-11-22: calls and WhatsApp only (no automatic SMS), no automatic discount,
 * never holds stock, closed after 3 days, deleted after 30.
 */

export const CHECKOUT_LEAD_SOURCES = ["CHECKOUT", "LANDING"] as const;
export type CheckoutLeadSource = (typeof CHECKOUT_LEAD_SOURCES)[number];

export type CheckoutLeadStatus = "OPEN" | "CONVERTED" | "CLOSED";

/** What staff record on a lead. */
export const CHECKOUT_LEAD_ACTIONS = ["NO_ANSWER", "CALL_LATER", "WHATSAPP_SENT", "NOT_INTERESTED", "DO_NOT_CONTACT"] as const;
export type CheckoutLeadAction = (typeof CHECKOUT_LEAD_ACTIONS)[number];

/** How a lead ended. */
export type CheckoutLeadOutcome = "ORDERED_ONLINE" | "ORDERED_BY_STAFF" | "NOT_INTERESTED" | "DO_NOT_CONTACT" | "NO_ANSWER_LIMIT" | "EXPIRED";

export const CHECKOUT_LEAD_OUTCOME_LABELS: Record<CheckoutLeadOutcome, string> = {
  ORDERED_ONLINE: "Ordered online",
  ORDERED_BY_STAFF: "Ordered on the call",
  NOT_INTERESTED: "Not interested",
  DO_NOT_CONTACT: "Asked not to be contacted",
  NO_ANSWER_LIMIT: "No answer after 2 calls",
  EXPIRED: "Not reached in 3 days",
};

/** Why a shopper didn't order — the "Not interested" reasons, for the report. */
export const CHECKOUT_LEAD_REASONS = ["PRICE", "DELIVERY_CHARGE", "JUST_LOOKING", "BOUGHT_ELSEWHERE", "WRONG_SIZE", "TRUST", "OTHER"] as const;
export type CheckoutLeadReason = (typeof CHECKOUT_LEAD_REASONS)[number];
export const CHECKOUT_LEAD_REASON_LABELS: Record<CheckoutLeadReason, string> = {
  PRICE: "Price",
  DELIVERY_CHARGE: "Delivery charge",
  JUST_LOOKING: "Just looking",
  BOUGHT_ELSEWHERE: "Bought elsewhere",
  WRONG_SIZE: "Size / variant",
  TRUST: "Unsure about the shop",
  OTHER: "Other",
};

/** A lead shows up once the shopper has been gone this long. Asif Zone, 30 days to 2026-11-24: 94 % of orders came within
 * 15 minutes of opening checkout (median 2), so a shopper quiet for 15 minutes is very unlikely to order on their own. */
export const CHECKOUT_LEAD_QUIET_MINUTES = 15;
/** Calls stop after this many unanswered tries. */
export const CHECKOUT_LEAD_MAX_TRIES = 2;
/** An open lead nobody reached closes after this long. */
export const CHECKOUT_LEAD_OPEN_DAYS = 3;
/** Every lead (but a do-not-contact phone number) is deleted after this long. */
export const CHECKOUT_LEAD_KEEP_DAYS = 30;
/** Store-local calling hours: [first hour, last hour) — 10:00 to 21:00. */
export const CHECKOUT_LEAD_CALL_HOURS: readonly [number, number] = [10, 21];

const optionalText = (max: number) => z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(max).optional());

/** What the storefront sends while the shopper fills in the form. Everything but the phone is optional. */
export const captureCheckoutLeadSchema = z.object({
  phone: bdPhoneSchema(),
  name: optionalText(200),
  email: optionalText(200),
  shippingDistrict: optionalText(120),
  shippingArea: optionalText(120),
  shippingAddressLine: optionalText(500),
  items: z.array(z.object({ variantId: z.string().min(1).max(64), quantity: z.number().int().min(1).max(99) })).min(1).max(30),
  source: z.enum(CHECKOUT_LEAD_SOURCES),
  landingSlug: optionalText(200),
  sessionId: optionalText(100),
});
export type CaptureCheckoutLeadInput = z.infer<typeof captureCheckoutLeadSchema>;

export const recordCheckoutLeadActionSchema = z
  .object({
    action: z.enum(CHECKOUT_LEAD_ACTIONS),
    reason: z.enum(CHECKOUT_LEAD_REASONS).optional(),
    note: optionalText(500),
    callAt: z.coerce.date().optional(),
  })
  .refine((v) => v.action !== "CALL_LATER" || Boolean(v.callAt), { message: "Pick when to call", path: ["callAt"] })
  .refine((v) => v.action !== "NOT_INTERESTED" || Boolean(v.reason), { message: "Pick why", path: ["reason"] });
export type RecordCheckoutLeadActionInput = z.infer<typeof recordCheckoutLeadActionSchema>;

export interface CheckoutLeadItem {
  variantId: string;
  quantity: number;
  productId: string | null;
  productName: string;
  size: string;
  color: string;
  price: number;
  imageUrl: string | null;
  /** False when the variant is gone or sold out now. */
  available: boolean;
  /** The most that can be sold now (stock for a tracked product, 99 otherwise). */
  maxQuantity: number;
}

export interface CheckoutLeadDto {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  shippingDistrict: string | null;
  shippingArea: string | null;
  shippingAddressLine: string | null;
  /** Name, district, area and address all given — the shopper got as far as the last step. */
  complete: boolean;
  items: CheckoutLeadItem[];
  value: number;
  source: CheckoutLeadSource;
  landingSlug: string | null;
  status: CheckoutLeadStatus;
  outcome: CheckoutLeadOutcome | null;
  reason: CheckoutLeadReason | null;
  attempts: number;
  note: string | null;
  nextCallAt: string;
  lastActivityAt: string;
  createdAt: string;
  closedAt: string | null;
  orderId: string | null;
  /** The courier delivery score of this phone, when one was checked before. */
  deliveryScore: { successRate: number; total: number } | null;
  /** Earlier orders from this phone (any status). */
  earlierOrders: number;
  /** The signed link that puts this cart back on the shopper's phone. */
  resumeUrl: string;
}

export interface CheckoutLeadSummary {
  days: number;
  captured: number;
  ordered: number;
  orderedValue: number;
  orderedByStaff: number;
  notInterested: number;
  unreached: number;
  open: number;
  reasons: Array<{ reason: CheckoutLeadReason; count: number }>;
}

/** The next moment inside calling hours at or after `at` (store time). Pure, for the server and tests. */
export function nextCallingMoment(at: Date, timeZone: string, hours: readonly [number, number] = CHECKOUT_LEAD_CALL_HOURS): Date {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(at)) % 24;
  if (hour >= hours[0] && hour < hours[1]) return at;
  // Wall-clock date of `at` in the store's zone, then that day's (or the next day's) opening hour.
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  const [y, m, d] = parts.split("-").map(Number) as [number, number, number];
  const dayOffset = hour >= hours[1] ? 1 : 0;
  const wallUtc = Date.UTC(y, m - 1, d + dayOffset, hours[0], 0, 0);
  // The zone's offset at that wall time, found by reading it back.
  const back = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(wallUtc))
    .reduce<Record<string, number>>((acc, p) => (p.type === "literal" ? acc : { ...acc, [p.type]: Number(p.value) }), {});
  const offset = Date.UTC(back.year!, back.month! - 1, back.day!, back.hour! % 24, back.minute!) - wallUtc;
  return new Date(wallUtc - offset);
}

/** The prefilled WhatsApp message to a lead (Bangla: it goes to the customer, like the landing pages). */
export function checkoutLeadWhatsAppText(lead: { name: string | null; items: Array<{ productName: string }> }, storeName: string, resumeUrl: string): string {
  const name = lead.name ? ` ${lead.name}` : "";
  const product = lead.items[0]?.productName ?? "পণ্যটি";
  return `আসসালামু আলাইকুম${name}, ${storeName} থেকে বলছি। আপনি ${product} অর্ডার করতে গিয়ে শেষ করেননি — কোনো সমস্যা হয়েছিল? আমরা সাহায্য করতে পারি। চাইলে এখান থেকে এক ক্লিকে অর্ডার শেষ করতে পারবেন: ${resumeUrl}`;
}
