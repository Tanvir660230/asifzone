import { ProviderConfigError } from "./errors";

/**
 * Provider selection — pure decision logic (Phase 12 W5, docs/PHASE_12_IMPLEMENTATION_CONTRACT.md §15, D-4b).
 *
 * Input: the raw `*_PROVIDER` / `PAYMENT_GATEWAYS` strings (env.providers). Output: which implementation backs each
 * capability, or a ProviderConfigError naming the offending variables (never a value).
 *
 * - Unset or blank → DEFAULT_SELECTION, which is exactly the pre-Phase-12 behaviour (every integration wired, each one
 *   keeping its own dev fallback when its credentials are blank). docker compose passes unset variables as "", so blank
 *   must mean "unset".
 * - `none` → the capability is explicitly disabled; the registry wires a NotConfigured implementation (never a fake
 *   success).
 * - An explicitly selected provider must have its credentials in production; unknown names are rejected everywhere.
 */

export const SMS_PROVIDER_IDS = ["bulksmsbd", "none"] as const;
export const EMAIL_PROVIDER_IDS = ["resend", "none"] as const;
export const COURIER_PROVIDER_IDS = ["steadfast", "none"] as const;
export const PUSH_PROVIDER_IDS = ["webpush", "none"] as const;
export const PAYMENT_GATEWAY_KEYS = ["sslcommerz", "eps"] as const;

export type SmsProviderId = (typeof SMS_PROVIDER_IDS)[number];
export type EmailProviderId = (typeof EMAIL_PROVIDER_IDS)[number];
export type CourierProviderId = (typeof COURIER_PROVIDER_IDS)[number];
export type PushProviderId = (typeof PUSH_PROVIDER_IDS)[number];
export type PaymentGatewayKey = (typeof PAYMENT_GATEWAY_KEYS)[number];

export interface RawProviderSelection {
  paymentGateways: string;
  sms: string;
  email: string;
  courier: string;
  push: string;
}

type Slot = keyof RawProviderSelection;

export interface ProviderSelection {
  sms: SmsProviderId;
  email: EmailProviderId;
  courier: CourierProviderId;
  push: PushProviderId;
  paymentGateways: readonly PaymentGatewayKey[];
  /** Which slots were set explicitly (credential validation applies only to those). */
  explicit: Readonly<Record<Slot, boolean>>;
}

/** Today's wiring. Changing a value here changes production behaviour for every store that leaves the variable unset. */
export const DEFAULT_SELECTION = {
  sms: "bulksmsbd",
  email: "resend",
  courier: "steadfast",
  push: "webpush",
  paymentGateways: ["sslcommerz", "eps"],
} as const satisfies Omit<ProviderSelection, "explicit">;

export const ENV_VAR: Readonly<Record<Slot, string>> = {
  paymentGateways: "PAYMENT_GATEWAYS",
  sms: "SMS_PROVIDER",
  email: "EMAIL_PROVIDER",
  courier: "COURIER_PROVIDER",
  push: "PUSH_PROVIDER",
};

/** Credentials each concrete provider needs before it can be explicitly selected in production. */
export const REQUIRED_CREDENTIALS: Readonly<Record<Exclude<SmsProviderId | EmailProviderId | CourierProviderId | PushProviderId, "none"> | PaymentGatewayKey, readonly string[]>> = {
  bulksmsbd: ["BULKSMSBD_API_KEY", "BULKSMSBD_SENDER_ID"],
  resend: ["RESEND_API_KEY"],
  steadfast: ["STEADFAST_API_KEY", "STEADFAST_SECRET_KEY"],
  webpush: ["WEB_PUSH_PUBLIC_KEY", "WEB_PUSH_PRIVATE_KEY"],
  sslcommerz: ["SSLCOMMERZ_STORE_ID", "SSLCOMMERZ_STORE_PASSWORD"],
  eps: ["EPS_USERNAME", "EPS_PASSWORD", "EPS_HASH_KEY", "EPS_MERCHANT_ID", "EPS_STORE_ID"],
};

function single<T extends string>(slot: Slot, raw: string, allowed: readonly T[], fallback: T, problems: string[]): [T, boolean] {
  const value = raw.trim().toLowerCase();
  if (!value) return [fallback, false];
  if ((allowed as readonly string[]).includes(value)) return [value as T, true];
  problems.push(`${ENV_VAR[slot]} must be one of: ${allowed.join(", ")}`);
  return [fallback, true];
}

function gateways(raw: string, problems: string[]): [readonly PaymentGatewayKey[], boolean] {
  const value = raw.trim().toLowerCase();
  if (!value) return [DEFAULT_SELECTION.paymentGateways, false];
  if (value === "none") return [[], true];
  const parts = value.split(",").map((p) => p.trim()).filter(Boolean);
  const unknown = parts.filter((p) => !(PAYMENT_GATEWAY_KEYS as readonly string[]).includes(p));
  if (unknown.length || !parts.length) problems.push(`${ENV_VAR.paymentGateways} must be "none" or a comma-separated list of: ${PAYMENT_GATEWAY_KEYS.join(", ")}`);
  return [[...new Set(parts.filter((p): p is PaymentGatewayKey => (PAYMENT_GATEWAY_KEYS as readonly string[]).includes(p)))], true];
}

/** Parses the raw strings. Never throws; returns the problems for the caller to report. */
export function resolveProviderSelection(raw: RawProviderSelection): { selection: ProviderSelection; problems: string[] } {
  const problems: string[] = [];
  const [sms, smsExplicit] = single("sms", raw.sms, SMS_PROVIDER_IDS, DEFAULT_SELECTION.sms, problems);
  const [email, emailExplicit] = single("email", raw.email, EMAIL_PROVIDER_IDS, DEFAULT_SELECTION.email, problems);
  const [courier, courierExplicit] = single("courier", raw.courier, COURIER_PROVIDER_IDS, DEFAULT_SELECTION.courier, problems);
  const [push, pushExplicit] = single("push", raw.push, PUSH_PROVIDER_IDS, DEFAULT_SELECTION.push, problems);
  const [paymentGateways, gatewaysExplicit] = gateways(raw.paymentGateways, problems);
  return {
    selection: {
      sms,
      email,
      courier,
      push,
      paymentGateways,
      explicit: { sms: smsExplicit, email: emailExplicit, courier: courierExplicit, push: pushExplicit, paymentGateways: gatewaysExplicit },
    },
    problems,
  };
}

/** Production only: every explicitly selected provider must have all its credentials. Names variables, never values. */
export function credentialProblems(selection: ProviderSelection, hasValue: (envVar: string) => boolean, nodeEnv: string): string[] {
  if (nodeEnv !== "production") return [];
  const chosen: Array<[Slot, string]> = [
    ["sms", selection.sms],
    ["email", selection.email],
    ["courier", selection.courier],
    ["push", selection.push],
    ...selection.paymentGateways.map((g): [Slot, string] => ["paymentGateways", g]),
  ];
  const problems: string[] = [];
  for (const [slot, id] of chosen) {
    if (!selection.explicit[slot] || id === "none") continue;
    const missing = (REQUIRED_CREDENTIALS[id as keyof typeof REQUIRED_CREDENTIALS] ?? []).filter((v) => !hasValue(v));
    if (missing.length) problems.push(`${ENV_VAR[slot]} selects "${id}" but ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set`);
  }
  return problems;
}

/** Startup gate: returns the selection or throws ProviderConfigError listing every problem at once. */
export function validateProviderSelection(raw: RawProviderSelection, hasValue: (envVar: string) => boolean, nodeEnv: string): ProviderSelection {
  const { selection, problems } = resolveProviderSelection(raw);
  const all = [...problems, ...credentialProblems(selection, hasValue, nodeEnv)];
  if (all.length) throw new ProviderConfigError(all);
  return selection;
}

/** The credential variables a provider still lacks — NAMES only, never values. Empty for "none". */
export function missingCredentials(id: string, hasValue: (envVar: string) => boolean): string[] {
  if (id === "none") return [];
  return (REQUIRED_CREDENTIALS[id as keyof typeof REQUIRED_CREDENTIALS] ?? []).filter((v) => !hasValue(v));
}

export interface CapabilityAvailability {
  sms: boolean;
  email: boolean;
  push: boolean;
  courier: boolean;
  payments: { SSLCOMMERZ: boolean; EPS_PG: boolean };
}

/**
 * Phase 12 D-4: is each capability usable on this deployment — selected (not "none", and for gateways listed in
 * PAYMENT_GATEWAYS) AND its credentials present. The UI offers a provider action only when this is true; the store's
 * own business toggles (StoreSetting) still apply on top. Booleans only.
 */
export function capabilityAvailability(selection: ProviderSelection, hasValue: (envVar: string) => boolean): CapabilityAvailability {
  const ok = (id: string) => id !== "none" && missingCredentials(id, hasValue).length === 0;
  return {
    sms: ok(selection.sms),
    email: ok(selection.email),
    push: ok(selection.push),
    courier: ok(selection.courier),
    payments: {
      SSLCOMMERZ: selection.paymentGateways.includes("sslcommerz") && ok("sslcommerz"),
      EPS_PG: selection.paymentGateways.includes("eps") && ok("eps"),
    },
  };
}
