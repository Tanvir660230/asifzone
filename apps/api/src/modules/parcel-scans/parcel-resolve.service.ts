import { Prisma, type OrderStatus } from "@prisma/client";
import {
  normalizeScanCode,
  scanCodeCandidates,
  scannedPhone,
  steadfastSlipConsignment,
  toBdInternationalDigits,
  type ParcelCandidate,
  type ParcelResolveResult,
  type ParcelScanKind,
  type ScanMatchKind,
} from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";

/**
 * What a scanned code names (docs/ORDER_OPERATIONS.md "Codes the scanner knows"). Resolving never changes anything.
 *
 * Exact matches name ONE parcel: our order number, our label barcode (Order.trackingNumber), the courier consignment id,
 * Steadfast's QR (the tracking link, Order.courierTrackingLink, stored for every booking), Steadfast's own label / return
 * slip barcode (dashed digits ending in the consignment id) and a code an operator linked by hand (ParcelCodeAlias).
 *
 * A product (SKU / variant barcode) or a customer phone can name several parcels: the scanner lists them and the operator
 * picks — never the first, even when there is only one. A code from another store's installation is simply not in this
 * database, so it is unknown here.
 */

type Db = Prisma.TransactionClient | typeof prisma;

/** The order a code names exactly, and how — or null. `select` is the caller's (the batch scanner wants its own fields). */
export async function resolveOrderCode<S extends Prisma.OrderSelect>(
  raw: string,
  select: S,
  db: Db = prisma,
): Promise<{ order: Prisma.OrderGetPayload<{ select: S }>; matchedBy: ScanMatchKind } | null> {
  const code = normalizeScanCode(raw);
  if (!code) return null;
  const slip = steadfastSlipConsignment(code);
  const find = (where: Prisma.OrderWhereInput) =>
    db.order.findFirst({ where, select: select as S, orderBy: { createdAt: "desc" } }) as Promise<Prisma.OrderGetPayload<{ select: S }> | null>;

  // Steadfast's QR is its tracking link — compared whole (the token in it is case-sensitive).
  if (/^https?:\/\//i.test(code)) {
    const byLink = await find({ courierTrackingLink: code });
    if (byLink) return { order: byLink, matchedBy: "STEADFAST_LINK" };
  }
  for (const c of scanCodeCandidates(code)) {
    const upper = c.toUpperCase();
    const order = await find({ OR: [{ orderNumber: upper }, { orderNumber: c }, { trackingNumber: c }, { trackingNumber: upper }, { courierConsignmentId: c }] });
    if (order) {
      const o = order as unknown as { orderNumber?: string; trackingNumber?: string | null; courierConsignmentId?: string | null };
      const matchedBy: ScanMatchKind =
        slip === c && c !== code ? "STEADFAST_SLIP" : o.orderNumber === c || o.orderNumber === upper ? "ORDER_NUMBER" : o.trackingNumber === c || o.trackingNumber === upper ? "TRACKING" : "CONSIGNMENT";
      return { order, matchedBy };
    }
  }
  const alias = await db.parcelCodeAlias.findUnique({ where: { code: code.toUpperCase() }, select: { orderId: true } });
  if (alias) {
    const order = await find({ id: alias.orderId });
    if (order) return { order, matchedBy: "ALIAS" };
  }
  return null;
}

const CANDIDATE_SELECT = {
  id: true,
  orderNumber: true,
  customerName: true,
  shippingArea: true,
  shippingDistrict: true,
  status: true,
  total: true,
  createdAt: true,
  courierConsignmentId: true,
} satisfies Prisma.OrderSelect;

/** Parcels a product or a phone may belong to, for this mode: out for dispatch (booked, not handed over), or out with the
 * courier / on the way back / back but not fully inspected. Newest first, at most 25. */
function modeWhere(mode: ParcelScanKind): Prisma.OrderWhereInput {
  const since = new Date(Date.now() - 120 * 86_400_000);
  if (mode === "DISPATCH") {
    return { deletedAt: null, courierConsignmentId: { not: null }, handedOverAt: null, status: { in: ["CONFIRMED", "PROCESSING", "PACKED", "SHIPPED"] }, createdAt: { gte: since } };
  }
  return {
    deletedAt: null,
    courierConsignmentId: { not: null },
    returnInspectedAt: null,
    status: { in: ["SHIPPED", "CANCELLED", "PARTIALLY_DELIVERED", "RETURNED", "DELIVERED", "REFUNDED"] },
    createdAt: { gte: since },
  };
}

function toCandidate(o: Prisma.OrderGetPayload<{ select: typeof CANDIDATE_SELECT }>): ParcelCandidate {
  return {
    orderId: o.id,
    orderNumber: o.orderNumber,
    customerName: o.customerName,
    area: [o.shippingArea, o.shippingDistrict].filter(Boolean).join(", "),
    status: o.status as OrderStatus,
    total: Number(o.total),
    createdAt: o.createdAt.toISOString(),
    consignmentId: o.courierConsignmentId,
  };
}

/** The scanner page's resolve (POST /api/parcel-scans/resolve). */
export async function resolveParcelCode(raw: string, mode: ParcelScanKind): Promise<ParcelResolveResult> {
  const code = normalizeScanCode(raw);
  const base = { code, candidates: [] as ParcelCandidate[], product: null, orderId: null };
  if (!code) return { ...base, kind: "UNKNOWN", matchedBy: null, message: "Nothing was scanned" };

  const exact = await resolveOrderCode(code, { id: true, orderNumber: true, trackingNumber: true, courierConsignmentId: true });
  if (exact) return { ...base, kind: "ORDER", matchedBy: exact.matchedBy, orderId: exact.order.id, message: exact.order.orderNumber };

  const phone = scannedPhone(code);
  if (phone) {
    const orders = await prisma.order.findMany({
      where: { ...modeWhere(mode), customerPhone: { in: [phone, `+${toBdInternationalDigits(phone)}`, toBdInternationalDigits(phone)] } },
      select: CANDIDATE_SELECT,
      orderBy: { createdAt: "desc" },
      take: 25,
    });
    return {
      ...base,
      kind: orders.length ? "CANDIDATES" : "UNKNOWN",
      matchedBy: "PHONE",
      candidates: orders.map(toCandidate),
      message: orders.length ? `${orders.length} parcel${orders.length === 1 ? "" : "s"} for ${phone} — pick the one in your hand` : `No open parcel for ${phone}`,
    };
  }

  const variant = await prisma.productVariant.findFirst({
    where: { OR: [{ sku: { equals: code, mode: "insensitive" } }, { barcode: code }] },
    select: { id: true, sku: true, size: true, color: true, product: { select: { name: true } } },
  });
  if (variant) {
    const product = { sku: variant.sku, name: variant.product.name, size: variant.size, color: variant.color };
    const orders = await prisma.order.findMany({
      where: { ...modeWhere(mode), items: { some: { variantId: variant.id } } },
      select: CANDIDATE_SELECT,
      orderBy: { createdAt: "desc" },
      take: 25,
    });
    return {
      ...base,
      kind: orders.length ? "CANDIDATES" : "UNKNOWN",
      matchedBy: "PRODUCT",
      product,
      candidates: orders.map(toCandidate),
      message: orders.length
        ? `${product.name} is in ${orders.length} open parcel${orders.length === 1 ? "" : "s"} — pick the one in your hand`
        : `${product.name} (${product.sku}) isn't in any open parcel`,
    };
  }

  return {
    ...base,
    kind: "UNKNOWN",
    matchedBy: null,
    message: `${code} isn't one of this store's parcel or product codes — nothing was changed. It may belong to another store; search the order to link it.`,
  };
}

/** Ties an unknown code to an order (returns.manage), so the next scan of it resolves. One code names one order: linking a
 * code already linked elsewhere, or one that already resolves to a different order, is refused. */
export async function linkParcelCode(raw: string, orderId: string, adminId: string) {
  const code = normalizeScanCode(raw).toUpperCase();
  if (code.length < 3) throw AppError.badRequest("That code is too short to link");
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, orderNumber: true } });
  if (!order) throw AppError.notFound("Order not found");
  const existing = await resolveOrderCode(raw, { id: true, orderNumber: true });
  if (existing) {
    if (existing.order.id === orderId) return { code, orderId, orderNumber: order.orderNumber };
    throw new AppError(409, `That code already opens ${existing.order.orderNumber}`, { code: "CODE_TAKEN" });
  }
  try {
    await prisma.parcelCodeAlias.create({ data: { code, orderId, createdByAdminId: adminId } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new AppError(409, "That code was just linked to another order", { code: "CODE_TAKEN" });
    throw err;
  }
  await prisma.orderStatusHistory.create({
    data: { orderId, status: (await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } })).status, note: `Scanner code ${code} linked to this order`, changedByAdminId: adminId },
  });
  return { code, orderId, orderNumber: order.orderNumber };
}
