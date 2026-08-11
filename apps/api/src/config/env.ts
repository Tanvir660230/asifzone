import "dotenv/config";

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

export const env = {
  nodeEnv,
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required("DATABASE_URL"),
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  jwtAccessSecret: required("JWT_ACCESS_SECRET", "dev-access-secret-change-me"),
  // Separate secrets for customer tokens so an admin and a customer token can never cross-verify.
  jwtCustomerAccessSecret: required("JWT_CUSTOMER_ACCESS_SECRET", "dev-customer-access-secret-change-me"),
  jwtCustomerRefreshSecret: required("JWT_CUSTOMER_REFRESH_SECRET", "dev-customer-refresh-secret-change-me"),
  accessTokenTtl: "15m",
  refreshTokenTtl: "7d",
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  apiOrigin: process.env.API_ORIGIN ?? "http://localhost:4000",
  uploadsDir: process.env.UPLOADS_DIR ?? "uploads",
  sslcommerz: {
    storeId: process.env.SSLCOMMERZ_STORE_ID ?? "",
    storePassword: process.env.SSLCOMMERZ_STORE_PASSWORD ?? "",
    isLive: process.env.SSLCOMMERZ_IS_LIVE === "true",
  },
  // Optional — the AI Admin Assistant (product copy/SEO/marketing generation) stays fully inert,
  // returning a clear "not configured" error, until an admin sets this.
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY ?? "",
    model: process.env.ANTHROPIC_MODEL ?? "claude-opus-5",
  },
  // Optional — without an API key, sendMail() falls back to writing emails to .devmail/ instead
  // of actually sending them, so local dev and CI never need a real account.
  resend: {
    apiKey: process.env.RESEND_API_KEY ?? "",
    fromAddress: process.env.RESEND_FROM_ADDRESS ?? "onboarding@resend.dev",
  },
  // Optional — without an API key, sendSms() logs instead of sending. Sender ID must be the
  // masking/name approved on the BulkSMSBD account, not the API key itself.
  bulkSmsBd: {
    apiKey: process.env.BULKSMSBD_API_KEY ?? "",
    senderId: process.env.BULKSMSBD_SENDER_ID ?? "",
  },
  // Optional — without VAPID keys, sendPush() logs instead of sending. Generate a pair with
  // `npx web-push generate-vapid-keys`.
  webPush: {
    publicKey: process.env.WEB_PUSH_PUBLIC_KEY ?? "",
    privateKey: process.env.WEB_PUSH_PRIVATE_KEY ?? "",
    contactEmail: process.env.WEB_PUSH_CONTACT_EMAIL ?? "support@example.com",
  },
  // Optional — without a client ID, the Google sign-in button never renders and /customers/google
  // returns a clear "not configured" error.
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
  },
  // Optional — without an API key, "Book with Steadfast" returns a clear "not configured" error
  // instead of faking a booking. webhookToken is a shared secret of our own choosing (not issued
  // by Steadfast) since their delivery-status webhook carries no signature — it must be pasted
  // into the same URL configured as the Notify URL in the Steadfast merchant panel.
  steadfast: {
    apiKey: process.env.STEADFAST_API_KEY ?? "",
    secretKey: process.env.STEADFAST_SECRET_KEY ?? "",
    baseUrl: process.env.STEADFAST_BASE_URL ?? "https://portal.packzy.com/api/v1",
    webhookToken: process.env.STEADFAST_WEBHOOK_TOKEN ?? "",
  },
};
