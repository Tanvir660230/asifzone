import { Queue, UnrecoverableError } from "bullmq";
import { metaPurchaseEventId } from "@clothing-brand/shared";
import { getCurrency } from "../../domain/config/commerce-settings";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";
import { queueConnection } from "../queue";
import { buildUserData, isMetaCapiEnabled, MetaApiError, sendMetaEvent, type MetaRequestContext, type MetaServerEvent } from "./capi";

/** Server-side Purchase via the Conversions API — the authoritative copy of every storefront
 * conversion. The browser Pixel fires its own Purchase from the order-confirmation page with the
 * same event_id (metaPurchaseEventId), and Meta keeps one of the pair; this one still lands when the
 * browser copy never does (ad blocker, closed tab, an EPS payment settled by the reconciliation cron).
 *
 * Idempotency, without any schema change: the event_id is derived from the order number, the BullMQ
 * jobId is derived from the order id (a second enqueue of a still-pending job is a no-op), and Meta
 * itself discards any repeat of an event_name + event_id it has seen in the last 48h — so a retry,
 * a stalled-job re-run, or the inline fallback below racing a late enqueue all collapse to one. */

export const META_CAPI_QUEUE = "meta-capi";

export interface MetaPurchaseJobData {
  orderId: string;
  context: MetaRequestContext;
}

const ENQUEUE_TIMEOUT_MS = 3000;

let queue: Queue | null = null;
function getQueue(): Queue {
  queue ??= new Queue(META_CAPI_QUEUE, { connection: queueConnection });
  return queue;
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
    console.warn(`[meta-capi] order ${orderId} no longer exists — Purchase not sent`);
    return;
  }

  const orderNumber = event.custom_data?.order_id;
  try {
    const { eventsReceived } = await sendMetaEvent(event);
    console.log(
      `[meta-capi] Purchase sent for order ${orderNumber} (events_received=${eventsReceived}${env.meta.testEventCode ? ", test event" : ""})`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[meta-capi] Purchase for order ${orderNumber} failed: ${message}`);
    if (err instanceof MetaApiError && !err.retryable) throw new UnrecoverableError(message);
    throw err;
  }
}

/** Fire-and-forget from the order-creation path — never awaited, never throws, so Meta (or Redis)
 * being slow or down can't delay or fail a checkout. Queued so a Meta outage gets retried with
 * backoff for ~16 hours (well inside Meta's 7-day event_time window). If Redis itself is
 * unreachable, falls back to a single direct attempt rather than silently dropping the event. */
export function enqueueMetaPurchase(orderId: string, context: MetaRequestContext): void {
  if (!isMetaCapiEnabled()) return;

  const data: MetaPurchaseJobData = { orderId, context };
  const add = getQueue().add("purchase", data, {
    jobId: `purchase-${orderId}`,
    attempts: 8,
    backoff: { type: "exponential", delay: 30_000 },
    // The job payload holds the shopper's IP/user agent — don't let finished jobs linger in Redis.
    removeOnComplete: true,
    removeOnFail: { age: 7 * 24 * 60 * 60 },
  });
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`enqueue timed out after ${ENQUEUE_TIMEOUT_MS}ms`)), ENQUEUE_TIMEOUT_MS).unref(),
  );

  Promise.race([add, timeout]).catch((err: unknown) => {
    console.error(`[meta-capi] could not queue Purchase for order ${orderId} (${err instanceof Error ? err.message : err}) — sending inline`);
    processMetaPurchase(data).catch(() => {
      // already logged inside processMetaPurchase
    });
  });
}
