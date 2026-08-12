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
  tracking_link: string;
  status: string;
}

interface SteadfastEnvelope<T> {
  status: number;
  message?: string;
  consignment?: T;
  delivery_status?: string;
  current_balance?: number;
}

interface SteadfastBulkResultItem {
  invoice: string;
  status?: string | number;
  consignment_id?: number;
  tracking_code?: string;
  tracking_link?: string;
  message?: string;
}

/** The shape of one raw item in Steadfast's bulk response — kept separate from
 * SteadfastBulkResultItem because it's genuinely unconfirmed. Unlike the single-order envelope
 * (verified against a real successful booking), this bulk shape was only ever confirmed against a
 * *rejected* batch, which carries no per-item payload either way. Two things are uncertain: whether
 * `status` comes back as the string "success" or a numeric HTTP-style code like the single-order
 * envelope's `status: 200`, and whether the booking fields sit flat on the item or nested under a
 * `consignment` object the same way the single-order envelope nests them. Bulk booking silently
 * marking every order as "failed" despite Steadfast actually creating the consignments is exactly
 * the symptom either mismatch would produce, so normalizeBulkResultItem below stays defensive to
 * both possibilities instead of asserting one. */
interface RawSteadfastBulkResultItem {
  invoice: string;
  status?: string | number;
  message?: string;
  consignment_id?: number;
  tracking_code?: string;
  tracking_link?: string;
  consignment?: {
    consignment_id?: number;
    tracking_code?: string;
    tracking_link?: string;
  };
}

function normalizeBulkResultItem(item: RawSteadfastBulkResultItem): SteadfastBulkResultItem {
  return {
    invoice: item.invoice,
    status: item.status,
    message: item.message,
    consignment_id: item.consignment_id ?? item.consignment?.consignment_id,
    tracking_code: item.tracking_code ?? item.consignment?.tracking_code,
    tracking_link: item.tracking_link ?? item.consignment?.tracking_link,
  };
}

function authHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Api-Key": env.steadfast.apiKey,
    "Secret-Key": env.steadfast.secretKey,
  };
}

/** `res.json()` throws (and silently loses the body) whenever Steadfast responds with a non-JSON
 * payload — an HTML error page on a 500, for instance, which is exactly the case that was showing
 * admins a bare "Steadfast bulk booking failed: 500" with no way to tell what actually went wrong.
 * Reading the body as text first means a failure always has *something* diagnosable attached. */
async function readSteadfastResponse(res: Response): Promise<{ data: unknown; rawText: string }> {
  const rawText = await res.text();
  let data: unknown = null;
  try {
    if (rawText) data = JSON.parse(rawText);
  } catch {
    // rawText is kept for the caller to log/surface even when it isn't valid JSON.
  }
  return { data, rawText };
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

  const { data: parsed, rawText } = await readSteadfastResponse(res);
  const data = parsed as SteadfastEnvelope<SteadfastConsignment> | null;

  // Steadfast responds HTTP 200 with an in-body status even on some validation errors — the
  // in-body status is the real signal, same "don't trust the transport code alone" pattern as
  // lib/sms.ts's BulkSMSBD handling.
  if (!res.ok || !data || data.status !== 200 || !data.consignment) {
    if (!data) console.error(`[steadfast] booking failed (HTTP ${res.status}):`, rawText.slice(0, 2000));
    throw AppError.badRequest(
      `Steadfast booking failed: ${data?.message ?? `HTTP ${res.status}`}`,
      data ?? { status: res.status, body: rawText.slice(0, 2000) },
    );
  }

  return data.consignment;
}

/** Books up to 500 consignments in a single call — Steadfast's bulk endpoint takes the order array
 * JSON-*stringified* inside the `data` field (not a raw array body), a quirk both of Steadfast's own
 * published Laravel packages encode the same way. Returns one result per input, matched back to the
 * caller's orders by `invoice` (we always send our orderNumber as the invoice). Unlike the single-order
 * path, a per-item failure doesn't throw — courier.service.ts decides what to do with mixed results. */
export async function createBulkSteadfastConsignments(
  inputs: CreateConsignmentInput[],
): Promise<SteadfastBulkResultItem[]> {
  requireConfigured();
  if (!inputs.length) return [];

  const payload = inputs.map((input) => ({
    invoice: input.invoice,
    recipient_name: input.recipientName,
    recipient_phone: input.recipientPhone,
    recipient_address: input.recipientAddress,
    cod_amount: input.codAmount,
    note: input.note,
  }));

  const res = await fetch(`${env.steadfast.baseUrl}/create_order/bulk-order`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ data: JSON.stringify(payload) }),
  });

  const { data, rawText } = await readSteadfastResponse(res);
  if (!res.ok || !data) {
    console.error(`[steadfast] bulk booking failed (HTTP ${res.status}):`, rawText.slice(0, 2000));
    throw AppError.badRequest(
      `Steadfast bulk booking failed: ${(data as { message?: string } | null)?.message ?? `HTTP ${res.status}`}`,
      { status: res.status, body: rawText.slice(0, 2000) },
    );
  }

  // Steadfast wraps the bulk response as { status, message, data: [...] } (confirmed against the
  // live API) rather than the single-order envelope's { consignment } shape — fall back to a raw
  // top-level array too, in case that ever changes. Either way, no results means the whole batch
  // was rejected up front (e.g. malformed payload) rather than order-by-order.
  const rawResults: RawSteadfastBulkResultItem[] = Array.isArray(data)
    ? data
    : Array.isArray((data as { data?: unknown }).data)
      ? (data as { data: RawSteadfastBulkResultItem[] }).data
      : [];

  if (!rawResults.length) {
    console.error("[steadfast] bulk booking returned no results:", rawText.slice(0, 2000));
    throw AppError.badRequest(
      `Steadfast bulk booking failed: ${(data as { message?: string }).message ?? "no results returned"}`,
      data,
    );
  }

  return rawResults.map(normalizeBulkResultItem);
}

export async function getSteadfastBalance(): Promise<number> {
  requireConfigured();

  const res = await fetch(`${env.steadfast.baseUrl}/get_balance`, { headers: authHeaders() });
  const { data: parsed, rawText } = await readSteadfastResponse(res);
  const data = parsed as SteadfastEnvelope<never> | null;

  if (!res.ok || !data || data.status !== 200 || typeof data.current_balance !== "number") {
    if (!data) console.error(`[steadfast] balance check failed (HTTP ${res.status}):`, rawText.slice(0, 2000));
    throw AppError.badRequest(
      `Steadfast balance check failed: ${data?.message ?? `HTTP ${res.status}`}`,
      data ?? { status: res.status, body: rawText.slice(0, 2000) },
    );
  }

  return data.current_balance;
}

export async function getSteadfastStatusByConsignmentId(consignmentId: string): Promise<string> {
  requireConfigured();

  const res = await fetch(`${env.steadfast.baseUrl}/status_by_cid/${encodeURIComponent(consignmentId)}`, {
    headers: authHeaders(),
  });

  const { data: parsed, rawText } = await readSteadfastResponse(res);
  const data = parsed as SteadfastEnvelope<never> | null;

  if (!res.ok || !data || data.status !== 200 || !data.delivery_status) {
    if (!data) console.error(`[steadfast] status check failed (HTTP ${res.status}):`, rawText.slice(0, 2000));
    throw AppError.badRequest(
      `Steadfast status check failed: ${data?.message ?? `HTTP ${res.status}`}`,
      data ?? { status: res.status, body: rawText.slice(0, 2000) },
    );
  }

  return data.delivery_status;
}
