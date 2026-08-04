import { env } from "../../config/env";
import { AppError } from "../../lib/app-error";

const BASE_URL = env.sslcommerz.isLive
  ? "https://securepay.sslcommerz.com"
  : "https://sandbox.sslcommerz.com";

export interface InitSessionParams {
  orderNumber: string;
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
  const body = new URLSearchParams({
    store_id: env.sslcommerz.storeId,
    store_passwd: env.sslcommerz.storePassword,
    total_amount: params.amount.toFixed(2),
    currency: "BDT",
    tran_id: params.orderNumber,
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

  const res = await fetch(`${BASE_URL}/gwprocess/v4/api.php`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = (await res.json()) as SslSessionResponse;
  if (data.status !== "SUCCESS" || !data.GatewayPageURL) {
    throw AppError.badRequest(`Payment gateway error: ${data.failedreason ?? "could not start session"}`);
  }

  return { gatewayUrl: data.GatewayPageURL, sessionKey: data.sessionkey ?? "" };
}

/** Confirms an IPN/redirect callback is genuine by re-checking the transaction against SSLCommerz's own records — never trust the callback payload alone. */
export async function validateSslcommerzTransaction(valId: string): Promise<boolean> {
  const query = new URLSearchParams({
    val_id: valId,
    store_id: env.sslcommerz.storeId,
    store_passwd: env.sslcommerz.storePassword,
    format: "json",
  });

  const res = await fetch(`${BASE_URL}/validator/api/validationserverAPI.php?${query.toString()}`);
  const data = (await res.json()) as { status?: string };
  return data.status === "VALID" || data.status === "VALIDATED";
}
