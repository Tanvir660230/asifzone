import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required("DATABASE_URL"),
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  jwtAccessSecret: required("JWT_ACCESS_SECRET", "dev-access-secret-change-me"),
  jwtRefreshSecret: required("JWT_REFRESH_SECRET", "dev-refresh-secret-change-me"),
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
};
