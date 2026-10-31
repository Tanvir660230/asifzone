import { Prisma } from "@prisma/client";
import {
  pickSkipReason,
  type PackingSheet,
  type PickListLine,
  type PickListResponse,
  type PrintedSummary,
  type PrintKind,
  type PrintRunView,
  type ProductLabelVariant,
  type RecordPrintRunInput,
} from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { codToCollectFor } from "../../domain/payments/payment-ledger.service";
import { courierNotesForLabels } from "../courier/courier-note";

/**
 * Warehouse picking, packing and printing (docs/WAREHOUSE_OPERATIONS.md §3). Read-only towards orders, stock and money:
 * a pick list and packing sheets are computed from the order lines as they are now, and a print run records only that a
 * print happened. The physical steps that do change records stay where they are — the handover scan (parcel-scans) and
 * the return receipt / inspection (orders).
 */

const SIZE_ORDER = [
  "XXS",
  "XS",
  "S",
  "M",
  "L",
  "XL",
  "XXL",
  "2XL",
  "3XL",
  "4XL",
  "5XL",
];
const sizeRank = (s: string) => {
  const i = SIZE_ORDER.indexOf(s.trim().toUpperCase());
  if (i >= 0) return i;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? 100 + n : 1000;
};

async function printedSummaries(
  orderIds: string[],
): Promise<Map<string, PrintedSummary>> {
  const rows = orderIds.length
    ? await prisma.printRunItem.groupBy({
        by: ["orderId", "kind"],
        where: { orderId: { in: orderIds } },
        _count: true,
        _max: { createdAt: true },
      })
    : [];
  const out = new Map<string, PrintedSummary>();
  for (const r of rows) {
    if (!r.orderId) continue;
    const s = out.get(r.orderId) ?? { counts: {}, lastPrintedAt: null };
    s.counts[r.kind as PrintKind] = r._count;
    const last = r._max.createdAt?.toISOString() ?? null;
    if (last && (!s.lastPrintedAt || last > s.lastPrintedAt))
      s.lastPrintedAt = last;
    out.set(r.orderId, s);
  }
  return out;
}

/** Groups the selected orders' units by variant (the pick list) and keeps each order's own lines (its packing sheet).
 * Orders the warehouse shouldn't pick — unconfirmed, finished, already handed over, in Trash — are listed as skipped,
 * never silently dropped. */
export async function buildPickList(
  orderIds: string[],
): Promise<PickListResponse> {
  const unique = [...new Set(orderIds)];
  const orders = await prisma.order.findMany({
    where: { id: { in: unique } },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      deletedAt: true,
      handedOverAt: true,
      customerName: true,
      customerPhone: true,
      shippingAddressLine: true,
      shippingArea: true,
      shippingDistrict: true,
      paymentMethod: true,
      courierConsignmentId: true,
      trackingNumber: true,
      courierNote: true,
      courierNoteSent: true,
      createdAt: true,
      items: {
        select: {
          id: true,
          variantId: true,
          productNameSnapshot: true,
          skuSnapshot: true,
          sizeSnapshot: true,
          colorSnapshot: true,
          quantity: true,
          categoryNameSnapshot: true,
        },
        orderBy: { id: "asc" },
      },
    },
  });
  const byId = new Map(orders.map((o) => [o.id, o]));
  const skipped: PickListResponse["skipped"] = [];
  const picked: typeof orders = [];
  for (const id of unique) {
    const o = byId.get(id);
    if (!o) {
      skipped.push({ orderId: id, orderNumber: null, reason: "NOT_FOUND" });
      continue;
    }
    const reason = pickSkipReason(o);
    if (reason)
      skipped.push({ orderId: o.id, orderNumber: o.orderNumber, reason });
    else picked.push(o);
  }

  const variantIds = [
    ...new Set(picked.flatMap((o) => o.items.map((i) => i.variantId))),
  ];
  const [variants, cod, notes, printed] = await Promise.all([
    prisma.productVariant.findMany({
      where: { id: { in: variantIds } },
      select: { id: true, barcode: true, stock: true },
    }),
    codToCollectFor(picked.map((o) => o.id)),
    courierNotesForLabels(picked),
    printedSummaries(picked.map((o) => o.id)),
  ]);
  const variantInfo = new Map(variants.map((v) => [v.id, v]));

  const lines = new Map<string, PickListLine>();
  for (const o of picked) {
    for (const i of o.items) {
      const line = lines.get(i.variantId) ?? {
        variantId: i.variantId,
        productName: i.productNameSnapshot,
        sku: i.skuSnapshot,
        size: i.sizeSnapshot,
        color: i.colorSnapshot,
        barcode: variantInfo.get(i.variantId)?.barcode ?? null,
        categoryName: i.categoryNameSnapshot,
        quantity: 0,
        stockOnHand: variantInfo.get(i.variantId)?.stock ?? null,
        orders: [],
      };
      line.quantity += i.quantity;
      const row = line.orders.find((r) => r.orderId === o.id);
      if (row) row.quantity += i.quantity;
      else
        line.orders.push({
          orderId: o.id,
          orderNumber: o.orderNumber,
          quantity: i.quantity,
        });
      lines.set(i.variantId, line);
    }
  }
  // Shelf order: category, then product, then size (S < M < L…), then colour — the way the stock is laid out.
  const sortedLines = [...lines.values()].sort(
    (a, b) =>
      (a.categoryName ?? "").localeCompare(b.categoryName ?? "") ||
      a.productName.localeCompare(b.productName) ||
      sizeRank(a.size) - sizeRank(b.size) ||
      a.size.localeCompare(b.size) ||
      a.color.localeCompare(b.color),
  );

  const sheets: PackingSheet[] = picked.map((o) => ({
    orderId: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    customerName: o.customerName,
    customerPhone: o.customerPhone,
    address: [o.shippingAddressLine, o.shippingArea].filter(Boolean).join(", "),
    district: o.shippingDistrict || null,
    paymentMethod: o.paymentMethod,
    codAmount: cod.get(o.id) ?? 0,
    courierConsignmentId: o.courierConsignmentId,
    trackingNumber: o.trackingNumber,
    courierNote: notes.get(o.id) ?? null,
    createdAt: o.createdAt.toISOString(),
    totalUnits: o.items.reduce((n, i) => n + i.quantity, 0),
    items: o.items.map((i) => ({
      orderItemId: i.id,
      variantId: i.variantId,
      productName: i.productNameSnapshot,
      sku: i.skuSnapshot,
      size: i.sizeSnapshot,
      color: i.colorSnapshot,
      barcode: variantInfo.get(i.variantId)?.barcode ?? null,
      quantity: i.quantity,
    })),
    printed: printed.get(o.id) ?? { counts: {}, lastPrintedAt: null },
  }));

  return {
    generatedAt: new Date().toISOString(),
    lines: sortedLines,
    sheets,
    skipped,
    totals: {
      orders: sheets.length,
      units: sortedLines.reduce((n, l) => n + l.quantity, 0),
      products: sortedLines.length,
    },
  };
}

function toRunView(
  run: Prisma.PrintRunGetPayload<{ include: { items: true } }>,
): PrintRunView {
  return {
    id: run.id,
    kind: run.kind as PrintKind,
    adminName: run.adminName,
    orderCount: run.orderCount,
    unitCount: run.unitCount,
    copies: run.copies,
    reprint: run.reprint,
    reason: run.reason,
    createdAt: run.createdAt.toISOString(),
    items: run.items.map((i) => ({
      orderId: i.orderId,
      variantId: i.variantId,
      quantity: i.quantity,
      reprint: i.reprint,
    })),
  };
}

/**
 * Records that a print happened. Idempotent on `clientRunId`: the browser retrying after a dropped response gets the run
 * already recorded, never a second one. Whether each order (or product) is a reprint is decided here, against the runs
 * already recorded, inside one serializable transaction — two people printing the same order at once can't both be
 * "first". A reprint of courier labels needs a reason (the label is what the rider scans; two in circulation is a risk).
 */
export async function recordPrintRun(
  adminId: string,
  input: RecordPrintRunInput,
): Promise<{ run: PrintRunView; created: boolean }> {
  const existing = await prisma.printRun.findUnique({
    where: { clientRunId: input.clientRunId },
    include: { items: true },
  });
  if (existing) return { run: toRunView(existing), created: false };

  const admin = await prisma.adminUser.findUnique({
    where: { id: adminId },
    select: { name: true },
  });
  const orderIds = [...new Set(input.orderIds)];
  const variants = [
    ...new Map(input.variants.map((v) => [v.variantId, v])).values(),
  ];

  if (orderIds.length > 0) {
    const found = await prisma.order.count({ where: { id: { in: orderIds } } });
    if (found !== orderIds.length)
      throw AppError.badRequest(
        "Some of these orders don't exist in this store",
      );
  }
  if (variants.length > 0) {
    const found = await prisma.productVariant.count({
      where: { id: { in: variants.map((v) => v.variantId) } },
    });
    if (found !== variants.length)
      throw AppError.badRequest(
        "Some of these products don't exist in this store",
      );
  }

  // Serializable keeps "first print or reprint" exact; a print that loses a serialization race (two prints of the same
  // orders at once — "Print both" sends two) simply runs again, a few times, before giving up.
  for (let attempt = 1; ; attempt++) {
    try {
      const run = await prisma.$transaction(
        async (tx) => {
          const before = await tx.printRunItem.findMany({
            where: {
              kind: input.kind,
              OR: [
                ...(orderIds.length ? [{ orderId: { in: orderIds } }] : []),
                ...(variants.length
                  ? [{ variantId: { in: variants.map((v) => v.variantId) } }]
                  : []),
              ],
            },
            select: { orderId: true, variantId: true },
            distinct: ["orderId", "variantId"],
          });
          const printedOrders = new Set(
            before.map((b) => b.orderId).filter(Boolean),
          );
          const printedVariants = new Set(
            before.map((b) => b.variantId).filter(Boolean),
          );
          const reprint =
            orderIds.some((id) => printedOrders.has(id)) ||
            variants.some((v) => printedVariants.has(v.variantId));
          if (reprint && input.kind === "COURIER_LABEL" && !input.reason) {
            throw AppError.badRequest(
              "Some of these labels were printed before — say why you're reprinting them",
              { code: "REPRINT_REASON_REQUIRED" },
            );
          }
          const units =
            input.kind === "PRODUCT_LABEL"
              ? variants.reduce((n, v) => n + v.quantity, 0)
              : ((
                  await tx.orderItem.aggregate({
                    where: { orderId: { in: orderIds } },
                    _sum: { quantity: true },
                  })
                )._sum.quantity ?? 0);
          return tx.printRun.create({
            data: {
              kind: input.kind,
              clientRunId: input.clientRunId,
              adminId,
              adminName: admin?.name ?? null,
              orderCount: orderIds.length,
              unitCount: units,
              copies: input.copies,
              reprint,
              reason: input.reason ?? null,
              items: {
                create: [
                  ...orderIds.map((orderId) => ({
                    kind: input.kind,
                    orderId,
                    reprint: printedOrders.has(orderId),
                  })),
                  ...variants.map((v) => ({
                    kind: input.kind,
                    variantId: v.variantId,
                    quantity: v.quantity,
                    reprint: printedVariants.has(v.variantId),
                  })),
                ],
              },
            },
            include: { items: true },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return { run: toRunView(run), created: true };
    } catch (err) {
      // The same clientRunId committed by a concurrent retry: answer with that run.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        (err.code === "P2002" || err.code === "P2034")
      ) {
        const raced = await prisma.printRun.findUnique({
          where: { clientRunId: input.clientRunId },
          include: { items: true },
        });
        if (raced) return { run: toRunView(raced), created: false };
        if (err.code === "P2034" && attempt < 4) {
          await new Promise((r) =>
            setTimeout(r, 40 * attempt + Math.random() * 60),
          );
          continue;
        }
        if (err.code === "P2034")
          throw AppError.conflict(
            "Someone printed the same orders at the same moment — try again",
          );
      }
      throw err;
    }
  }
}

export async function listPrintRuns(q: {
  kind?: PrintKind;
  orderId?: string;
  limit: number;
}): Promise<PrintRunView[]> {
  const runs = await prisma.printRun.findMany({
    where: {
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.orderId ? { items: { some: { orderId: q.orderId } } } : {}),
    },
    include: { items: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: q.limit,
  });
  return runs.map(toRunView);
}

/** Variants for product labels: a search (name, SKU, barcode), a category, or an explicit list (from a pick list). */
export async function listProductLabelVariants(q: {
  search?: string;
  categoryId?: string;
  variantIds?: string[];
  limit: number;
}): Promise<ProductLabelVariant[]> {
  const where: Prisma.ProductVariantWhereInput = {
    ...(q.variantIds ? { id: { in: q.variantIds } } : { isActive: true }),
    ...(q.categoryId ? { product: { categoryId: q.categoryId } } : {}),
    ...(q.search
      ? {
          OR: [
            { sku: { contains: q.search, mode: "insensitive" } },
            { barcode: { contains: q.search, mode: "insensitive" } },
            { product: { name: { contains: q.search, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const rows = await prisma.productVariant.findMany({
    where,
    select: {
      id: true,
      sku: true,
      barcode: true,
      size: true,
      color: true,
      price: true,
      product: {
        select: {
          id: true,
          name: true,
          basePrice: true,
          category: { select: { name: true } },
        },
      },
    },
    orderBy: [
      { product: { name: "asc" } },
      { sortOrder: "asc" },
      { sku: "asc" },
    ],
    take: q.limit,
  });
  return rows.map((v) => ({
    variantId: v.id,
    productId: v.product.id,
    productName: v.product.name,
    categoryName: v.product.category?.name ?? null,
    sku: v.sku,
    barcode: v.barcode,
    size: v.size,
    color: v.color,
    price: v.price != null ? Number(v.price) : Number(v.product.basePrice),
    code: v.barcode?.trim() || v.sku,
  }));
}
