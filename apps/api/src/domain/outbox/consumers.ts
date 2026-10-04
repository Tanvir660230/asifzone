/**
 * Outbox consumers (Phase 8, docs/PHASE_8_AUDIT.md) — each performs ONE external side effect for an intent recorded in the
 * business transaction. Delivery is at least once, so every consumer states how a repeat stays safe. Consumers read the
 * order row at send time (contact details, immutable totals — I26) and NEVER write business truth.
 */
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { deliverAdminOrderAlertSms, deliverCustomerOrderSms } from "../../lib/order-sms";
import { deliverPaymentConfirmationEmail } from "../../lib/order-mailer";
import { isMetaCapiEnabled } from "../../lib/meta/capi";
import { processMetaPurchase } from "../../lib/meta/purchase";

export type ConsumerResult = "sent" | "disabled" | "skipped";

export interface OutboxConsumer<P = unknown> {
  /** Versioned business events this consumer accepts; a payload of any other type/version is refused (not retried). */
  eventTypes: readonly string[];
  payload: z.ZodType<P>;
  /** How a repeated delivery of the same event stays safe (documented, and asserted non-empty by the guard). */
  idempotency: string;
  handle(payload: P, event: { id: string; eventKey: string }): Promise<ConsumerResult>;
  /** What to keep of the payload once delivered (drops personal data that is only needed for the send). */
  scrub?: (payload: P) => Record<string, unknown>;
}

const TOUCHPOINTS = ["PLACED", "CONFIRMED", "SHIPPED", "DELIVERED", "CANCELLED"] as const;
const orderIdPayload = z.object({ orderId: z.string().min(1) });

async function orderFacts(orderId: string) {
  return prisma.order.findUnique({
    where: { id: orderId },
    select: { orderNumber: true, total: true, customerName: true, customerPhone: true, customerEmail: true, deletedAt: true },
  });
}

export const OUTBOX_CONSUMERS = {
  "customer-order-sms": {
    eventTypes: ["order.placed.v1", "order.status_changed.v1"],
    payload: orderIdPayload.extend({ touchpoint: z.enum(TOUCHPOINTS) }),
    idempotency:
      "Outbox row claim (skip once PROCESSED; a PROCESSING lease blocks a concurrent duplicate). BulkSMSBD has no idempotency key, so a crash after the provider accepted and before the row is marked processed can resend once the lease expires (at-least-once).",
    async handle({ orderId, touchpoint }) {
      const order = await orderFacts(orderId);
      if (!order || order.deletedAt) return "skipped";
      return deliverCustomerOrderSms(order, touchpoint);
    },
  } satisfies OutboxConsumer<{ orderId: string; touchpoint: (typeof TOUCHPOINTS)[number] }>,

  "admin-order-alert-sms": {
    eventTypes: ["order.placed.v1"],
    payload: orderIdPayload,
    idempotency: "Outbox row claim (as customer-order-sms); retried only when every admin phone failed, so a partial success is never re-sent.",
    async handle({ orderId }) {
      const order = await orderFacts(orderId);
      if (!order || order.deletedAt) return "skipped";
      return deliverAdminOrderAlertSms(order);
    },
  } satisfies OutboxConsumer<{ orderId: string }>,

  "payment-receipt-email": {
    eventTypes: ["payment.settled.v1"],
    payload: orderIdPayload,
    idempotency: "Outbox row claim + Resend idempotencyKey = outbox event id (the provider drops a repeat within 24 h).",
    async handle({ orderId }, event) {
      const order = await orderFacts(orderId);
      if (!order || order.deletedAt) return "skipped";
      return deliverPaymentConfirmationEmail(order, event.id);
    },
  } satisfies OutboxConsumer<{ orderId: string }>,

  "meta-capi-purchase": {
    eventTypes: ["order.placed.v1"],
    payload: orderIdPayload.extend({ context: z.record(z.string(), z.unknown()) }),
    idempotency: "Outbox row claim + Meta event_id purchase_<orderNumber> (Meta keeps one event per id for 48 h).",
    async handle({ orderId, context }) {
      if (!isMetaCapiEnabled()) return "disabled";
      await processMetaPurchase({ orderId, context });
      return "sent";
    },
    // The shopper's IP / user agent / click ids are only needed for the send.
    scrub: ({ orderId }) => ({ orderId }),
  } satisfies OutboxConsumer<{ orderId: string; context: Record<string, unknown> }>,
} as const;

export type OutboxConsumerName = keyof typeof OUTBOX_CONSUMERS;

export function outboxConsumer(name: string): OutboxConsumer | undefined {
  return (OUTBOX_CONSUMERS as Record<string, OutboxConsumer>)[name];
}
