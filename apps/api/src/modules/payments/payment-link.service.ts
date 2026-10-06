/**
 * Payment links (docs/ORDER_ADJUSTMENTS.md §11) — a secure, shareable request for the customer to pay what is due on one
 * order, through the existing gateway session flow. A link is a capability, not money:
 *   - generating, sending, opening or starting one never writes a Payment; only a verified gateway settlement does
 *     (payment.service settlePaymentSession → payment ledger), exactly as for checkout and retry-payment
 *   - its amount is the ledger's balance due (or a waiting modification's difference) at generation, never a browser number
 *   - it is tied to the order revision it was priced against: once the order changes, is cancelled or is paid, it can't
 *     be paid any more (the order's change closes it in the same transaction; opening it re-checks too)
 *   - one ACTIVE link per order (partial unique index); regenerating cancels the previous one
 * Sending goes through the outbox (consumer `customer-payment-link`), so the message commits with the link.
 */
import crypto from "crypto";
import { Prisma } from "@prisma/client";
import {
  formatDateTime,
  paymentLinkBlocker,
  type CreatePaymentLinkInput,
  type PaymentLinkChannel,
  type PaymentLinkDto,
  type PublicPaymentLinkView,
} from "@clothing-brand/shared";
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { env } from "../../config/env";
import { AppError } from "../../lib/app-error";
import { hashToken } from "../../lib/token-hash";
import { open, seal } from "../../lib/secret-box";
import { recordOutboxEvents } from "../../domain/outbox/outbox";
import { getCurrency, getTimezone } from "../../domain/config/commerce-settings";
import { getOrderPaymentSummary } from "../../domain/payments/payment-ledger.service";
import { getSettings } from "../settings/settings.service";
import { startPaymentSession } from "./payment.service";

type Tx = Prisma.TransactionClient;
type LinkRow = Prisma.PaymentLinkGetPayload<{ include: { createdByAdmin: { select: { name: true } }; paymentSessions: true } }>;

const urlFor = (token: string) => `${env.webOrigin}/pay/${token}`;

function toDto(link: LinkRow): PaymentLinkDto {
  const token = link.status === "ACTIVE" ? open(link.tokenCiphertext) : null;
  return {
    id: link.id,
    orderId: link.orderId,
    purpose: link.purpose,
    amount: Number(link.amount),
    currency: link.currency,
    status: link.status,
    statusReason: link.statusReason,
    expiresAt: link.expiresAt.toISOString(),
    createdAt: link.createdAt.toISOString(),
    usedAt: link.usedAt?.toISOString() ?? null,
    cancelledAt: link.cancelledAt?.toISOString() ?? null,
    createdBy: link.createdByAdmin?.name ?? null,
    url: token ? urlFor(token) : null,
    attempts: [...link.paymentSessions]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((s) => ({ id: s.id, provider: s.provider, status: s.status, amount: s.amount === null ? null : Number(s.amount), createdAt: s.createdAt.toISOString() })),
  };
}

const linkInclude = { createdByAdmin: { select: { name: true } }, paymentSessions: true } as const;

function sendIntents(linkId: string, orderId: string, channels: PaymentLinkChannel[], nonce: string) {
  return channels.map((channel) => ({
    aggregateType: "Order",
    aggregateId: orderId,
    eventType: "payment_link.send_requested.v1",
    consumer: "customer-payment-link" as const,
    eventKey: `payment-link:${linkId}:${channel}:${nonce}`,
    payload: { paymentLinkId: linkId, channel },
  }));
}

/** Generates (or regenerates) the order's payment link. Amount = the balance due from the payment ledger, or the waiting
 * modification's difference. Returns the shareable URL once; staff can copy it again while the link is ACTIVE. */
export async function createPaymentLink(orderId: string, input: CreatePaymentLinkInput, adminId: string): Promise<PaymentLinkDto> {
  const currency = await getCurrency();
  const token = crypto.randomBytes(32).toString("base64url");
  const link = await prisma.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
    if (!locked) throw AppError.notFound("Order not found");
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });

    let amount: number;
    let modificationId: string | null = null;
    if (input.modificationId) {
      const mod = await tx.orderModification.findUnique({ where: { id: input.modificationId } });
      if (!mod || mod.orderId !== orderId) throw AppError.notFound("Order change not found");
      if (mod.status !== "AWAITING_PAYMENT") throw new AppError(409, "This change is no longer waiting for payment", { code: "PAYMENT_LINK_NOT_ALLOWED" });
      if (mod.baseRevision !== order.revision) throw new AppError(409, "The order changed after this change was priced", { code: "PAYMENT_LINK_NOT_ALLOWED" });
      amount = Number(mod.amountDue);
      modificationId = mod.id;
      if (order.deletedAt || ["CANCELLED", "RETURNED", "REFUNDED"].includes(order.status)) {
        throw new AppError(409, `Can't collect a payment on an order that is ${order.status.toLowerCase()}`, { code: "PAYMENT_LINK_NOT_ALLOWED" });
      }
    } else {
      amount = (await getOrderPaymentSummary(orderId)).amountDue;
      const blocker = paymentLinkBlocker(order, amount);
      if (blocker) throw new AppError(409, blocker, { code: "PAYMENT_LINK_NOT_ALLOWED" });
    }
    if (!(amount > 0)) throw new AppError(409, "Nothing is due on this order", { code: "PAYMENT_LINK_NOT_ALLOWED" });

    // Regenerate: the previous ACTIVE link stops working before the new one exists (one ACTIVE link per order).
    await tx.paymentLink.updateMany({
      where: { orderId, status: "ACTIVE" },
      data: { status: "CANCELLED", statusReason: "Replaced by a new link", cancelledAt: new Date(), cancelledByAdminId: adminId },
    });
    const created = await tx.paymentLink.create({
      data: {
        tokenHash: hashToken(token),
        tokenCiphertext: seal(token),
        orderId,
        purpose: modificationId ? "MODIFICATION" : "ORDER_BALANCE",
        orderModificationId: modificationId,
        amount,
        currency,
        orderRevision: order.revision,
        expiresAt: new Date(Date.now() + input.expiresInHours * 60 * 60 * 1000),
        createdByAdminId: adminId,
      },
    });
    await tx.orderStatusHistory.create({
      data: { orderId, status: order.status, changedByAdminId: adminId, note: `Payment link created for ${currency} ${amount.toFixed(2)} (valid ${input.expiresInHours}h)` },
    });
    if (input.send.length) await recordOutboxEvents(tx as AppTransactionClient, sendIntents(created.id, orderId, input.send, "created"));
    return tx.paymentLink.findUniqueOrThrow({ where: { id: created.id }, include: linkInclude });
  });
  return toDto(link);
}

export async function listPaymentLinks(orderId: string): Promise<PaymentLinkDto[]> {
  const links = await prisma.paymentLink.findMany({ where: { orderId }, include: linkInclude, orderBy: { createdAt: "desc" } });
  return links.map(toDto);
}

async function linkForOrder(tx: Tx, orderId: string, linkId: string) {
  const link = await tx.paymentLink.findUnique({ where: { id: linkId } });
  if (!link || link.orderId !== orderId) throw AppError.notFound("Payment link not found");
  return link;
}

export async function cancelPaymentLink(orderId: string, linkId: string, adminId: string): Promise<PaymentLinkDto> {
  const link = await prisma.$transaction(async (tx) => {
    const link = await linkForOrder(tx, orderId, linkId);
    if (link.status === "ACTIVE") {
      await tx.paymentLink.updateMany({ where: { id: linkId, status: "ACTIVE" }, data: { status: "CANCELLED", statusReason: "Cancelled by staff", cancelledAt: new Date(), cancelledByAdminId: adminId } });
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } });
      await tx.orderStatusHistory.create({ data: { orderId, status: order.status, changedByAdminId: adminId, note: "Payment link cancelled" } });
    }
    return tx.paymentLink.findUniqueOrThrow({ where: { id: linkId }, include: linkInclude });
  });
  return toDto(link);
}

/** Re-sends an ACTIVE link through the chosen channels (outbox; one message per channel per request). */
export async function sendPaymentLink(orderId: string, linkId: string, channels: PaymentLinkChannel[], adminId: string): Promise<PaymentLinkDto> {
  const link = await prisma.$transaction(async (tx) => {
    const link = await linkForOrder(tx, orderId, linkId);
    if (link.status !== "ACTIVE" || link.expiresAt < new Date()) throw new AppError(409, "Only an active link can be sent — generate a new one", { code: "PAYMENT_LINK_INACTIVE" });
    await recordOutboxEvents(tx as AppTransactionClient, sendIntents(linkId, orderId, channels, crypto.randomBytes(6).toString("hex")));
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } });
    await tx.orderStatusHistory.create({ data: { orderId, status: order.status, changedByAdminId: adminId, note: `Payment link sent by ${channels.join(" + ")}` } });
    return tx.paymentLink.findUniqueOrThrow({ where: { id: linkId }, include: linkInclude });
  });
  return toDto(link);
}

/** The link as the public page may use it — or why it can't be paid. Expiry and staleness are re-checked here (lazily marked). */
async function resolvePayable(token: string) {
  const link = await prisma.paymentLink.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { order: { include: { items: true } }, orderModification: true },
  });
  if (!link) throw AppError.notFound("This payment link is not valid");
  const expire = async (status: "EXPIRED" | "CANCELLED", reason: string) => {
    await prisma.paymentLink.updateMany({ where: { id: link.id, status: "ACTIVE" }, data: { status, statusReason: reason, ...(status === "CANCELLED" ? { cancelledAt: new Date() } : {}) } });
    return { link: { ...link, status, statusReason: reason }, payable: false };
  };
  if (link.status !== "ACTIVE") return { link, payable: false };
  if (link.expiresAt < new Date()) return expire("EXPIRED", "Link expired");
  const order = link.order;
  if (order.deletedAt || ["CANCELLED", "RETURNED", "REFUNDED"].includes(order.status)) return expire("CANCELLED", `The order is ${order.status.toLowerCase()}`);
  if (order.revision !== link.orderRevision) return expire("CANCELLED", "The order changed after this link was created");
  if (link.purpose === "MODIFICATION") {
    if (!link.orderModification || link.orderModification.status !== "AWAITING_PAYMENT") return expire("CANCELLED", "The change is no longer waiting for payment");
  } else {
    const due = (await getOrderPaymentSummary(order.id)).amountDue;
    if (due <= 0) return expire("CANCELLED", "Nothing is due on the order any more");
    if (Math.abs(due - Number(link.amount)) > 0.001) return expire("CANCELLED", "The amount due changed after this link was created");
  }
  return { link, payable: true };
}

function enabledProviders(settings: { onlinePaymentEnabled: boolean; epsPaymentEnabled: boolean }): Array<"SSLCOMMERZ" | "EPS_PG"> {
  return [...(settings.onlinePaymentEnabled ? (["SSLCOMMERZ"] as const) : []), ...(settings.epsPaymentEnabled ? (["EPS_PG"] as const) : [])];
}

/** GET /api/pay/:token — order reference, items, amount and expiry; no address, phone, email, payments or internal ids. */
export async function viewPaymentLink(token: string): Promise<PublicPaymentLinkView> {
  const { link, payable } = await resolvePayable(token);
  const settings = await getSettings();
  return {
    status: payable ? "ACTIVE" : link.status,
    orderNumber: link.order.orderNumber,
    customerFirstName: link.order.customerName.split(" ")[0] ?? "",
    currency: link.currency,
    amount: Number(link.amount),
    orderTotal: Number(link.order.total),
    expiresAt: link.expiresAt.toISOString(),
    purpose: link.purpose,
    items: link.order.items.map((i) => ({ name: i.productNameSnapshot, size: i.sizeSnapshot, color: i.colorSnapshot, quantity: i.quantity })),
    providers: payable ? enabledProviders(settings) : [],
  };
}

/** POST /api/pay/:token/start — a gateway session for exactly the link's amount, tied to the link (and its modification). */
export async function startPaymentLink(token: string, provider: "SSLCOMMERZ" | "EPS_PG", ipAddress?: string) {
  const { link, payable } = await resolvePayable(token);
  if (!payable) throw new AppError(409, "This payment link can no longer be used", { code: "PAYMENT_LINK_INACTIVE", status: link.status });
  const settings = await getSettings();
  if (!enabledProviders(settings).includes(provider)) throw AppError.badRequest("This payment method is currently unavailable");
  // A live attempt from this link inside the grace window is reused by startPaymentSession; an older one is retired first.
  const active = await prisma.paymentSession.findFirst({ where: { orderId: link.orderId, status: "ACTIVE" } });
  if (active && Date.now() - active.createdAt.getTime() > 2 * 60 * 1000) {
    await prisma.paymentSession.updateMany({ where: { id: active.id, status: "ACTIVE" }, data: { status: "EXPIRED" } });
  }
  return startPaymentSession(link.order, ipAddress, {
    amount: Number(link.amount),
    provider,
    paymentLinkId: link.id,
    orderModificationId: link.orderModificationId ?? undefined,
  });
}

/** A customer pays a change waiting on their own order (account page) — same as a MODIFICATION link, without a link. */
export async function startModificationPayment(customerId: string, orderId: string, modificationId: string, provider: "SSLCOMMERZ" | "EPS_PG", ipAddress?: string) {
  const mod = await prisma.orderModification.findUnique({ where: { id: modificationId }, include: { order: { include: { items: true } } } });
  if (!mod || mod.orderId !== orderId || mod.order.customerId !== customerId || mod.order.deletedAt) throw AppError.notFound("Order change not found");
  if (mod.status !== "AWAITING_PAYMENT" || mod.baseRevision !== mod.order.revision) throw new AppError(409, "This change is no longer waiting for payment", { code: "MODIFICATION_NOT_PAYABLE" });
  const settings = await getSettings();
  if (!enabledProviders(settings).includes(provider)) throw AppError.badRequest("This payment method is currently unavailable");
  return startPaymentSession(mod.order, ipAddress, { amount: Number(mod.amountDue), provider, orderModificationId: mod.id });
}

/** Cron: ACTIVE links past their expiry. */
export async function expireStalePaymentLinks(now = new Date()): Promise<number> {
  const res = await prisma.paymentLink.updateMany({ where: { status: "ACTIVE", expiresAt: { lt: now } }, data: { status: "EXPIRED", statusReason: "Link expired" } });
  return res.count;
}

/** What the outbox consumer needs to send one link (null when it is no longer ACTIVE — nothing is sent). */
export async function paymentLinkMessageFacts(paymentLinkId: string) {
  const link = await prisma.paymentLink.findUnique({ where: { id: paymentLinkId }, include: { order: true } });
  if (!link || link.status !== "ACTIVE" || link.expiresAt < new Date() || link.order.deletedAt) return null;
  const token = open(link.tokenCiphertext);
  if (!token) return null;
  const [settings, timezone] = await Promise.all([getSettings(), getTimezone()]);
  return {
    phone: link.order.customerPhone,
    email: link.order.customerEmail,
    vars: {
      storeName: settings.storeName,
      customerName: link.order.customerName,
      orderNumber: link.order.orderNumber,
      amount: Number(link.amount),
      currency: link.currency,
      url: urlFor(token),
      expiresAt: formatDateTime(link.expiresAt, timezone),
    },
  };
}
