import { UnrecoverableError } from "bullmq";
import { metaPurchaseEventId } from "@clothing-brand/shared";
import { getCurrency } from "../../domain/config/commerce-settings";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";
import { normalizeEmail, normalizePhone, sha256, type MetaRequestContext } from "../meta/capi";
import { TikTokApiError } from "../../providers/errors";
import type { TikTokServerEvent } from "../../providers/capabilities";
import { getProviders } from "../../providers/registry";
import { logger } from "../observability/logger";

/** Server-side Purchase via the TikTok Events API — the copy that still lands when the browser pixel's doesn't (ad
 * blocker, iOS, closed tab, a gateway payment settled by the reconciliation cron). Same design as lib/meta/purchase.ts:
 * an outbox intent written in the order's own transaction (consumer "tiktok-events-purchase"), the order read back from
 * the database at send time, and the browser pixel's event id (purchase_<orderNumber>) so TikTok counts the pair once.
 *
 * The request context is the one captured for Meta at checkout (IP, user agent) plus TikTok's own `_ttp` cookie and the
 * `ttclid` click id the storefront keeps from the ad link (apps/web lib/pixels/tiktok.ts). Identifiers are hashed per
 * TikTok's spec: SHA-256 of the trimmed lowercase email and of the E.164 phone. */

export interface TikTokPurchaseJobData {
  orderId: string;
  context: MetaRequestContext;
}

export async function buildTikTokPurchaseEvent(orderId: string, context: MetaRequestContext): Promise<TikTokServerEvent | null> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order) return null;
  const currency = await getCurrency();

  const email = order.customerEmail ? normalizeEmail(order.customerEmail) : null;
  const phone = order.customerPhone ? normalizePhone(order.customerPhone) : null;
  const user: TikTokServerEvent["user"] = {
    ...(email ? { email: sha256(email) } : {}),
    ...(phone ? { phone: sha256(`+${phone}`) } : {}),
    ...(order.customerId ? { external_id: sha256(order.customerId) } : {}),
    ...(context.clientIpAddress ? { ip: context.clientIpAddress } : {}),
    ...(context.clientUserAgent ? { user_agent: context.clientUserAgent } : {}),
    ...(context.ttp ? { ttp: context.ttp } : {}),
    ...(context.ttclid ? { ttclid: context.ttclid } : {}),
  };

  return {
    event: "Purchase",
    event_time: Math.floor(order.createdAt.getTime() / 1000),
    event_id: metaPurchaseEventId(order.orderNumber),
    user,
    page: { url: `${env.webOrigin}/order-confirmation/${encodeURIComponent(order.orderNumber)}` },
    properties: {
      currency,
      value: Number(order.total),
      order_id: order.orderNumber,
      content_type: "product",
      // Variant id, as the browser pixel and the Meta events use — one catalog id per size/colour.
      contents: order.items.map((item) => ({ content_id: item.variantId, quantity: item.quantity, price: Number(item.priceSnapshot) })),
    },
  };
}

/** One send attempt: throws to retry, UnrecoverableError for a permanent rejection. Logs the order number only. */
export async function processTikTokPurchase({ orderId, context }: TikTokPurchaseJobData): Promise<void> {
  const event = await buildTikTokPurchaseEvent(orderId, context);
  if (!event) {
    logger.warn(`[tiktok-events] order ${orderId} no longer exists — Purchase not sent`);
    return;
  }
  const orderNumber = event.properties.order_id;
  try {
    await getProviders().tiktokServerEvents.send(event);
    logger.info(`[tiktok-events] Purchase sent for order ${orderNumber}${env.tiktok.testEventCode ? " (test event)" : ""}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`[tiktok-events] Purchase for order ${orderNumber} failed: ${message}`);
    if (err instanceof TikTokApiError && !err.retryable) throw new UnrecoverableError(message);
    throw err;
  }
}
