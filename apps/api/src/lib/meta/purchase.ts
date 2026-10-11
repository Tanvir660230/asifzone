import { UnrecoverableError } from "bullmq";
import { metaPurchaseEventId } from "@clothing-brand/shared";
import { getCurrency } from "../../domain/config/commerce-settings";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";
import { buildUserData, type MetaRequestContext, type MetaServerEvent } from "./capi";
import { MetaApiError } from "../../providers/errors";
import { logger } from "../observability/logger";
import { getProviders } from "../../providers/registry";

/** Server-side Purchase via the Conversions API — the authoritative copy of every storefront
 * conversion. The browser Pixel fires its own Purchase from the order-confirmation page with the
 * same event_id (metaPurchaseEventId), and Meta keeps one of the pair; this one still lands when the
 * browser copy never does (ad blocker, closed tab, an EPS payment settled by the reconciliation cron).
 *
 * Delivery (Phase 8): the intent is an outbox row written in the order's own transaction (consumer
 * "meta-capi-purchase", domain/outbox/consumers.ts); the event_id is derived from the order number and Meta discards a
 * repeat event_name + event_id within 48 h, so an outbox retry or duplicate delivery collapses to one event.
 * META_CAPI_QUEUE remains only so jobs queued before Phase 8 drain (jobs/meta-capi-worker.ts); nothing enqueues to it. */

export const META_CAPI_QUEUE = "meta-capi";

export interface MetaPurchaseJobData {
  orderId: string;
  context: MetaRequestContext;
}

/** Reads the order back from the database rather than trusting anything handed in — whatever was
 * committed is exactly what Meta gets. null = the order no longer exists (permanently deleted
 * before a retry ran), which there is nothing left to report for. */
export async function buildPurchaseEvent(orderId: string, context: MetaRequestContext): Promise<MetaServerEvent | null> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order) return null;
  // The store currency is the recorded currency of every order amount (locked once orders exist — P6-4).
  const currency = await getCurrency();

  // Variant id is the content id everywhere (AddToCart, InitiateCheckout, both Purchases) — the one
  // identifier that's stable for a specific size/colour and never edited, unlike a SKU.
  const contents = order.items.map((item) => ({
    id: item.variantId,
    quantity: item.quantity,
    item_price: Number(item.priceSnapshot),
  }));

  return {
    event_name: "Purchase",
    event_time: Math.floor(order.createdAt.getTime() / 1000),
    event_id: metaPurchaseEventId(order.orderNumber),
    action_source: "website",
    // The page the browser copy of this event fires from — keeps the pair looking identical to Meta.
    event_source_url: `${env.webOrigin}/order-confirmation/${encodeURIComponent(order.orderNumber)}`,
    user_data: buildUserData(
      {
        email: order.customerEmail,
        phone: order.customerPhone,
        fullName: order.customerName,
        city: order.shippingDistrict,
        state: order.shippingDivision,
        externalId: order.customerId,
      },
      context,
    ),
    custom_data: {
      currency,
      value: Number(order.total),
      order_id: order.orderNumber,
      content_type: "product",
      content_ids: [...new Set(contents.map((c) => c.id))],
      contents,
      num_items: contents.reduce((sum, c) => sum + c.quantity, 0),
    },
  };
}

/** One send attempt. Throws on a retryable failure (so BullMQ backs off and tries again) and an
 * UnrecoverableError on anything no retry will fix. Logs the order number only — never PII. */
export async function processMetaPurchase({ orderId, context }: MetaPurchaseJobData): Promise<void> {
  const event = await buildPurchaseEvent(orderId, context);
  if (!event) {
    logger.warn(`[meta-capi] order ${orderId} no longer exists — Purchase not sent`);
    return;
  }

  const orderNumber = event.custom_data?.order_id;
  try {
    const { eventsReceived } = await getProviders().serverEvents.send(event);
    logger.info(`[meta-capi] Purchase sent for order ${orderNumber} (events_received=${eventsReceived}${env.meta.testEventCode ? ", test event" : ""})`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`[meta-capi] Purchase for order ${orderNumber} failed: ${message}`);
    if (err instanceof MetaApiError && !err.retryable) throw new UnrecoverableError(message);
    throw err;
  }
}
