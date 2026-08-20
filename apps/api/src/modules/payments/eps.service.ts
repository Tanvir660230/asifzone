import crypto from "crypto";
import https from "https";
import { env } from "../../config/env";
import { AppError } from "../../lib/app-error";

const BASE_URL = env.eps.sandbox ? "https://sandboxpgapi.eps.com.bd/v1" : "https://pgapi.eps.com.bd/v1";

function signHash(value: string): string {
  return crypto.createHmac("sha512", Buffer.from(env.eps.hashKey, "utf8")).update(value, "utf8").digest("base64");
}

/** EPS checkout traffic is sparse (one checkout at a time, one reconciliation tick per 5 minutes), so
 * undici's shared keep-alive pool for this host is almost always idle long enough for EPS's server to
 * have quietly closed its end. undici doesn't always surface that as a connection error — it hands back
 * a "successfully completed" but empty body, so `res.json()` throws "Unexpected end of JSON input" on a
 * dead-connection artifact rather than a real EPS response. A single retry over the same shared pool
 * isn't reliable here: with so little traffic, the *other* idle sockets tend to be equally stale, so the
 * retry can hit the exact same failure — confirmed live on 2026-08-20, where every request failed for
 * hours even after the retry landed. `agent: false` opts every EPS call out of that pool entirely and
 * opens a fresh, unpooled TCP+TLS connection per call — the same thing a one-off curl does, which never
 * reproduced the failure no matter how many times it was run back-to-back. */
function fetchEpsJson<T>(url: string, init: { method?: string; headers: Record<string, string>; body?: string }): Promise<T> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = https.request(
      {
        hostname: target.hostname,
        path: target.pathname + target.search,
        method: init.method ?? "GET",
        headers: init.headers,
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as T);
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on("error", reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

interface EpsTokenResponse {
  token?: string;
  expireDate?: string;
  errorMessage?: string | null;
  errorCode?: string | null;
}

// EPS tokens are short-lived and shared across requests from this process — cached in module scope
// (not per-request) so a burst of checkouts doesn't re-authenticate for every single one.
let cachedToken: { token: string; expiry: Date } | null = null;

async function getEpsToken(): Promise<string> {
  if (cachedToken && cachedToken.expiry.getTime() > Date.now() + 5000) return cachedToken.token;

  let data: EpsTokenResponse;
  try {
    data = await fetchEpsJson<EpsTokenResponse>(`${BASE_URL}/Auth/GetToken`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-hash": signHash(env.eps.username) },
      body: JSON.stringify({ userName: env.eps.username, password: env.eps.password }),
    });
  } catch (err) {
    // A network failure or non-JSON response throws here — left unguarded this became an unhandled
    // TypeError/SyntaxError that the generic error handler turned into a raw 500 instead of the same
    // friendly message the "gateway said no" branch below already gives for a well-formed failure.
    console.error("[eps] token request failed:", err);
    throw AppError.badRequest("Could not start the payment session. Please try again or choose a different payment method.");
  }

  if (!data.token || !data.expireDate || data.errorMessage || data.errorCode) {
    console.error("[eps] token request failed:", data.errorMessage);
    throw AppError.badRequest("Could not start the payment session. Please try again or choose a different payment method.");
  }

  cachedToken = { token: data.token, expiry: new Date(data.expireDate) };
  return cachedToken.token;
}

export interface InitEpsSessionParams {
  orderNumber: string;
  /** What's actually sent to EPS as merchantTransactionId — the id a callback/verify call is
   * looked up by. Defaults to orderNumber (today's direct-call behavior) when omitted; payment.service.ts's
   * startPaymentSession always passes its own fresh PaymentSession.gatewayTransactionRef here, since
   * an order can now have more than one payment attempt and merchantTransactionId must be unique per
   * attempt, not per order. `orderNumber` itself stays display-only (CustomerOrderId/ProductName). */
  attemptRef?: string;
  amount: number;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string;
  customerAddress: string;
}

interface EpsInitResponse {
  TransactionId?: string;
  RedirectURL?: string;
  ErrorMessage?: string;
  ErrorCode?: string | null;
}

/** Starts a hosted-checkout session; the caller redirects the customer's browser to the returned gatewayUrl. */
export async function initEpsSession(params: InitEpsSessionParams): Promise<{ gatewayUrl: string; transactionId: string }> {
  const token = await getEpsToken();
  // EPS's own merchantTransactionId is what the success/fail/cancel callback later carries back —
  // this is attemptRef (unique per payment attempt), not orderNumber (shared across every attempt
  // on the same order once retries exist).
  const attemptRef = params.attemptRef ?? params.orderNumber;
  const hash = signHash(attemptRef);

  const body = {
    merchantId: env.eps.merchantId,
    storeId: env.eps.storeId,
    CustomerOrderId: params.orderNumber,
    merchantTransactionId: attemptRef,
    transactionTypeId: 1, // WEB
    financialEntityId: 0,
    transitionStatusId: 0,
    totalAmount: params.amount,
    ipAddress: "0.0.0.0",
    version: "1",
    successUrl: `${env.apiOrigin}/api/payments/eps/success`,
    failUrl: `${env.apiOrigin}/api/payments/eps/fail`,
    cancelUrl: `${env.apiOrigin}/api/payments/eps/cancel`,
    customerName: params.customerName,
    customerEmail: params.customerEmail || "no-reply@example.com",
    CustomerAddress: params.customerAddress,
    CustomerAddress2: "",
    CustomerCity: "Dhaka",
    CustomerState: "Dhaka",
    CustomerPostcode: "1000",
    CustomerCountry: "BD",
    CustomerPhone: params.customerPhone,
    ShipmentName: "",
    ShipmentAddress: "",
    ShipmentAddress2: "",
    ShipmentCity: "",
    ShipmentState: "",
    ShipmentPostcode: "",
    ShipmentCountry: "",
    ValueA: "",
    ValueB: "",
    ValueC: "",
    ValueD: "",
    ShippingMethod: "NO",
    NoOfItem: "1",
    ProductName: "Order " + params.orderNumber,
    ProductProfile: "general",
    ProductCategory: "Clothing",
    ProductList: [],
  };

  let data: EpsInitResponse;
  try {
    data = await fetchEpsJson<EpsInitResponse>(`${BASE_URL}/EPSEngine/InitializeEPS`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-hash": hash, Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error(`[eps] session init request failed for order ${params.orderNumber}:`, err);
    throw AppError.badRequest("Could not start the payment session. Please try again or choose a different payment method.");
  }

  if (data.ErrorMessage || data.ErrorCode || !data.RedirectURL) {
    // The gateway's ErrorMessage is an internal/config-facing detail (e.g. bad merchantId) — log it
    // for us, but never surface it to the customer verbatim.
    console.error(`[eps] session init failed for order ${params.orderNumber}:`, data.ErrorMessage);
    throw AppError.badRequest("Could not start the payment session. Please try again or choose a different payment method.");
  }

  return { gatewayUrl: data.RedirectURL, transactionId: data.TransactionId ?? "" };
}

export interface EpsValidationResult {
  merchantTransactionId: string;
  epsTransactionId: string;
  amount: number;
  status: string;
}

interface EpsVerifyResponse {
  MerchantTransactionId?: string;
  EpsTransactionId?: string;
  Status?: string;
  TotalAmount?: string;
  ErrorMessage?: string;
  ErrorCode?: string | null;
}

/** Confirms a success/fail/cancel redirect is genuine by re-checking the transaction against EPS's
 * own records — never trust the callback's query params alone. */
export async function verifyEpsTransaction(merchantTransactionId: string): Promise<EpsValidationResult | null> {
  const token = await getEpsToken();
  const hash = signHash(merchantTransactionId);
  const query = new URLSearchParams({ merchantTransactionId });

  let data: EpsVerifyResponse;
  try {
    data = await fetchEpsJson<EpsVerifyResponse>(`${BASE_URL}/EPSEngine/CheckMerchantTransactionStatus?${query.toString()}`, {
      headers: { "x-hash": hash, Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    // Same network/non-JSON failure mode as initEpsSession — here it's already documented as
    // "could not verify" (the caller treats null as unverified), so resolve to that instead of
    // throwing an unhandled exception out of a gateway callback route.
    console.error(`[eps] verify request failed for ${merchantTransactionId}:`, err);
    return null;
  }
  if (data.ErrorMessage || data.ErrorCode || !data.MerchantTransactionId || !data.TotalAmount) {
    return null;
  }

  return {
    merchantTransactionId: data.MerchantTransactionId,
    epsTransactionId: data.EpsTransactionId ?? "",
    amount: Number(data.TotalAmount),
    status: data.Status ?? "",
  };
}
