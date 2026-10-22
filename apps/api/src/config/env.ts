import "dotenv/config";
import { applyDatabaseUrlPolicy } from "./database-guard";
import { assertPaymentGatewayMode } from "../lib/provider-guard";
import { integrationSetting } from "./integration-overrides";

const nodeEnv = process.env.NODE_ENV ?? "development";
// Allowlist, not a "not production" denylist: staging/QA/a typo'd NODE_ENV value must fail
// closed and demand a real secret, not silently inherit a hardcoded one from source control.
// "test" stays allowed so a local/CI `vitest run` without a populated .env doesn't need secrets.
const allowsDevFallback = nodeEnv === "development" || nodeEnv === "test";

function required(name: string, devFallback?: string): string {
  const value = process.env[name];
  if (value) return value;
  if (allowsDevFallback && devFallback) return devFallback;
  throw new Error(
    `Missing required env var: ${name} (NODE_ENV="${nodeEnv}" does not allow the development fallback)`,
  );
}

// Refuses a non-loopback database outside production and isolates the demo mirror (see database-guard.ts) — before
// anything else reads process.env, since it may switch LIVE_PROVIDERS off.
const databaseUrl = required("DATABASE_URL");
applyDatabaseUrlPolicy(databaseUrl, nodeEnv);

// Live gateway endpoints only in production (provider-guard.ts): dev/test/demo stay on the sandboxes whatever credentials
// their .env holds.
const epsSandbox = process.env.EPS_SANDBOX !== "false";
const sslcommerzIsLive = process.env.SSLCOMMERZ_IS_LIVE === "true";
assertPaymentGatewayMode(nodeEnv, { epsLive: !epsSandbox, sslcommerzLive: sslcommerzIsLive });
const liveGatewayAllowed = nodeEnv === "production";

export const env = {
  nodeEnv,
  port: Number(process.env.PORT ?? 4000),
  databaseUrl,
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  jwtAccessSecret: required("JWT_ACCESS_SECRET", "dev-access-secret-change-me"),
  // Separate secrets for customer tokens so an admin and a customer token can never cross-verify.
  jwtCustomerAccessSecret: required("JWT_CUSTOMER_ACCESS_SECRET", "dev-customer-access-secret-change-me"),
  jwtCustomerRefreshSecret: required("JWT_CUSTOMER_REFRESH_SECRET", "dev-customer-refresh-secret-change-me"),
  accessTokenTtl: "15m",
  refreshTokenTtl: "7d",
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  apiOrigin: process.env.API_ORIGIN ?? "http://localhost:4000",
  // Where THIS container reaches the web app server-to-server (the on-demand revalidate call). Behind
  // docker-compose that's the internal service DNS name (`http://web:3000`, set in docker-compose.yml)
  // — WEB_ORIGIN is the *public* domain (used in emails etc.) and calling it from inside the api
  // container would depend on the VPS's NAT hairpinning back to itself, which isn't guaranteed to work.
  // Falls back to WEB_ORIGIN for local dev, where both apps run directly on the host and there's no
  // internal/public split.
  webInternalUrl: process.env.WEB_INTERNAL_URL ?? process.env.WEB_ORIGIN ?? "http://localhost:3000",
  // Optional — without it, a product change relies on the storefront's own 60s ISR window to show up
  // instead of appearing immediately. Must match the web app's REVALIDATE_SECRET (apps/web/.env).
  revalidateSecret: process.env.REVALIDATE_SECRET ?? "",
  uploadsDir: process.env.UPLOADS_DIR ?? "uploads",
  // Phase 11 (contract §6.5): optional bearer token for an external monitor polling GET /api/v1/ops/attention (counts only).
  // Unset = only an admin session with ops.read can read it.
  opsMonitorToken: process.env.OPS_MONITOR_TOKEN ?? "",
  // Integration credentials (below, through `providers`): a value saved in Settings › Integrations wins over the
  // environment variable of the same name (config/integration-overrides.ts), so each is a getter read at call time —
  // never copy one into a module-level constant. Live payment modes are production-only for dashboard values too.
  sslcommerz: {
    get storeId() { return integrationSetting("SSLCOMMERZ_STORE_ID"); },
    get storePassword() { return integrationSetting("SSLCOMMERZ_STORE_PASSWORD"); },
    get isLive() { return liveGatewayAllowed && integrationSetting("SSLCOMMERZ_IS_LIVE") === "true"; },
  },
  // Optional — without these, EPS_PG checkout returns a clear "could not start payment session"
  // error (see providers/payment/eps.ts's getEpsToken). hashKey is the base64 HMAC signing key EPS issues
  // alongside the username/password/merchantId/storeId — contact EPS support (info@eps.com.bd) for
  // sandbox or live credentials.
  eps: {
    get username() { return integrationSetting("EPS_USERNAME"); },
    get password() { return integrationSetting("EPS_PASSWORD"); },
    get hashKey() { return integrationSetting("EPS_HASH_KEY"); },
    get merchantId() { return integrationSetting("EPS_MERCHANT_ID"); },
    get storeId() { return integrationSetting("EPS_STORE_ID"); },
    get sandbox() { return !liveGatewayAllowed || integrationSetting("EPS_SANDBOX") !== "false"; },
  },
  // Optional — the AI Admin Assistant (product copy/SEO/marketing generation) stays fully inert,
  // returning a clear "not configured" error, until an admin sets this.
  anthropic: {
    get apiKey() { return integrationSetting("ANTHROPIC_API_KEY"); },
    get model() { return integrationSetting("ANTHROPIC_MODEL") || "claude-opus-5"; },
  },
  // Optional — the Social Inbox. Without the app secret every Meta webhook is refused (401); without a page / WhatsApp
  // token replies on that channel can't be sent (Settings › Integrations shows which is missing).
  metaInbox: {
    get appId() { return integrationSetting("META_APP_ID"); },
    get appSecret() { return integrationSetting("META_APP_SECRET"); },
    get webhookVerifyToken() { return integrationSetting("META_WEBHOOK_VERIFY_TOKEN"); },
    get pageId() { return integrationSetting("META_PAGE_ID"); },
    get pageAccessToken() { return integrationSetting("META_PAGE_ACCESS_TOKEN"); },
    get igAccountId() { return integrationSetting("META_IG_ACCOUNT_ID"); },
  },
  whatsapp: {
    get phoneNumberId() { return integrationSetting("WHATSAPP_PHONE_NUMBER_ID"); },
    get accessToken() { return integrationSetting("WHATSAPP_ACCESS_TOKEN"); },
    get wabaId() { return integrationSetting("WHATSAPP_WABA_ID"); },
  },
  inboxAi: {
    /** "factual" = the AI may send price / stock / delivery / order-status answers on its own; anything else = drafts only. */
    get autoReply(): "off" | "factual" { return integrationSetting("INBOX_AI_AUTOREPLY") === "factual" ? "factual" : "off"; },
  },
  // Optional — without an API key, sendMail() falls back to writing emails to .devmail/ instead
  // of actually sending them, so local dev and CI never need a real account.
  resend: {
    get apiKey() { return integrationSetting("RESEND_API_KEY"); },
    get fromAddress() { return integrationSetting("RESEND_FROM_ADDRESS") || "onboarding@resend.dev"; },
  },
  // Optional — without an API key, sendSms() logs instead of sending. Sender ID must be the
  // masking/name approved on the BulkSMSBD account, not the API key itself.
  bulkSmsBd: {
    get apiKey() { return integrationSetting("BULKSMSBD_API_KEY"); },
    get senderId() { return integrationSetting("BULKSMSBD_SENDER_ID"); },
  },
  // Optional — without VAPID keys, sendPush() logs instead of sending. Generate a pair from Settings › Integrations
  // (or `npx web-push generate-vapid-keys`).
  webPush: {
    get publicKey() { return integrationSetting("WEB_PUSH_PUBLIC_KEY"); },
    get privateKey() { return integrationSetting("WEB_PUSH_PRIVATE_KEY"); },
    get contactEmail() { return integrationSetting("WEB_PUSH_CONTACT_EMAIL") || "support@example.com"; },
  },
  // Optional — without a client ID, the Google sign-in button never renders and /customers/google
  // returns a clear "not configured" error.
  google: {
    get clientId() { return integrationSetting("GOOGLE_CLIENT_ID"); },
  },
  // Optional — Meta Conversions API (server-side Purchase events, see lib/meta/). Stays fully inert
  // until both pixelId and accessToken are set. Outside NODE_ENV=production it additionally refuses
  // to send anything unless testEventCode is set too, so a dev machine with a copied production
  // .env can only ever reach Events Manager's Test Events tab, never real conversion data. The
  // access token is server-only — never give it a NEXT_PUBLIC_ name.
  meta: {
    get pixelId() { return integrationSetting("META_PIXEL_ID"); },
    get accessToken() { return integrationSetting("META_ACCESS_TOKEN"); },
    get apiVersion() { return integrationSetting("META_API_VERSION") || "v24.0"; },
    get testEventCode() { return integrationSetting("META_TEST_EVENT_CODE"); },
  },
  // Optional — TikTok Events API (server-side Purchase, see lib/tiktok/). Same gate as Meta: inert until pixelId and
  // accessToken are set, and outside production it sends only with testEventCode (Events Manager › Test events).
  // The pixel id is the same one the browser pixel uses. The access token is server-only.
  tiktok: {
    get pixelId() { return integrationSetting("TIKTOK_PIXEL_ID"); },
    get accessToken() { return integrationSetting("TIKTOK_ACCESS_TOKEN"); },
    get testEventCode() { return integrationSetting("TIKTOK_TEST_EVENT_CODE"); },
  },
  // Optional — without an API key, "Book with Steadfast" returns a clear "not configured" error
  // instead of faking a booking. webhookToken is a shared secret of our own choosing (not issued
  // by Steadfast) since their delivery-status webhook carries no signature — it must be pasted
  // into the same URL configured as the Notify URL in the Steadfast merchant panel.
  steadfast: {
    get apiKey() { return integrationSetting("STEADFAST_API_KEY"); },
    get secretKey() { return integrationSetting("STEADFAST_SECRET_KEY"); },
    get baseUrl() { return integrationSetting("STEADFAST_BASE_URL") || "https://portal.packzy.com/api/v1"; },
    get webhookToken() { return integrationSetting("STEADFAST_WEBHOOK_TOKEN"); },
  },
  // Phase 12 W5 (docs/PHASE_12_IMPLEMENTATION_CONTRACT.md §15): which concrete provider backs each capability. Raw strings,
  // parsed and validated only by providers/selection.ts; unset or blank = today's behaviour (see DEFAULT_SELECTION there).
  providers: {
    paymentGateways: process.env.PAYMENT_GATEWAYS ?? "",
    sms: process.env.SMS_PROVIDER ?? "",
    email: process.env.EMAIL_PROVIDER ?? "",
    courier: process.env.COURIER_PROVIDER ?? "",
    push: process.env.PUSH_PROVIDER ?? "",
  },
};
