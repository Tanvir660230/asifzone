import { env } from "../config/env";
import { AppError } from "./app-error";

interface CreateConsignmentInput {
  invoice: string;
  recipientName: string;
  recipientPhone: string;
  recipientAddress: string;
  codAmount: number;
  note?: string;
}

interface SteadfastConsignment {
  consignment_id: number;
  invoice: string;
  tracking_code: string;
  status: string;
}

interface SteadfastEnvelope<T> {
  status: number;
  message?: string;
  consignment?: T;
  delivery_status?: string;
}

function authHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Api-Key": env.steadfast.apiKey,
    "Secret-Key": env.steadfast.secretKey,
  };
}

// Unlike lib/sms.ts (which no-ops silently when unconfigured, since a missed SMS is low-stakes),
// booking a courier is a real-world action — silently faking success here would leave an admin
// believing a shipment exists when it doesn't. Fail loudly instead.
function requireConfigured() {
  if (!env.steadfast.apiKey || !env.steadfast.secretKey) {
    throw AppError.badRequest("Steadfast is not configured — set STEADFAST_API_KEY/STEADFAST_SECRET_KEY");
  }
}

export async function createSteadfastConsignment(input: CreateConsignmentInput): Promise<SteadfastConsignment> {
  requireConfigured();

  const res = await fetch(`${env.steadfast.baseUrl}/create_order`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      invoice: input.invoice,
      recipient_name: input.recipientName,
      recipient_phone: input.recipientPhone,
      recipient_address: input.recipientAddress,
      cod_amount: input.codAmount,
      note: input.note,
    }),
  });

  const data = (await res.json().catch(() => null)) as SteadfastEnvelope<SteadfastConsignment> | null;

  // Steadfast responds HTTP 200 with an in-body status even on some validation errors — the
  // in-body status is the real signal, same "don't trust the transport code alone" pattern as
  // lib/sms.ts's BulkSMSBD handling.
  if (!res.ok || !data || data.status !== 200 || !data.consignment) {
    throw AppError.badRequest(
      `Steadfast booking failed: ${data?.message ?? res.status}`,
      data ?? undefined,
    );
  }

  return data.consignment;
}

export async function getSteadfastStatusByConsignmentId(consignmentId: string): Promise<string> {
  requireConfigured();

  const res = await fetch(`${env.steadfast.baseUrl}/status_by_cid/${encodeURIComponent(consignmentId)}`, {
    headers: authHeaders(),
  });

  const data = (await res.json().catch(() => null)) as SteadfastEnvelope<never> | null;

  if (!res.ok || !data || data.status !== 200 || !data.delivery_status) {
    throw AppError.badRequest(`Steadfast status check failed: ${data?.message ?? res.status}`, data ?? undefined);
  }

  return data.delivery_status;
}
