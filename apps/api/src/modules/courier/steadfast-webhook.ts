/**
 * Steadfast's webhook body, read defensively (docs/PAYMENT_LEDGER.md §5b). Steadfast's own Laravel package requires
 * consignment_id, invoice, status, cod_amount and updated_at; panel accounts also send `notification_type`
 * (delivery_status | tracking_update | …) with `delivery_charge` and `tracking_message`, and a body without one is a
 * delivery_status push. Statuses are lower-cased as sent; amounts may be numbers or numeric strings, anything else is
 * null (never 0). Nothing here is trusted on its own — see handleSteadfastWebhook.
 */
export interface SteadfastWebhookEvent {
  notificationType: string;
  consignmentId: string | null;
  invoice: string | null;
  status: string | null;
  codAmount: number | null;
  deliveryCharge: number | null;
  trackingMessage: string | null;
}

function amount(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  if (typeof v === "string" && /^\d+(\.\d+)?$/.test(v.trim())) return Number(v.trim());
  return null;
}

function text(v: unknown, max = 500): string | null {
  if (typeof v === "string") return v.trim().slice(0, max) || null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

export function parseSteadfastWebhook(body: unknown): SteadfastWebhookEvent {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const consignment = text(b.consignment_id, 64);
  return {
    notificationType: (text(b.notification_type, 64) ?? "delivery_status").toLowerCase(),
    consignmentId: consignment && /^\d+$/.test(consignment) ? consignment : null,
    invoice: text(b.invoice, 120),
    status: text(b.status, 64)?.toLowerCase() ?? null,
    codAmount: amount(b.cod_amount),
    deliveryCharge: amount(b.delivery_charge),
    trackingMessage: text(b.tracking_message),
  };
}
