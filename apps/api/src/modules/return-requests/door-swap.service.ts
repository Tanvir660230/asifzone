/**
 * Door-swap exchange (docs/superpowers/plans/2026-11-28-door-swap-exchange.md): staff start a size / colour / defect
 * exchange from a delivered order. The replacement ships as a linked exchange order (not a sale) that collects the fee
 * plus any price difference — but its parcel is booked with a PROTECTED COD (fee + full new price), and the rider note
 * says: old item handed over → take only the exchange total; no old item → take the full amount or bring the new one back.
 * So a customer who already received and kept the first item can't end up with both for the fee.
 *
 * The original order keeps its status (an exchange never marks it RETURNED). The old unit is recorded as coming back
 * (recordReturnDecision, as for every exchange) and goes into stock only when its parcel is scanned in.
 */
import { Prisma } from "@prisma/client";
import {
  EXCHANGE_OUR_FAULT,
  EXCHANGE_REASON_LABEL,
  EXCHANGE_WINDOW_DAYS,
  add,
  formatMoney,
  formatVariantSuffix,
  fromMajor,
  toMajor,
  zero,
  type CreateDoorSwapInput,
  type Money,
} from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { quoteCart } from "../../domain/pricing/pricing.service";
import { getCurrency } from "../../domain/config/commerce-settings";
import { notifyStockMoved } from "../inventory/inventory.service";
import { createExchangeOrder, priceExchange } from "./return-request.service";

const DAY_MS = 24 * 60 * 60 * 1000;
const EXCHANGEABLE: readonly string[] = ["DELIVERED", "PARTIALLY_DELIVERED"];
/** Swaps still in flight for an item: a second one would ship a third unit for the same old item. */
const OPEN_SWAP = ["AWAITING_SWAP", "SWAPPED"] as const;

export interface DoorSwapResult {
  preview: boolean;
  requestId: string | null;
  exchangeOrder: { id: string; orderNumber: string } | null;
  currency: string;
  /** Delivery fee charged for this exchange (0 when it's our fault). */
  fee: number;
  /** What the customer pays at the door when they hand the old item over: fee + price difference. */
  total: number;
  /** The parcel's COD: fee + the full new price — what keeping both items costs. */
  protectedCod: number;
  /** A cheaper replacement: what the old item was worth beyond the new one (not paid back automatically). */
  owedBack: number;
  original: { productName: string; size: string | null; color: string | null };
  replacement: {
    productName: string;
    size: string | null;
    color: string | null;
    inStock: boolean;
  };
  deliveredAt: string | null;
  daysSinceDelivery: number | null;
  windowDays: number;
  pastWindow: boolean;
}

async function deliveredAtOf(orderId: string): Promise<Date | null> {
  const h = await prisma.orderStatusHistory.findFirst({
    where: { orderId, status: { in: ["DELIVERED", "PARTIALLY_DELIVERED"] } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return h?.createdAt ?? null;
}

/** The store's delivery fee for this order's area (the zone fee, before any free-delivery waiver — it is what the
 * courier costs us for the swap trip). */
async function zoneFeeFor(
  order: {
    shippingDistrict: string;
    shippingDivision: string;
    shippingZoneKey: string | null;
  },
  variantId: string,
): Promise<Money | null> {
  const { quote } = await quoteCart({
    items: [{ variantId, quantity: 1 }],
    promotions: "FLASH_ONLY",
    address: {
      district: order.shippingDistrict || null,
      division: order.shippingDivision || null,
      zoneKey: order.shippingZoneKey,
      unknownUsesDefault: true,
    },
  });
  return quote.shipping.resolved ? quote.shipping.fee : null;
}

export async function createDoorSwap(
  orderId: string,
  input: CreateDoorSwapInput,
  adminId: string,
  idempotencyKey: string | null,
): Promise<DoorSwapResult> {
  if (idempotencyKey && !input.preview) {
    const done = await prisma.returnRequest.findUnique({
      where: { idempotencyKey },
    });
    if (done) return describeExisting(done.id);
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });
  if (!order || order.deletedAt) throw AppError.notFound("Order not found");
  if (!EXCHANGEABLE.includes(order.status))
    throw AppError.badRequest("Only a delivered order can be exchanged");
  const item = order.items.find((i) => i.id === input.orderItemId);
  if (!item) throw AppError.badRequest("That item isn't on this order");
  if (item.variantId === input.requestedVariantId)
    throw AppError.badRequest(
      "Pick a different size or colour than the one the customer has",
    );
  if (!order.customerId)
    throw AppError.badRequest(
      "This order has no customer record — create the exchange as a new order",
    );

  const open = await prisma.returnRequest.findFirst({
    where: {
      orderItemId: item.id,
      swap: true,
      swapStatus: { in: [...OPEN_SWAP] },
    },
    select: { id: true },
  });
  if (open)
    throw new AppError(409, "An exchange for this item is already on its way", {
      code: "EXCHANGE_OPEN",
    });

  const ourFault = EXCHANGE_OUR_FAULT.includes(input.reason);
  const windowDays = ourFault
    ? EXCHANGE_WINDOW_DAYS.ours
    : EXCHANGE_WINDOW_DAYS.customer;
  const deliveredAt = await deliveredAtOf(order.id);
  const days = deliveredAt
    ? Math.floor((Date.now() - deliveredAt.getTime()) / DAY_MS)
    : null;
  const pastWindow = days !== null && days > windowDays;
  const override = (input.overrideReason ?? "").trim();
  if (pastWindow && !input.preview && override.length < 5) {
    throw new AppError(
      409,
      `Delivered ${days} days ago — exchanges are accepted within ${windowDays} days. Give a reason to go ahead.`,
      { code: "EXCHANGE_WINDOW_PASSED", days, windowDays },
    );
  }

  let issue: { id: string } | null = null;
  if (input.issueId) {
    issue = await prisma.orderIssue.findFirst({
      where: { id: input.issueId, orderId: order.id },
      select: { id: true },
    });
    if (!issue)
      throw AppError.badRequest("That reported problem isn't on this order");
  }

  const priced = await priceExchange(prisma, {
    orderId: order.id,
    orderItemId: item.id,
    requestedVariantId: input.requestedVariantId,
  });
  const cur = priced.cur;
  const fee: Money = ourFault
    ? zero(cur)
    : input.fee !== undefined
      ? fromMajor(String(input.fee), cur)
      : ((await zoneFeeFor(order, item.variantId)) ?? zero(cur));
  const total = add(priced.amountDue, fee);
  const protectedCod = add(fee, priced.newValue);
  const base = {
    currency: cur,
    fee: toMajor(fee),
    total: toMajor(total),
    protectedCod: toMajor(protectedCod),
    owedBack: toMajor(priced.refundDue),
    original: {
      productName: item.productNameSnapshot,
      size: item.sizeSnapshot,
      color: item.colorSnapshot,
    },
    replacement: {
      productName: priced.requestedVariant.product.name,
      size: priced.requestedVariant.size,
      color: priced.requestedVariant.color,
      inStock: priced.stockAvailable,
    },
    deliveredAt: deliveredAt?.toISOString() ?? null,
    daysSinceDelivery: days,
    windowDays,
    pastWindow,
  };
  if (input.preview)
    return { preview: true, requestId: null, exchangeOrder: null, ...base };
  if (!priced.stockAvailable) {
    throw AppError.conflict(
      `Not enough stock left for ${priced.requestedVariant.product.name}${formatVariantSuffix(priced.requestedVariant.size, priced.requestedVariant.color)}`,
    );
  }

  const reasonLabel = EXCHANGE_REASON_LABEL[input.reason];
  let moved: Parameters<typeof notifyStockMoved>[0] = [];
  let created: {
    requestId: string;
    exchangeOrder: { id: string; orderNumber: string };
  };
  try {
    created = await prisma.$transaction(async (tx) => {
      const request = await tx.returnRequest.create({
        data: {
          orderId: order.id,
          customerId: order.customerId!,
          type: "EXCHANGE",
          status: "APPROVED",
          reason: reasonLabel,
          note: input.evidenceNote ?? null,
          orderItemId: item.id,
          originalSizeSnapshot: item.sizeSnapshot,
          originalColorSnapshot: item.colorSnapshot,
          requestedVariantId: priced.requestedVariant.id,
          requestedSizeSnapshot: priced.requestedVariant.size,
          requestedColorSnapshot: priced.requestedVariant.color,
          swap: true,
          exchangeReason: input.reason,
          exchangeFee: toMajor(fee),
          protectedCod: toMajor(protectedCod),
          swapStatus: "AWAITING_SWAP",
          evidenceNote: input.evidenceNote ?? null,
          issueId: issue?.id ?? null,
          overrideReason: pastWindow ? override : null,
          idempotencyKey,
          reviewedAt: new Date(),
          reviewedByAdminId: adminId,
        },
      });
      const out = await createExchangeOrder(tx, request, adminId, "NONE", {
        fee,
        reasonLabel,
      });
      moved = out.moved;
      return {
        requestId: request.id,
        exchangeOrder: {
          id: out.exchangeOrder.id,
          orderNumber: out.exchangeOrder.orderNumber,
        },
      };
    });
  } catch (err) {
    // Two clicks with the same key: the unique index let one in — answer with it.
    if (
      idempotencyKey &&
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const done = await prisma.returnRequest.findUnique({
        where: { idempotencyKey },
      });
      if (done) return describeExisting(done.id);
    }
    throw err;
  }
  notifyStockMoved(moved);
  return {
    preview: false,
    requestId: created.requestId,
    exchangeOrder: created.exchangeOrder,
    ...base,
  };
}

async function describeExisting(requestId: string): Promise<DoorSwapResult> {
  const r = await prisma.returnRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: {
      exchangeOrder: {
        select: {
          id: true,
          orderNumber: true,
          total: true,
          items: { select: { productNameSnapshot: true } },
        },
      },
      order: { include: { items: true } },
    },
  });
  const item = r.order.items.find((i) => i.id === r.orderItemId);
  return {
    preview: false,
    requestId: r.id,
    exchangeOrder: r.exchangeOrder
      ? { id: r.exchangeOrder.id, orderNumber: r.exchangeOrder.orderNumber }
      : null,
    currency: await getCurrency(),
    fee: Number(r.exchangeFee ?? 0),
    total: Number(r.exchangeOrder?.total ?? 0),
    protectedCod: Number(r.protectedCod ?? 0),
    owedBack: 0,
    original: {
      productName: item?.productNameSnapshot ?? "",
      size: r.originalSizeSnapshot,
      color: r.originalColorSnapshot,
    },
    replacement: {
      productName: r.exchangeOrder?.items[0]?.productNameSnapshot ?? "",
      size: r.requestedSizeSnapshot,
      color: r.requestedColorSnapshot,
      inStock: true,
    },
    deliveredAt: null,
    daysSinceDelivery: null,
    windowDays: 0,
    pastWindow: Boolean(r.overrideReason),
  };
}

/** The order's exchanges (door swaps and customer requests), newest first — for the order page. */
export async function listOrderExchanges(orderId: string) {
  const rows = await prisma.returnRequest.findMany({
    where: { orderId, type: "EXCHANGE" },
    orderBy: { createdAt: "desc" },
    include: {
      exchangeOrder: {
        select: { id: true, orderNumber: true, status: true, total: true },
      },
      order: {
        select: { items: { select: { id: true, productNameSnapshot: true } } },
      },
    },
  });
  const keptIds = rows
    .map((r) => r.keptOrderId)
    .filter((x): x is string => Boolean(x));
  const kept = new Map(
    (keptIds.length
      ? await prisma.order.findMany({
          where: { id: { in: keptIds } },
          select: { id: true, orderNumber: true, status: true, total: true },
        })
      : []
    ).map((o) => [o.id, o]),
  );
  return rows.map((r) => {
    const keptOrder = r.keptOrderId ? (kept.get(r.keptOrderId) ?? null) : null;
    return {
      id: r.id,
      swap: r.swap,
      reason: r.exchangeReason,
      reasonLabel: r.reason,
      swapStatus: r.swapStatus,
      fee: r.exchangeFee === null ? null : Number(r.exchangeFee),
      total: r.exchangeOrder
        ? Number(r.exchangeOrder.total)
        : keptOrder
          ? Number(keptOrder.total)
          : null,
      protectedCod: r.protectedCod === null ? null : Number(r.protectedCod),
      evidenceNote: r.evidenceNote,
      overrideReason: r.overrideReason,
      swapNote: r.swapNote,
      swapSettledAt: r.swapSettledAt?.toISOString() ?? null,
      exchangeOrder: r.exchangeOrder
        ? {
            id: r.exchangeOrder.id,
            orderNumber: r.exchangeOrder.orderNumber,
            status: r.exchangeOrder.status,
          }
        : keptOrder
          ? {
              id: keptOrder.id,
              orderNumber: keptOrder.orderNumber,
              status: keptOrder.status,
            }
          : null,
      original: {
        productName:
          r.order.items.find((i) => i.id === r.orderItemId)
            ?.productNameSnapshot ?? "",
        size: r.originalSizeSnapshot,
        color: r.originalColorSnapshot,
      },
      requested: {
        size: r.requestedSizeSnapshot,
        color: r.requestedColorSnapshot,
      },
      createdAt: r.createdAt.toISOString(),
    };
  });
}

/** Courier facts of open door swaps, keyed by the REPLACEMENT order id: the COD to book and the Bangla rider note. */
export async function swapCourierFacts(
  orderIds: string[],
): Promise<Map<string, { protectedCod: number; note: string }>> {
  const out = new Map<string, { protectedCod: number; note: string }>();
  if (orderIds.length === 0) return out;
  const rows = await prisma.returnRequest.findMany({
    where: {
      exchangeOrderId: { in: orderIds },
      swap: true,
      swapStatus: "AWAITING_SWAP",
    },
    include: {
      exchangeOrder: { select: { total: true } },
      order: {
        select: { items: { select: { id: true, productNameSnapshot: true } } },
      },
    },
  });
  const currency = await getCurrency();
  for (const r of rows) {
    if (!r.exchangeOrderId || r.protectedCod === null) continue;
    const name =
      r.order.items.find((i) => i.id === r.orderItemId)?.productNameSnapshot ??
      "পণ্য";
    const old = [
      name,
      [r.originalSizeSnapshot, r.originalColorSnapshot]
        .filter(Boolean)
        .join("/"),
    ]
      .filter(Boolean)
      .join(" ");
    out.set(r.exchangeOrderId, {
      protectedCod: Number(r.protectedCod),
      note: swapRiderNote(
        old,
        Number(r.exchangeOrder?.total ?? 0),
        Number(r.protectedCod),
        currency,
      ),
    });
  }
  return out;
}

/** The rider note, Bangla (plan rule 8). Amounts in whole taka. */
export function swapRiderNote(
  oldItem: string,
  total: number,
  protectedCod: number,
  currency: string,
): string {
  const t = (n: number) => formatMoney(n, currency);
  const take = total > 0 ? `শুধু ${t(total)} নিন` : "কোনো টাকা নেবেন না";
  return `এক্সচেঞ্জ: পুরনো ${oldItem} হাতে নিয়ে ${take}। পুরনোটা না দিলে ${t(protectedCod)} নিন, নইলে নতুনটা ফেরত আনুন।`;
}
