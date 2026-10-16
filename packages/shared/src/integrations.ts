import { z } from "zod";
import type { PublicRuntimeConfig } from "./runtime-config";

/**
 * Dashboard-managed integrations — the third-party credentials and ids an OWNER sets from Settings › Integrations instead
 * of the server's environment. Every installation keeps its own values in its own
 * database; a value saved here wins over the environment variable of the same name, and clearing it falls back to that
 * variable again. Keys ARE the environment variable names, so the provider registry and docs keep one vocabulary.
 *
 * Infrastructure stays in the environment on purpose (database, Redis, JWT secrets, origins, INSTALL_ID, theme): a store
 * must be able to boot and reach its own database before it can read anything from it.
 */

export type IntegrationFieldKind = "text" | "secret" | "select";

export interface IntegrationField {
  key: string;
  label: string;
  kind: IntegrationFieldKind;
  /** Short help under the field. */
  help?: string;
  placeholder?: string;
  options?: ReadonlyArray<{ value: string; label: string }>;
  /** A credential the integration cannot work without. */
  required?: boolean;
}

export type IntegrationGroup = "payments" | "courier" | "messaging" | "marketing" | "signin" | "ai";

export interface IntegrationDefinition {
  id: string;
  name: string;
  group: IntegrationGroup;
  description: string;
  /** Where the owner gets these values. */
  docsHint: string;
  fields: readonly IntegrationField[];
}

export const INTEGRATION_GROUP_LABELS: Readonly<Record<IntegrationGroup, string>> = {
  payments: "Online payments",
  courier: "Courier",
  messaging: "SMS, email & push",
  marketing: "Ads & analytics",
  signin: "Customer sign-in",
  ai: "AI assistant",
};

const SANDBOX_LIVE_SSL = [
  { value: "false", label: "Sandbox (test payments)" },
  { value: "true", label: "Live (real payments)" },
] as const;
const SANDBOX_LIVE_EPS = [
  { value: "true", label: "Sandbox (test payments)" },
  { value: "false", label: "Live (real payments)" },
] as const;

export const INTEGRATIONS: readonly IntegrationDefinition[] = [
  {
    id: "sslcommerz",
    name: "SSLCommerz",
    group: "payments",
    description: "Cards, bKash, Nagad and bank payments at checkout.",
    docsHint: "SSLCommerz merchant panel › API credentials",
    fields: [
      { key: "SSLCOMMERZ_STORE_ID", label: "Store ID", kind: "text", required: true },
      { key: "SSLCOMMERZ_STORE_PASSWORD", label: "Store password", kind: "secret", required: true },
      { key: "SSLCOMMERZ_IS_LIVE", label: "Mode", kind: "select", options: SANDBOX_LIVE_SSL, help: "Use Sandbox until test payments work end to end." },
    ],
  },
  {
    id: "eps",
    name: "EPS",
    group: "payments",
    description: "EPS payment gateway at checkout.",
    docsHint: "Issued by EPS support (info@eps.com.bd)",
    fields: [
      { key: "EPS_MERCHANT_ID", label: "Merchant ID", kind: "text", required: true },
      { key: "EPS_STORE_ID", label: "Store ID", kind: "text", required: true },
      { key: "EPS_USERNAME", label: "Username", kind: "text", required: true },
      { key: "EPS_PASSWORD", label: "Password", kind: "secret", required: true },
      { key: "EPS_HASH_KEY", label: "Hash key", kind: "secret", required: true },
      { key: "EPS_SANDBOX", label: "Mode", kind: "select", options: SANDBOX_LIVE_EPS, help: "Use Sandbox until test payments work end to end." },
    ],
  },
  {
    id: "steadfast",
    name: "Steadfast",
    group: "courier",
    description: "Book parcels, track delivery status and check a customer's delivery record.",
    docsHint: "Steadfast merchant panel › API",
    fields: [
      { key: "STEADFAST_API_KEY", label: "API key", kind: "secret", required: true },
      { key: "STEADFAST_SECRET_KEY", label: "Secret key", kind: "secret", required: true },
      {
        key: "STEADFAST_WEBHOOK_TOKEN",
        label: "Status webhook token",
        kind: "secret",
        help: "A password of your own for the delivery-status webhook. Generate one, then paste the webhook URL into Steadfast › Notify URL.",
      },
    ],
  },
  {
    id: "bulksmsbd",
    name: "BulkSMSBD",
    group: "messaging",
    description: "Order SMS to customers and alerts to staff.",
    docsHint: "BulkSMSBD dashboard › API",
    fields: [
      { key: "BULKSMSBD_API_KEY", label: "API key", kind: "secret", required: true },
      { key: "BULKSMSBD_SENDER_ID", label: "Sender ID", kind: "text", required: true, help: "The approved sender name or number, not the API key." },
    ],
  },
  {
    id: "resend",
    name: "Resend",
    group: "messaging",
    description: "Order and account emails.",
    docsHint: "resend.com › API Keys (verify your domain first)",
    fields: [
      { key: "RESEND_API_KEY", label: "API key", kind: "secret", required: true },
      { key: "RESEND_FROM_ADDRESS", label: "From address", kind: "text", placeholder: "Store Name <orders@yourdomain.com>" },
    ],
  },
  {
    id: "webpush",
    name: "Web push",
    group: "messaging",
    description: "Browser notifications for customers who opt in.",
    docsHint: "Generate a key pair here — no outside account needed",
    fields: [
      { key: "WEB_PUSH_PUBLIC_KEY", label: "Public key", kind: "text", required: true },
      { key: "WEB_PUSH_PRIVATE_KEY", label: "Private key", kind: "secret", required: true },
      { key: "WEB_PUSH_CONTACT_EMAIL", label: "Contact email", kind: "text", placeholder: "support@yourdomain.com" },
    ],
  },
  {
    id: "meta",
    name: "Meta (Facebook) Pixel",
    group: "marketing",
    description: "Pixel in the browser plus server-side purchase events (Conversions API).",
    docsHint: "Meta Events Manager › Data sources › your pixel › Settings",
    fields: [
      { key: "META_PIXEL_ID", label: "Pixel ID", kind: "text", required: true },
      { key: "META_ACCESS_TOKEN", label: "Conversions API access token", kind: "secret", help: "Optional. Adds server-side purchase events." },
      { key: "META_TEST_EVENT_CODE", label: "Test event code", kind: "text", help: "Only while testing in Events Manager › Test events. Leave blank otherwise." },
    ],
  },
  {
    id: "tiktok",
    name: "TikTok Pixel",
    group: "marketing",
    description: "Pixel in the browser plus server-side purchase events (Events API).",
    docsHint: "TikTok Ads Manager › Tools › Events › Web events › your pixel › Settings",
    fields: [
      { key: "TIKTOK_PIXEL_ID", label: "Pixel ID", kind: "text", required: true },
      { key: "TIKTOK_ACCESS_TOKEN", label: "Events API access token", kind: "secret", help: "Optional. Adds server-side purchase events (Settings › Events API › Generate access token)." },
      { key: "TIKTOK_TEST_EVENT_CODE", label: "Test event code", kind: "text", help: "Only while testing in Events Manager › Test events. Leave blank otherwise." },
    ],
  },
  {
    id: "clarity",
    name: "Microsoft Clarity",
    group: "marketing",
    description: "Heatmaps and session recordings, after the shopper accepts tracking.",
    docsHint: "clarity.microsoft.com › Settings › Overview › Project ID",
    fields: [{ key: "CLARITY_ID", label: "Project ID", kind: "text", required: true }],
  },
  {
    id: "google",
    name: "Google sign-in",
    group: "signin",
    description: "\"Continue with Google\" for customers and invited staff.",
    docsHint: "Google Cloud console › APIs & Services › Credentials › OAuth client ID (Web)",
    fields: [{ key: "GOOGLE_CLIENT_ID", label: "OAuth client ID", kind: "text", required: true, placeholder: "…apps.googleusercontent.com" }],
  },
  {
    id: "anthropic",
    name: "Claude (Anthropic)",
    group: "ai",
    description: "AI assistant for product copy, SEO and marketing text.",
    docsHint: "console.anthropic.com › API keys",
    fields: [
      { key: "ANTHROPIC_API_KEY", label: "API key", kind: "secret", required: true },
      { key: "ANTHROPIC_MODEL", label: "Model", kind: "text", placeholder: "claude-opus-5", help: "Leave blank for the default." },
    ],
  },
];

export const INTEGRATION_FIELDS: ReadonlyMap<string, IntegrationField> = new Map(
  INTEGRATIONS.flatMap((integration) => integration.fields.map((field) => [field.key, field] as const)),
);

export const INTEGRATION_KEYS = [...INTEGRATION_FIELDS.keys()];

/** Ids the browser needs (pixels, sign-in, push) — served on the public settings endpoint, never a secret. */
export const PUBLIC_INTEGRATION_KEYS = {
  metaPixelId: "META_PIXEL_ID",
  tiktokPixelId: "TIKTOK_PIXEL_ID",
  clarityId: "CLARITY_ID",
  googleClientId: "GOOGLE_CLIENT_ID",
  vapidPublicKey: "WEB_PUSH_PUBLIC_KEY",
} as const;

export type PublicIntegrationIds = { [K in keyof typeof PUBLIC_INTEGRATION_KEYS]: string };

/** The installation's public runtime config with the dashboard's ids laid over it: a dashboard value wins, a blank one leaves
 * the environment's value in place. */
export function mergePublicIntegrationIds(config: PublicRuntimeConfig, ids: Partial<PublicIntegrationIds> | null | undefined): PublicRuntimeConfig {
  if (!ids) return config;
  const merged = { ...config };
  for (const field of Object.keys(PUBLIC_INTEGRATION_KEYS) as (keyof PublicIntegrationIds)[]) {
    const value = ids[field]?.trim();
    if (value) merged[field] = value;
  }
  return merged;
}

/** `null` clears the dashboard value (the environment variable, if any, applies again). */
export const updateIntegrationsSchema = z.object({
  values: z
    .record(z.string(), z.string().trim().max(4096).nullable())
    .refine((values) => Object.keys(values).length > 0, "Nothing to save")
    .refine((values) => Object.keys(values).every((key) => INTEGRATION_FIELDS.has(key)), "Unknown integration setting")
    .refine(
      (values) =>
        Object.entries(values).every(([key, value]) => {
          const options = INTEGRATION_FIELDS.get(key)?.options;
          return !options || value === null || value === "" || options.some((o) => o.value === value);
        }),
      "Unknown option",
    ),
});

export type UpdateIntegrationsInput = z.infer<typeof updateIntegrationsSchema>;

/** Where a field's effective value comes from. */
export type IntegrationValueSource = "dashboard" | "server" | "none";

export interface IntegrationFieldState {
  key: string;
  source: IntegrationValueSource;
  /** The value for text/select fields. Secrets never leave the API — only `hint` (last 4 characters). */
  value: string | null;
  hint: string | null;
  /** A dashboard value exists but cannot be decrypted (the server's encryption key changed) — re-enter it. */
  unreadable?: boolean;
}

export interface IntegrationState {
  id: string;
  /** Every required field has a value. */
  configured: boolean;
  fields: IntegrationFieldState[];
}

export interface IntegrationsView {
  integrations: IntegrationState[];
  /** Base of the Steadfast Notify URL (append the webhook token). */
  steadfastWebhookUrl: string;
}
