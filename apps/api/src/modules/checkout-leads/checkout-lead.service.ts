import { Prisma } from "@prisma/client";
import {
  CHECKOUT_LEAD_KEEP_DAYS,
  CHECKOUT_LEAD_MAX_TRIES,
  CHECKOUT_LEAD_OPEN_DAYS,
  CHECKOUT_LEAD_QUIET_MINUTES,
  CHECKOUT_LEAD_REASONS,
  nextCallingMoment,
  normalizeBdPhone,
  type CaptureCheckoutLeadInput,
  type CheckoutLeadDto,
  type CheckoutLeadItem,
  type CheckoutLeadOutcome,
  type CheckoutLeadReason,
  type CheckoutLeadSource,
  type CheckoutLeadStatus,
  type CheckoutLeadSummary,
  type RecordCheckoutLeadActionInput,
} from "@clothing-brand/shared";
import { prisma, type Db } from "../../config/prisma";
import { env } from "../../config/env";
import { AppError } from "../../lib/app-error";
import { getTimezone } from "../../domain/config/commerce-settings";
import { checkoutLeadCode, parseCheckoutLeadCode } from "./checkout-lead-code";

/**
 * Incomplete orders (docs/INCOMPLETE_ORDERS.md). The storefront sends what the shopper has typed once the phone number is
 * valid; one OPEN lead per phone is kept up to date. Staff see it after 30 quiet minutes, inside calling hours, and call
 * at most twice. An order from that phone (online or entered by staff) converts it in the order's own transaction.
 * Nothing here holds stock, sends a message or changes a price.
 */

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
type LeadRow = Prisma.CheckoutLeadGetPayload<object>;
type StoredItem = { variantId: string; quantity: number };

const storeUrl = () => env.webOrigin.replace(/\/$/, "");

async function cartValue(items: StoredItem[]): Promise<number> {
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: items.map((i) => i.variantId) } },
    select: { id: true, price: true, product: { select: { basePrice: true } } },
  });
  const price = new Map(variants.map((v) => [v.id, Number(v.price ?? v.product.basePrice)]));
  return items.reduce((sum, i) => sum + (price.get(i.variantId) ?? 0) * i.quantity, 0);
}

/** Saves what the shopper has typed. Silent by design: the storefront never shows an error for it, and a phone that
 * asked not to be contacted, or one that just ordered, is simply not recorded. */
export async function captureCheckoutLead(input: CaptureCheckoutLeadInput, ctx: { customerId?: string | null } = {}): Promise<{ ok: true }> {
  const phone = normalizeBdPhone(input.phone);
  const now = new Date();
  const [optedOut, justOrdered, blocked] = await Promise.all([
    prisma.checkoutLead.count({ where: { phone, outcome: "DO_NOT_CONTACT" } }),
    prisma.order.count({ where: { customerPhone: phone, createdAt: { gte: new Date(now.getTime() - 10 * MINUTE) } } }),
    prisma.customer.count({ where: { phone, isBlocked: true } }),
  ]);
  if (optedOut || justOrdered || blocked) return { ok: true };

  const items: StoredItem[] = input.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity }));
  const value = await cartValue(items);
  if (value <= 0) return { ok: true }; // nothing real in the cart (unknown variants)
  const timeZone = await getTimezone();
  const nextCallAt = nextCallingMoment(new Date(now.getTime() + CHECKOUT_LEAD_QUIET_MINUTES * MINUTE), timeZone);
  const data = {
    name: input.name ?? null,
    email: input.email ?? null,
    shippingDistrict: input.shippingDistrict ?? null,
    shippingArea: input.shippingArea ?? null,
    shippingAddressLine: input.shippingAddressLine ?? null,
    items: items as unknown as Prisma.InputJsonValue,
    value,
    source: input.source,
    landingSlug: input.landingSlug ?? null,
    sessionId: input.sessionId ?? null,
    lastActivityAt: now,
    nextCallAt,
  };
  // Fields the shopper cleared keep what they typed before (a half-filled form is still worth the call).
  const keep = <T,>(v: T | null) => (v === null ? undefined : v);
  const update = {
    name: keep(data.name),
    email: keep(data.email),
    shippingDistrict: keep(data.shippingDistrict),
    shippingArea: keep(data.shippingArea),
    shippingAddressLine: keep(data.shippingAddressLine),
    items: data.items,
    value,
    source: data.source,
    landingSlug: keep(data.landingSlug),
    sessionId: keep(data.sessionId),
    lastActivityAt: now,
    // Activity pushes the first call back; once someone has called, their own schedule stands.
    ...(ctx.customerId ? { customerId: ctx.customerId } : {}),
  };
  const open = await prisma.checkoutLead.findFirst({ where: { phone, status: "OPEN" }, select: { id: true, attempts: true } });
  if (open) {
    await prisma.checkoutLead.update({ where: { id: open.id }, data: { ...update, ...(open.attempts === 0 ? { nextCallAt } : {}) } });
    return { ok: true };
  }
  try {
    await prisma.checkoutLead.create({ data: { ...data, phone, customerId: ctx.customerId ?? null } });
  } catch (err) {
    // Two captures racing for the same phone: the partial unique index lets one create; the other updates it.
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    await prisma.checkoutLead.updateMany({ where: { phone, status: "OPEN" }, data: update });
  }
  return { ok: true };
}

/** In the order's own transaction (insertOrderRecord): the phone's open lead became this order. */
export async function convertLeadsForOrder(tx: Db, order: { id: string; customerPhone: string }, byStaff: boolean) {
  await tx.checkoutLead.updateMany({
    where: { phone: normalizeBdPhone(order.customerPhone), status: "OPEN" },
    data: { status: "CONVERTED", outcome: byStaff ? "ORDERED_BY_STAFF" : "ORDERED_ONLINE", orderId: order.id, closedAt: new Date() },
  });
}

async function enrichItems(stored: StoredItem[]): Promise<CheckoutLeadItem[]> {
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: stored.map((i) => i.variantId) } },
    select: {
      id: true,
      size: true,
      color: true,
      price: true,
      stock: true,
      isActive: true,
      image: { select: { url: true } },
      product: {
        select: { id: true, name: true, basePrice: true, trackInventory: true, isActive: true, deletedAt: true, markedSoldOut: true, images: { select: { url: true }, take: 1, orderBy: { sortOrder: "asc" } } },
      },
    },
  });
  const byId = new Map(variants.map((v) => [v.id, v]));
  return stored.map((i) => {
    const v = byId.get(i.variantId);
    if (!v) return { variantId: i.variantId, quantity: i.quantity, productId: null, productName: "Removed product", size: "", color: "", price: 0, imageUrl: null, available: false, maxQuantity: 0 };
    const live = v.isActive && v.product.isActive && !v.product.deletedAt && !v.product.markedSoldOut;
    return {
      variantId: v.id,
      quantity: i.quantity,
      productId: v.product.id,
      productName: v.product.name,
      size: v.size,
      color: v.color,
      price: Number(v.price ?? v.product.basePrice),
      imageUrl: v.image?.url ?? v.product.images[0]?.url ?? null,
      available: live && (!v.product.trackInventory || v.stock >= i.quantity),
      maxQuantity: !live ? 0 : v.product.trackInventory ? Math.max(0, v.stock) : 99,
    };
  });
}

async function toDtos(rows: LeadRow[]): Promise<CheckoutLeadDto[]> {
  const phones = [...new Set(rows.map((r) => r.phone))];
  const [customers, orderCounts] = await Promise.all([
    // The courier score of the customer behind this phone's earlier orders (read-only context for the call — never identity).
    prisma.order.findMany({
      where: { customerPhone: { in: phones }, customerId: { not: null }, customer: { deliverySuccessRate: { not: null } } },
      distinct: ["customerPhone"],
      orderBy: { createdAt: "desc" },
      select: { customerPhone: true, customer: { select: { deliverySuccessRate: true, deliveryTotalParcels: true } } },
    }),
    prisma.order.groupBy({ by: ["customerPhone"], where: { customerPhone: { in: phones }, deletedAt: null }, _count: { _all: true } }),
  ]);
  const score = new Map(customers.map((o) => [o.customerPhone, { successRate: o.customer!.deliverySuccessRate!, total: o.customer!.deliveryTotalParcels ?? 0 }]));
  const earlier = new Map(orderCounts.map((o) => [o.customerPhone, o._count._all]));
  return Promise.all(
    rows.map(async (r) => {
      const items = await enrichItems(r.items as unknown as StoredItem[]);
      return {
        id: r.id,
        phone: r.phone,
        name: r.name,
        email: r.email,
        shippingDistrict: r.shippingDistrict,
        shippingArea: r.shippingArea,
        shippingAddressLine: r.shippingAddressLine,
        complete: Boolean(r.name && r.shippingDistrict && r.shippingArea && r.shippingAddressLine),
        items,
        value: Number(r.value),
        source: r.source as CheckoutLeadSource,
        landingSlug: r.landingSlug,
        status: r.status as CheckoutLeadStatus,
        outcome: (r.outcome as CheckoutLeadOutcome | null) ?? null,
        reason: (r.reason as CheckoutLeadReason | null) ?? null,
        attempts: r.attempts,
        note: r.note,
        nextCallAt: r.nextCallAt.toISOString(),
        lastActivityAt: r.lastActivityAt.toISOString(),
        createdAt: r.createdAt.toISOString(),
        closedAt: r.closedAt?.toISOString() ?? null,
        orderId: r.orderId,
        deliveryScore: score.get(r.phone) ?? null,
        earlierOrders: earlier.get(r.phone) ?? 0,
        resumeUrl: `${storeUrl()}/checkout/resume/${checkoutLeadCode(r.id)}`,
      };
    }),
  );
}

/** The open leads staff can work: quiet for 30 minutes, not older than 3 days, and no order from that phone since.
 * Due to call first (a lead captured at night waits for 10:00), then the ones that reached the address step, then value. */
export async function listCheckoutLeads(view: "open" | "closed", now: Date = new Date()): Promise<CheckoutLeadDto[]> {
  if (view === "closed") {
    const rows = await prisma.checkoutLead.findMany({ where: { status: { not: "OPEN" }, outcome: { not: null } }, orderBy: { closedAt: "desc" }, take: 100 });
    return toDtos(rows);
  }
  const rows = await prisma.checkoutLead.findMany({
    where: {
      status: "OPEN",
      lastActivityAt: { lte: new Date(now.getTime() - CHECKOUT_LEAD_QUIET_MINUTES * MINUTE) },
      createdAt: { gte: new Date(now.getTime() - CHECKOUT_LEAD_OPEN_DAYS * DAY) },
    },
    orderBy: [{ nextCallAt: "asc" }],
    take: 300,
  });
  // A phone that ordered since (another device, the phone line, the inbox) needs no call.
  const ordered = rows.length
    ? await prisma.order.findMany({
        where: { customerPhone: { in: rows.map((r) => r.phone) }, createdAt: { gte: new Date(Math.min(...rows.map((r) => r.createdAt.getTime())) - DAY) } },
        select: { customerPhone: true, createdAt: true },
      })
    : [];
  const live = rows.filter((r) => !ordered.some((o) => o.customerPhone === r.phone && o.createdAt.getTime() >= r.createdAt.getTime() - DAY));
  const dtos = await toDtos(live);
  const due = (d: CheckoutLeadDto) => (new Date(d.nextCallAt).getTime() <= now.getTime() ? 0 : 1);
  return dtos.sort((a, b) => due(a) - due(b) || Number(b.complete) - Number(a.complete) || b.value - a.value || a.nextCallAt.localeCompare(b.nextCallAt));
}

export async function getCheckoutLead(id: string): Promise<CheckoutLeadDto> {
  const row = await prisma.checkoutLead.findUnique({ where: { id } });
  if (!row) throw AppError.notFound("This incomplete order no longer exists");
  return (await toDtos([row]))[0]!;
}

/** A call, a WhatsApp message or a decision on an open lead. */
export async function recordCheckoutLeadAction(id: string, input: RecordCheckoutLeadActionInput, adminId: string): Promise<CheckoutLeadDto> {
  const now = new Date();
  const timeZone = await getTimezone();
  await prisma.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<Array<{ status: string; attempts: number; note: string | null }>>`
      SELECT status, attempts, note FROM "CheckoutLead" WHERE id = ${id} FOR UPDATE
    `;
    if (!row) throw AppError.notFound("This incomplete order no longer exists");
    if (row.status !== "OPEN") throw new AppError(409, "This incomplete order is already closed", { code: "LEAD_CLOSED" });
    const stamp = (text: string) => [row.note, `${now.toISOString().slice(0, 10)} ${text}${input.note ? `: ${input.note}` : ""}`].filter(Boolean).join("\n").slice(-2000);
    const close = (outcome: CheckoutLeadOutcome, extra: Prisma.CheckoutLeadUpdateInput = {}) =>
      tx.checkoutLead.update({ where: { id }, data: { status: "CLOSED", outcome, closedAt: now, closedById: adminId, ...extra } });

    switch (input.action) {
      case "NO_ANSWER": {
        const attempts = row.attempts + 1;
        if (attempts >= CHECKOUT_LEAD_MAX_TRIES) await close("NO_ANSWER_LIMIT", { attempts, note: stamp("No answer") });
        else {
          // The last try is the next day, at the start of calling hours.
          const tomorrow = nextCallingMoment(new Date(now.getTime() + 13 * 60 * MINUTE), timeZone);
          await tx.checkoutLead.update({ where: { id }, data: { attempts, nextCallAt: tomorrow, note: stamp("No answer") } });
        }
        return;
      }
      case "CALL_LATER":
        await tx.checkoutLead.update({ where: { id }, data: { nextCallAt: nextCallingMoment(input.callAt!, timeZone), note: stamp("Call later") } });
        return;
      case "WHATSAPP_SENT":
        await tx.checkoutLead.update({ where: { id }, data: { note: stamp("WhatsApp sent") } });
        return;
      case "NOT_INTERESTED":
        await close("NOT_INTERESTED", { reason: input.reason && (CHECKOUT_LEAD_REASONS as readonly string[]).includes(input.reason) ? input.reason : "OTHER", note: stamp("Not interested") });
        return;
      case "DO_NOT_CONTACT":
        await close("DO_NOT_CONTACT", { note: stamp("Asked not to be contacted") });
        return;
    }
  });
  return getCheckoutLead(id);
}

/** Staff entered the order from this lead (admin new-order with `checkoutLeadId`). Runs after the order exists; the
 * order's own transaction has normally converted it already (same phone) — this covers a corrected phone number. */
export async function markLeadOrderedByStaff(leadId: string, orderId: string, adminId: string) {
  await prisma.checkoutLead.updateMany({
    where: { id: leadId, status: "OPEN" },
    data: { status: "CONVERTED", outcome: "ORDERED_BY_STAFF", orderId, closedAt: new Date(), closedById: adminId },
  });
}

/** The cart and details behind a resume link, for the storefront to put back. Null when the link is wrong or the lead
 * is gone (deleted after 30 days, or asked not to be contacted). */
export async function resumeCheckoutLead(code: string) {
  const id = parseCheckoutLeadCode(code);
  if (!id) return null;
  const row = await prisma.checkoutLead.findUnique({ where: { id } });
  if (!row || row.outcome === "DO_NOT_CONTACT") return null;
  const items = (await enrichItems(row.items as unknown as StoredItem[])).filter((i) => i.available && i.productId);
  const slugs = await prisma.product.findMany({ where: { id: { in: items.map((i) => i.productId!) } }, select: { id: true, slug: true } });
  const slug = new Map(slugs.map((p) => [p.id, p.slug]));
  const variants = await prisma.productVariant.findMany({ where: { id: { in: items.map((i) => i.variantId) } }, select: { id: true, sku: true } });
  const vById = new Map(variants.map((v) => [v.id, v]));
  return {
    name: row.name,
    phone: row.phone,
    email: row.email,
    shippingDistrict: row.shippingDistrict,
    shippingArea: row.shippingArea,
    shippingAddressLine: row.shippingAddressLine,
    items: items.map((i) => ({
      variantId: i.variantId,
      productId: i.productId!,
      productSlug: slug.get(i.productId!) ?? "",
      productName: i.productName,
      sku: vById.get(i.variantId)?.sku ?? "",
      size: i.size,
      color: i.color,
      price: i.price,
      imageUrl: i.imageUrl,
      quantity: i.quantity,
      maxStock: i.maxQuantity,
    })),
  };
}

/** The last `days`: how many leads came in and how they ended. */
export async function checkoutLeadSummary(days = 30, now: Date = new Date()): Promise<CheckoutLeadSummary> {
  const since = new Date(now.getTime() - days * DAY);
  const rows = await prisma.checkoutLead.findMany({
    where: { createdAt: { gte: since } },
    select: { status: true, outcome: true, reason: true, orderId: true },
  });
  const orderIds = rows.map((r) => r.orderId).filter((id): id is string => Boolean(id));
  const orders = orderIds.length ? await prisma.order.findMany({ where: { id: { in: orderIds } }, select: { total: true } }) : [];
  const reasons = new Map<CheckoutLeadReason, number>();
  for (const r of rows) if (r.reason) reasons.set(r.reason as CheckoutLeadReason, (reasons.get(r.reason as CheckoutLeadReason) ?? 0) + 1);
  const count = (o: CheckoutLeadOutcome) => rows.filter((r) => r.outcome === o).length;
  return {
    days,
    captured: rows.length,
    ordered: count("ORDERED_ONLINE") + count("ORDERED_BY_STAFF"),
    orderedValue: orders.reduce((s, o) => s + Number(o.total), 0),
    orderedByStaff: count("ORDERED_BY_STAFF"),
    notInterested: count("NOT_INTERESTED"),
    unreached: count("NO_ANSWER_LIMIT") + count("EXPIRED"),
    open: rows.filter((r) => r.status === "OPEN").length,
    reasons: [...reasons.entries()].map(([reason, n]) => ({ reason, count: n })).sort((a, b) => b.count - a.count),
  };
}

/** Daily: open leads older than 3 days close as EXPIRED; leads older than 30 days are deleted — a do-not-contact one is
 * kept with only its phone number, so that number is never called again. */
export async function sweepCheckoutLeads(now: Date = new Date()) {
  const expired = await prisma.checkoutLead.updateMany({
    where: { status: "OPEN", createdAt: { lt: new Date(now.getTime() - CHECKOUT_LEAD_OPEN_DAYS * DAY) } },
    data: { status: "CLOSED", outcome: "EXPIRED", closedAt: now },
  });
  const cutoff = new Date(now.getTime() - CHECKOUT_LEAD_KEEP_DAYS * DAY);
  const deleted = await prisma.checkoutLead.deleteMany({ where: { createdAt: { lt: cutoff }, NOT: { outcome: "DO_NOT_CONTACT" } } });
  await prisma.checkoutLead.updateMany({
    where: { createdAt: { lt: cutoff }, outcome: "DO_NOT_CONTACT", name: { not: null } },
    data: { name: null, email: null, shippingDistrict: null, shippingArea: null, shippingAddressLine: null, items: [], note: null, sessionId: null },
  });
  return { expired: expired.count, deleted: deleted.count };
}
