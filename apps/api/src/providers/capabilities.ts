/**
 * Capability interfaces (Phase 12 W2, docs/PHASE_12_IMPLEMENTATION_CONTRACT.md §8, §16).
 *
 * Application and domain code depends on these — never on a concrete provider module. Each interface exposes exactly
 * what today's providers actually do (the capability matrix), nothing aspirational:
 * - payment gateways have no refund API (refunds are ledger-only), SSLCommerz validates by val_id, EPS verifies by
 *   merchant transaction id;
 * - the courier has no cancel and no lookup-by-invoice;
 * - the server-event sink sends only Meta Purchase events.
 *
 * Provider-shaped types (Steadfast's consignment, the gateways' validation results) are re-exported as types only:
 * they describe data, they do not couple a caller to an implementation.
 */
import type { MetaServerEvent } from "../lib/meta/capi";
import type { CreateConsignmentInput, SteadfastBulkResultItem, SteadfastConsignment, SteadfastFraudCheck } from "./courier/steadfast";
import type { MailInput } from "./email/resend";
import type { EpsValidationResult, InitEpsSessionParams } from "./payment/eps";
import type { InitSessionParams, SslValidationResult } from "./payment/sslcommerz";
import type { PushInput } from "./push/web-push";
import type { SmsInput } from "./sms/bulksmsbd";
import type { CourierProviderId, EmailProviderId, PaymentGatewayKey, PushProviderId, SmsProviderId } from "./selection";

export type { CreateConsignmentInput, SteadfastBulkResultItem, SteadfastConsignment, SteadfastFraudCheck };
export type { MailInput, PushInput, SmsInput, EpsValidationResult, SslValidationResult };

// ── Messaging ──────────────────────────────────────────────────────────────────────────────────

export interface SmsSender {
  readonly id: SmsProviderId;
  /** OTP, transactional and campaign SMS — one message to one number. */
  send(message: SmsInput): Promise<void>;
}

export interface EmailSender {
  readonly id: EmailProviderId;
  send(message: MailInput): Promise<void>;
}

export interface PushSender {
  readonly id: PushProviderId;
  send(message: PushInput): Promise<void>;
}

// ── Courier ────────────────────────────────────────────────────────────────────────────────────

export interface CourierProvider {
  readonly id: CourierProviderId;
  /** Throws CourierOutcomeUnknownError when the booking may or may not exist (Phase 9 claim stays held). */
  createShipment(input: CreateConsignmentInput): Promise<SteadfastConsignment>;
  createShipments(inputs: CreateConsignmentInput[]): Promise<SteadfastBulkResultItem[]>;
  statusByConsignment(consignmentId: string): Promise<string>;
  balance(): Promise<number>;
  deliveryScore(phone: string): Promise<SteadfastFraudCheck>;
}

// ── Server-side analytics events ───────────────────────────────────────────────────────────────

export interface ServerEventSink {
  readonly id: "meta";
  /** Configured and allowed to send from this environment (Meta's own gate, unchanged). */
  enabled(): boolean;
  send(event: MetaServerEvent): Promise<{ eventsReceived: number }>;
}

// ── Payment gateways ───────────────────────────────────────────────────────────────────────────

/** The online `PaymentMethod` values (DB truth, unchanged). COD has no gateway. */
export type OnlineGatewayId = "SSLCOMMERZ" | "EPS_PG";

/** One parameter object both gateways accept today (payment.service builds it once). */
export type GatewaySessionParams = InitSessionParams & InitEpsSessionParams;

export interface GatewaySession {
  gatewayUrl: string;
  providerTransactionId: string;
}

export interface PaymentGateway {
  readonly id: OnlineGatewayId;
  readonly key: PaymentGatewayKey;
  createSession(params: GatewaySessionParams): Promise<GatewaySession>;
}

export interface SslcommerzGateway extends PaymentGateway {
  readonly id: "SSLCOMMERZ";
  /** SSLCommerz's validator API, by val_id (success/fail/IPN callbacks). */
  validate(valId: string): Promise<SslValidationResult | null>;
}

export interface EpsGateway extends PaymentGateway {
  readonly id: "EPS_PG";
  /** EPS's verify API, by merchant transaction id (callbacks and the reconciliation cron). */
  verify(merchantTransactionId: string): Promise<EpsValidationResult | null>;
}

export interface GatewayById {
  SSLCOMMERZ: SslcommerzGateway;
  EPS_PG: EpsGateway;
}

export interface PaymentGateways {
  /** Enabled for new sessions by PAYMENT_GATEWAYS (the store's own on/off toggles in StoreSetting still apply on top). */
  enabled(id: OnlineGatewayId): boolean;
  /** For a NEW payment session: throws ProviderNotConfiguredError when the gateway is not enabled for this store. */
  forNewSession<K extends OnlineGatewayId>(id: K): GatewayById[K];
  /** For callbacks / verification / reconciliation of sessions that already exist: always the adapter, so a session
   * created before a configuration change can still settle. */
  adapter<K extends OnlineGatewayId>(id: K): GatewayById[K];
}

/** The one mapping from an order's payment method to its gateway (formerly an inline ternary at each call site). EPS_PG
 * → EPS, every other online method → SSLCommerz, exactly as before. */
export function gatewayIdForPaymentMethod(paymentMethod: string): OnlineGatewayId {
  return paymentMethod === "EPS_PG" ? "EPS_PG" : "SSLCOMMERZ";
}

// ── The bundle the registry hands out ─────────────────────────────────────────────────────────

export interface Providers {
  sms: SmsSender;
  email: EmailSender;
  push: PushSender;
  courier: CourierProvider;
  serverEvents: ServerEventSink;
  payments: PaymentGateways;
}

/** OWNER view for admin/ops: booleans and credential variable NAMES only (never a value). */
export interface ProviderStatusEntry {
  capability: "payments" | "sms" | "email" | "push" | "courier" | "serverEvents";
  provider: string;
  enabled: boolean;
  credentialsPresent: boolean;
  /** Selected AND credentials present — whether the UI offers this capability's actions (Phase 12 D-4). */
  available: boolean;
  /** Names of the credential variables still unset (e.g. "STEADFAST_SECRET_KEY"). */
  missingCredentials: string[];
}
