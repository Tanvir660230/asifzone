import type { CourierNoteTrigger } from "@prisma/client";
import { prisma } from "../../config/prisma";

/** The parcel note a courier sees, built from the store's courier-note rules (Catalog → Courier notes):
 *  - PRODUCT rules ticked on a product, or on its category or any parent category, of any line in the order;
 *  - DISCOUNT rules, when any line was sold at least `minDiscountPercent` below its "was" price;
 *  - then the customer's own checkout note.
 * Staff can replace it per order (Order.courierNote) until a courier is booked; what was sent is kept in
 * Order.courierNoteSent. Built at booking time, so editing a rule's text reaches every order not yet booked. */

export interface CourierNoteRuleLike {
  id: string;
  text: string;
  trigger: CourierNoteTrigger;
  minDiscountPercent: number | null;
  sortOrder: number;
}

export interface CourierNoteLine {
  /** Rules ticked on the line's product and its category chain. */
  ruleIds: string[];
  /** The "was" price of one unit: the higher of the compare-at price and the regular (pre-flash) price. */
  referenceUnitPrice: number;
  /** What one unit actually cost after flash sale, bundle and coupon discounts. */
  paidUnitPrice: number;
}

const SEPARATOR = " | ";
const CUSTOMER_NOTE_LABEL = "গ্রাহকের নোট: ";

export function lineDiscountPercent(referenceUnitPrice: number, paidUnitPrice: number): number {
  if (referenceUnitPrice <= 0) return 0;
  return Math.max(0, ((referenceUnitPrice - paidUnitPrice) / referenceUnitPrice) * 100);
}

export function composeCourierNote(input: { rules: CourierNoteRuleLike[]; lines: CourierNoteLine[]; customerNote: string | null }): string | null {
  const ticked = new Set(input.lines.flatMap((line) => line.ruleIds));
  // Rounded to cents first so a 40% threshold isn't missed by floating-point noise (1000 → 600.0000001).
  const maxDiscount = Math.max(0, ...input.lines.map((line) => Math.round(lineDiscountPercent(line.referenceUnitPrice, line.paidUnitPrice) * 100) / 100));

  const applies = (rule: CourierNoteRuleLike) =>
    rule.trigger === "DISCOUNT" ? rule.minDiscountPercent != null && maxDiscount >= rule.minDiscountPercent : ticked.has(rule.id);

  const parts = [...input.rules]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .filter(applies)
    .map((rule) => rule.text.trim())
    .filter(Boolean);
  const customerNote = input.customerNote?.trim();
  if (customerNote) parts.push(CUSTOMER_NOTE_LABEL + customerNote);
  return parts.length ? [...new Set(parts)].join(SEPARATOR) : null;
}

type CategoryNode = { parentId: string | null; courierNoteRuleIds: string[] };

/** Rule ids on a category and every category above it (a "Perfume" rule reaches "Perfume → Attar"). */
export function ruleIdsWithAncestors(categoryId: string | null | undefined, categories: Map<string, CategoryNode>): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  let current = categoryId ?? null;
  while (current && !seen.has(current)) {
    seen.add(current);
    const node = categories.get(current);
    if (!node) break;
    ids.push(...node.courierNoteRuleIds);
    current = node.parentId;
  }
  return ids;
}

const num = (value: { toString(): string } | null | undefined) => (value == null ? null : Number(value.toString()));

/** The rule-built note for each order (orderId → note, null when nothing applies). Ignores Order.courierNote. */
export async function buildCourierNotes(orderIds: string[]): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  if (!orderIds.length) return result;

  // Sequential, not Promise.all: this runs inside courier booking, where several bookings at once shouldn't each hold
  // four pool connections.
  const rules = await prisma.courierNoteRule.findMany({
    where: { isActive: true },
    select: { id: true, text: true, trigger: true, minDiscountPercent: true, sortOrder: true },
  });
  if (!rules.length) {
    // No store rules: the note is just the customer's own.
    const rows = await prisma.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, notes: true } });
    for (const row of rows) result.set(row.id, composeCourierNote({ rules, lines: [], customerNote: row.notes }));
    return result;
  }
  const orders = await prisma.order.findMany({
    where: { id: { in: orderIds } },
    select: {
      id: true,
      notes: true,
      items: {
        select: {
          quantity: true,
          priceSnapshot: true,
          listPriceSnapshot: true,
          bundleDiscountAllocated: true,
          couponDiscountAllocated: true,
          variantId: true,
        },
      },
    },
  });
  // OrderItem.variantId has no FK (history outlives the catalog); a variant that's gone just contributes no rules.
  const variantRows = await prisma.productVariant.findMany({
    where: { id: { in: [...new Set(orders.flatMap((o) => o.items.map((i) => i.variantId)))] } },
    select: { id: true, compareAtPrice: true, product: { select: { compareAtPrice: true, categoryId: true, courierNoteRuleIds: true } } },
  });
  const variants = new Map(variantRows.map((v) => [v.id, v]));
  const categoryRows = await prisma.category.findMany({ select: { id: true, parentId: true, courierNoteRuleIds: true } });
  const categories = new Map(categoryRows.map((c) => [c.id, c]));

  for (const order of orders) {
    const lines: CourierNoteLine[] = order.items.map((item) => {
      const variant = variants.get(item.variantId);
      const product = variant?.product;
      const regular = num(item.listPriceSnapshot) ?? num(item.priceSnapshot) ?? 0;
      const compareAt = num(variant?.compareAtPrice) ?? num(product?.compareAtPrice) ?? 0;
      const allocated = (num(item.bundleDiscountAllocated) ?? 0) + (num(item.couponDiscountAllocated) ?? 0);
      return {
        ruleIds: [...(product?.courierNoteRuleIds ?? []), ...ruleIdsWithAncestors(product?.categoryId, categories)],
        referenceUnitPrice: Math.max(regular, compareAt),
        paidUnitPrice: (num(item.priceSnapshot) ?? 0) - (item.quantity > 0 ? allocated / item.quantity : 0),
      };
    });
    result.set(order.id, composeCourierNote({ rules, lines, customerNote: order.notes }));
  }
  return result;
}

/** What the courier is told for an order that isn't booked yet: staff's own wording when they set one, else the rules'. */
export function effectiveCourierNote(override: string | null | undefined, built: string | null | undefined): string | null {
  return override?.trim() || built || null;
}

/** The order page's courier-note panel: the rule-built note, staff's override, and what was sent if already booked. */
export async function getCourierNoteView(orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { courierNote: true, courierNoteSent: true, courierConsignmentId: true } });
  if (!order) return null;
  const built = (await buildCourierNotes([orderId])).get(orderId) ?? null;
  return {
    built,
    override: order.courierNote,
    effective: effectiveCourierNote(order.courierNote, built),
    sent: order.courierNoteSent,
    booked: Boolean(order.courierConsignmentId),
  };
}

/** The note to print on each order's shipping label: what was sent if it's booked, else what would be sent now. */
export async function courierNotesForLabels(
  orders: Array<{ id: string; courierConsignmentId: string | null; courierNote: string | null; courierNoteSent: string | null }>,
): Promise<Map<string, string | null>> {
  const unbooked = orders.filter((o) => !o.courierConsignmentId);
  const built = await buildCourierNotes(unbooked.map((o) => o.id));
  return new Map(orders.map((o) => [o.id, o.courierConsignmentId ? o.courierNoteSent : effectiveCourierNote(o.courierNote, built.get(o.id))]));
}
