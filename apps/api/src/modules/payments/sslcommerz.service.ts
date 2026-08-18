import { env } from "../../config/env";
import { AppError } from "../../lib/app-error";

const BASE_URL = env.sslcommerz.isLive
  ? "https://securepay.sslcommerz.com"
  : "https://sandbox.sslcommerz.com";

export interface InitSessionParams {
  orderNumber: string;
  /** What's actually sent to SSLCommerz as tran_id — the id a callback/IPN is looked up by.
   * Defaults to orderNumber (today's direct-call behavior) when omitted; payment.service.ts's
   * startPaymentSession always passes its own fresh PaymentSession.gatewayTransactionRef here, since
   * an order can now have more than one payment attempt and tran_id must be unique per attempt, not
   * per order. `orderNumber` itself stays display-only (product_name). */
  attemptRef?: string;
  amount: number;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string;
  customerAddress: string;
}

interface SslSessionResponse {
  status: string;
  GatewayPageURL?: string;
  sessionkey?: string;
  failedreason?: string;
}

/** Starts a hosted-checkout session; the caller redirects the customer's browser to the returned GatewayPageURL. */
export async function initSslcommerzSession(params: InitSessionParams): Promise<{ gatewayUrl: string; sessionKey: string }> {
  const attemptRef = params.attemptRef ?? params.orderNumber;
  const body = new URLSearchParams({
    store_id: env.sslcommerz.storeId,
    store_passwd: env.sslcommerz.storePassword,
    total_amount: params.amount.toFixed(2),
    currency: "BDT",
    tran_id: attemptRef,
    success_url: `${env.apiOrigin}/api/payments/sslcommerz/success`,
    fail_url: `${env.apiOrigin}/api/payments/sslcommerz/fail`,
    cancel_url: `${env.apiOrigin}/api/payments/sslcommerz/cancel`,
    ipn_url: `${env.apiOrigin}/api/payments/sslcommerz/ipn`,
    cus_name: params.customerName,
    cus_email: params.customerEmail || "no-reply@example.com",
    cus_add1: params.customerAddress,
    cus_city: "Dhaka",
    cus_postcode: "1000",
    cus_country: "Bangladesh",
    cus_phone: params.customerPhone,
    shipping_method: "NO",
    product_name: "Order " + params.orderNumber,
    product_category: "Clothing",
    product_profile: "general",
    num_of_item: "1",
  });

  let data: SslSessionResponse;
  try {
    const res = await fetch(`${BASE_URL}/gwprocess/v4/api.php`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    data = (await res.json()) as SslSessionResponse;
  } catch (err) {
    // A network failure (gateway unreachable/timeout) or a non-JSON response (maintenance page,
    // proxy error) throws here — left unguarded this became an unhandled TypeError/SyntaxError that
    // the generic error handler turned into a raw 500 instead of the same friendly message the
    // "gateway said no" branch below already gives for a well-formed failure.
    console.error(`[sslcommerz] session init request failed for order ${params.orderNumber}:`, err);
    throw AppError.badRequest("Could not start the payment session. Please try again or choose Cash on Delivery.");
  }

  if (data.status !== "SUCCESS" || !data.GatewayPageURL) {
    // The gateway's failedreason is an internal/config-facing detail (e.g. bad store_id) — log it
    // for us, but never surface it to the customer verbatim.
    console.error(`[sslcommerz] session init failed for order ${params.orderNumber}:`, data.failedreason);
    throw AppError.badRequest("Could not start the payment session. Please try again or choose Cash on Delivery.");
  }

  return { gatewayUrl: data.GatewayPageURL, sessionKey: data.sessionkey ?? "" };
}

export interface SslValidationResult {
  /** The tran_id SSLCommerz has on file for this val_id — this is what we set as orderNumber when
   * the session was started, so it's the source of truth for which order was actually paid. Never
   * trust a tran_id supplied directly in the callback body without checking it against this. */
  tranId: string;
  amount: number;
  status: string;
}

/** Confirms an IPN/redirect callback is genuine by re-checking the transaction against SSLCommerz's own records — never trust the callback payload alone. */
export async function validateSslcommerzTransaction(valId: string): Promise<SslValidationResult | null> {
  const query = new URLSearchParams({
    val_id: valId,
    store_id: env.sslcommerz.storeId,
    store_passwd: env.sslcommerz.storePassword,
    format: "json",
  });

  let data: { status?: string; tran_id?: string; amount?: string };
  try {
    const res = await fetch(`${BASE_URL}/validator/api/validationserverAPI.php?${query.toString()}`);
    data = (await res.json()) as { status?: string; tran_id?: string; amount?: string };
  } catch (err) {
    // Same network/non-JSON failure mode as initSslcommerzSession — here it's already documented
    // as "could not verify" (the caller treats null as unverified, same as a well-formed but
    // rejected validation response), so resolve to that instead of throwing an unhandled exception
    // out of a gateway callback route.
    console.error(`[sslcommerz] validation request failed for val_id ${valId}:`, err);
    return null;
  }
  if ((data.status !== "VALID" && data.status !== "VALIDATED") || !data.tran_id || !data.amount) {
    return null;
  }
  return { tranId: data.tran_id, amount: Number(data.amount), status: data.status };
}
