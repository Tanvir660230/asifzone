/**
 * Provider registry — the ONLY place that decides which concrete implementation backs each capability (Phase 12 W2/W3,
 * docs/PHASE_12_IMPLEMENTATION_CONTRACT.md §14). Everything else asks `getProviders()`.
 *
 * Implementations are referenced through module namespaces and called at call time, so a test's `vi.mock` of a provider
 * module still takes effect, and the moved implementations keep their exact behaviour (timeouts, retries, dev
 * fallbacks, claim semantics).
 */
import { env } from "../config/env";
import { installId } from "../config/installation";
import * as steadfast from "./courier/steadfast";
import * as resend from "./email/resend";
import * as metaCapi from "./events/meta-capi";
import * as eps from "./payment/eps";
import * as sslcommerz from "./payment/sslcommerz";
import * as webPush from "./push/web-push";
import * as bulksmsbd from "./sms/bulksmsbd";
import { ProviderNotConfiguredError } from "./errors";
import {
  capabilityAvailability,
  missingCredentials,
  validateProviderSelection,
  type CapabilityAvailability,
  type PaymentGatewayKey,
  type ProviderSelection,
  type RawProviderSelection,
} from "./selection";
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

// ── Installation → provider configuration (Phase 1D) ───────────────────────────────────────────
//
// Each installation is its own process with its own environment (docs/STORE_DEPLOYMENT.md), so an installation's provider
// configuration is: which provider it selected for each capability, and which credential variables its environment has.
// The registry resolves that configuration — it never reads another installation's credentials, and no credential lives
// in code. Themes and the browser never see any of it (only capability booleans, via the capabilities endpoint).

export interface InstallationProviderConfig {
  installId: string;
  nodeEnv: string;
  /** The PAYMENT_GATEWAYS / SMS_PROVIDER / EMAIL_PROVIDER / COURIER_PROVIDER / PUSH_PROVIDER values. */
  raw: RawProviderSelection;
  /** Whether this installation's environment has a value for a credential variable (presence only, never the value). */
  hasCredential: (envVar: string) => boolean;
}

/** This process's installation: config/installation.ts + config/env.ts. */
export function currentInstallationProviderConfig(): InstallationProviderConfig {
  return { installId, nodeEnv: env.nodeEnv, raw: env.providers, hasCredential: hasValue };
}

/** Any installation's configuration from its environment map (e.g. another store's docker/.env) — the same variables, the
 * same rules, so every installation goes through one registry. */
export function installationProviderConfigFrom(environment: Record<string, string | undefined>, id: string): InstallationProviderConfig {
  const value = (name: string) => environment[name]?.trim() ?? "";
  return {
    installId: id,
    nodeEnv: value("NODE_ENV") || "development",
    raw: {
      paymentGateways: value("PAYMENT_GATEWAYS"),
      sms: value("SMS_PROVIDER"),
      email: value("EMAIL_PROVIDER"),
      courier: value("COURIER_PROVIDER"),
      push: value("PUSH_PROVIDER"),
    },
    hasCredential: (envVar) => Boolean(value(envVar)),
  };
}

/** Validates an installation's configuration (throws ProviderConfigError naming variables only) and builds its providers. */
export function resolveInstallationProviders(config: InstallationProviderConfig) {
  const resolved = validateProviderSelection(config.raw, config.hasCredential, config.nodeEnv);
  return {
    installId: config.installId,
    selection: resolved,
    providers: buildProviders(resolved),
    capabilities: capabilityAvailability(resolved, config.hasCredential),
  };
}

let selection: ProviderSelection | null = null;
let providers: Providers | null = null;

/** Validates this installation's provider configuration (throws ProviderConfigError naming variables only). Called once at
 * API startup so a bad configuration fails the deploy's readiness check instead of a customer's request. */
export function validateProviderConfig(): ProviderSelection {
  const resolved = resolveInstallationProviders(currentInstallationProviderConfig());
  selection = resolved.selection;
  providers = resolved.providers;
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

/** Phase 12 D-4: which capabilities are usable (selected AND credentials present) — booleans only, safe for any admin. */
export function capabilities(): CapabilityAvailability {
  return capabilityAvailability(selection ?? validateProviderConfig(), hasValue);
}

/** Booleans and variable NAMES only — which provider backs each capability, whether it is usable, and which credential
 * variables are missing (never a value). OWNER-only (settings.manage). */
export function providerStatus(): ProviderStatusEntry[] {
  const current = selection ?? validateProviderConfig();
  const usable = capabilityAvailability(current, hasValue);
  const single = (capability: "sms" | "email" | "push" | "courier", id: string): ProviderStatusEntry => {
    const missing = missingCredentials(id, hasValue);
    return { capability, provider: id, enabled: id !== "none", credentialsPresent: id !== "none" && missing.length === 0, available: usable[capability], missingCredentials: missing };
  };
  const gatewayMissing = current.paymentGateways.flatMap((g) => missingCredentials(g, hasValue));
  return [
    {
      capability: "payments",
      provider: current.paymentGateways.join(",") || "none",
      enabled: current.paymentGateways.length > 0,
      credentialsPresent: current.paymentGateways.length > 0 && gatewayMissing.length === 0,
      available: usable.payments.SSLCOMMERZ || usable.payments.EPS_PG,
      missingCredentials: gatewayMissing,
    },
    single("sms", current.sms),
    single("email", current.email),
    single("push", current.push),
    single("courier", current.courier),
    {
      capability: "serverEvents",
      provider: "meta",
      enabled: metaCapi.isMetaCapiEnabled(),
      credentialsPresent: Boolean(env.meta.pixelId && env.meta.accessToken),
      available: metaCapi.isMetaCapiEnabled(),
      missingCredentials: [],
    },
  ];
}
