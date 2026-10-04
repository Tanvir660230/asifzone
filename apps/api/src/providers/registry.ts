/**
 * Provider registry — the ONLY place that decides which concrete implementation backs each capability (Phase 12 W2/W3,
 * docs/PHASE_12_IMPLEMENTATION_CONTRACT.md §14). Everything else asks `getProviders()`.
 *
 * Implementations are referenced through module namespaces and called at call time, so a test's `vi.mock` of a provider
 * module still takes effect, and the moved implementations keep their exact behaviour (timeouts, retries, dev
 * fallbacks, claim semantics).
 */
import { env } from "../config/env";
import * as steadfast from "./courier/steadfast";
import * as resend from "./email/resend";
import * as metaCapi from "./events/meta-capi";
import * as eps from "./payment/eps";
import * as sslcommerz from "./payment/sslcommerz";
import * as webPush from "./push/web-push";
import * as bulksmsbd from "./sms/bulksmsbd";
import { ProviderNotConfiguredError } from "./errors";
import { REQUIRED_CREDENTIALS, validateProviderSelection, type PaymentGatewayKey, type ProviderSelection } from "./selection";
import type {
  CourierProvider,
  EmailSender,
  EpsGateway,
  GatewayById,
  OnlineGatewayId,
  PaymentGateways,
  ProviderStatusEntry,
  Providers,
  PushSender,
  ServerEventSink,
  SmsSender,
  SslcommerzGateway,
} from "./capabilities";

/** Presence (never the value) of each credential variable, read from config/env.ts. */
function credentialValues(): Record<string, string> {
  return {
    BULKSMSBD_API_KEY: env.bulkSmsBd.apiKey,
    BULKSMSBD_SENDER_ID: env.bulkSmsBd.senderId,
    RESEND_API_KEY: env.resend.apiKey,
    STEADFAST_API_KEY: env.steadfast.apiKey,
    STEADFAST_SECRET_KEY: env.steadfast.secretKey,
    WEB_PUSH_PUBLIC_KEY: env.webPush.publicKey,
    WEB_PUSH_PRIVATE_KEY: env.webPush.privateKey,
    SSLCOMMERZ_STORE_ID: env.sslcommerz.storeId,
    SSLCOMMERZ_STORE_PASSWORD: env.sslcommerz.storePassword,
    EPS_USERNAME: env.eps.username,
    EPS_PASSWORD: env.eps.password,
    EPS_HASH_KEY: env.eps.hashKey,
    EPS_MERCHANT_ID: env.eps.merchantId,
    EPS_STORE_ID: env.eps.storeId,
  };
}

const hasValue = (envVar: string) => Boolean(credentialValues()[envVar]);

const GATEWAY_KEY: Record<OnlineGatewayId, PaymentGatewayKey> = { SSLCOMMERZ: "sslcommerz", EPS_PG: "eps" };

// ── Implementations ────────────────────────────────────────────────────────────────────────────

const sslcommerzGateway: SslcommerzGateway = {
  id: "SSLCOMMERZ",
  key: "sslcommerz",
  createSession: (params) =>
    sslcommerz.initSslcommerzSession(params).then((r) => ({ gatewayUrl: r.gatewayUrl, providerTransactionId: r.sessionKey })),
  validate: (valId) => sslcommerz.validateSslcommerzTransaction(valId),
};

const epsGateway: EpsGateway = {
  id: "EPS_PG",
  key: "eps",
  createSession: (params) => eps.initEpsSession(params).then((r) => ({ gatewayUrl: r.gatewayUrl, providerTransactionId: r.transactionId })),
  verify: (merchantTransactionId) => eps.verifyEpsTransaction(merchantTransactionId),
};

const GATEWAYS: GatewayById = { SSLCOMMERZ: sslcommerzGateway, EPS_PG: epsGateway };

function buildPayments(enabledKeys: readonly PaymentGatewayKey[]): PaymentGateways {
  const enabled = (id: OnlineGatewayId) => enabledKeys.includes(GATEWAY_KEY[id]);
  return {
    enabled,
    forNewSession: (id) => {
      if (!enabled(id)) throw new ProviderNotConfiguredError(`Payment gateway ${id}`, "PAYMENT_GATEWAYS");
      return GATEWAYS[id];
    },
    adapter: (id) => GATEWAYS[id],
  };
}

function smsSender(id: ProviderSelection["sms"]): SmsSender {
  if (id === "none") return { id, send: async () => Promise.reject(new ProviderNotConfiguredError("SMS", "SMS_PROVIDER")) };
  return { id, send: (message) => bulksmsbd.sendSms(message) };
}

function emailSender(id: ProviderSelection["email"]): EmailSender {
  if (id === "none") return { id, send: async () => Promise.reject(new ProviderNotConfiguredError("Email", "EMAIL_PROVIDER")) };
  return { id, send: (message) => resend.sendMail(message) };
}

function pushSender(id: ProviderSelection["push"]): PushSender {
  if (id === "none") return { id, send: async () => Promise.reject(new ProviderNotConfiguredError("Web push", "PUSH_PROVIDER")) };
  return { id, send: (message) => webPush.sendPush(message) };
}

function courierProvider(id: ProviderSelection["courier"]): CourierProvider {
  if (id === "none") {
    const off = async (): Promise<never> => Promise.reject(new ProviderNotConfiguredError("Courier", "COURIER_PROVIDER"));
    return { id, createShipment: off, createShipments: off, statusByConsignment: off, balance: off, deliveryScore: off };
  }
  return {
    id,
    createShipment: (input) => steadfast.createSteadfastConsignment(input),
    createShipments: (inputs) => steadfast.createBulkSteadfastConsignments(inputs),
    statusByConsignment: (consignmentId) => steadfast.getSteadfastStatusByConsignmentId(consignmentId),
    balance: () => steadfast.getSteadfastBalance(),
    deliveryScore: (phone) => steadfast.getSteadfastFraudCheck(phone),
  };
}

const serverEvents: ServerEventSink = {
  id: "meta",
  enabled: () => metaCapi.isMetaCapiEnabled(),
  send: (event) => metaCapi.sendMetaEvent(event),
};

// ── Registry ───────────────────────────────────────────────────────────────────────────────────

export function buildProviders(selection: ProviderSelection): Providers {
  return {
    sms: smsSender(selection.sms),
    email: emailSender(selection.email),
    push: pushSender(selection.push),
    courier: courierProvider(selection.courier),
    serverEvents,
    payments: buildPayments(selection.paymentGateways),
  };
}

let selection: ProviderSelection | null = null;
let providers: Providers | null = null;

/** Validates env.providers (throws ProviderConfigError naming variables only). Called once at API startup so a bad
 * configuration fails the deploy's readiness check instead of a customer's request. */
export function validateProviderConfig(): ProviderSelection {
  selection = validateProviderSelection(env.providers, hasValue, env.nodeEnv);
  providers = buildProviders(selection);
  return selection;
}

export function getProviders(): Providers {
  if (!providers) validateProviderConfig();
  return providers!;
}

/** Tests only: run with a different selection (e.g. the second-store proof). `null` restores the env-derived one. */
export function setProviderSelectionForTests(next: ProviderSelection | null): void {
  selection = next;
  providers = next ? buildProviders(next) : null;
}

/** Booleans only — which provider backs each capability and whether its credentials are present. */
export function providerStatus(): ProviderStatusEntry[] {
  const current = selection ?? validateProviderConfig();
  const has = (id: string) => (REQUIRED_CREDENTIALS[id as keyof typeof REQUIRED_CREDENTIALS] ?? []).every(hasValue);
  const single = (capability: ProviderStatusEntry["capability"], id: string): ProviderStatusEntry => ({
    capability,
    provider: id,
    enabled: id !== "none",
    credentialsPresent: id === "none" ? false : has(id),
  });
  return [
    {
      capability: "payments",
      provider: current.paymentGateways.join(",") || "none",
      enabled: current.paymentGateways.length > 0,
      credentialsPresent: current.paymentGateways.length > 0 && current.paymentGateways.every(has),
    },
    single("sms", current.sms),
    single("email", current.email),
    single("push", current.push),
    single("courier", current.courier),
    { capability: "serverEvents", provider: "meta", enabled: metaCapi.isMetaCapiEnabled(), credentialsPresent: Boolean(env.meta.pixelId && env.meta.accessToken) },
  ];
}
