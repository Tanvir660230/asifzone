import crypto from "crypto";
import { env } from "../../config/env";
import { AppError } from "../../lib/app-error";

const BASE_URL = env.eps.sandbox ? "https://sandbox-pgapi.eps.com.bd/v1" : "https://pgapi.eps.com.bd/v1";

function signHash(value: string): string {
  return crypto.createHmac("sha512", Buffer.from(env.eps.hashKey, "utf8")).update(value, "utf8").digest("base64");
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

  const res = await fetch(`${BASE_URL}/Auth/GetToken`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-hash": signHash(env.eps.username) },
    body: JSON.stringify({ userName: env.eps.username, password: env.eps.password }),
  });

  const data = (await res.json()) as EpsTokenResponse;
  if (!data.token || !data.expireDate || data.errorMessage || data.errorCode) {
    console.error("[eps] token request failed:", data.errorMessage);
    throw AppError.badRequest("Could not start the payment session. Please try again or choose a different payment method.");
  }

  cachedToken = { token: data.token, expiry: new Date(data.expireDate) };
  return cachedToken.token;
}

export interface InitEpsSessionParams {
  orderNumber: string;
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
  // using our orderNumber for it (like tran_id for SSLCommerz) means the callback needs no extra lookup.
  const hash = signHash(params.orderNumber);

  const body = {
    merchantId: env.eps.merchantId,
    storeId: env.eps.storeId,
    CustomerOrderId: params.orderNumber,
    merchantTransactionId: params.orderNumber,
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

  const res = await fetch(`${BASE_URL}/EPSEngine/InitializeEPS`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-hash": hash, Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

  const data = (await res.json()) as EpsInitResponse;
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

  const res = await fetch(`${BASE_URL}/EPSEngine/CheckMerchantTransactionStatus?${query.toString()}`, {
    headers: { "x-hash": hash, Authorization: `Bearer ${token}` },
  });

  const data = (await res.json()) as EpsVerifyResponse;
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
