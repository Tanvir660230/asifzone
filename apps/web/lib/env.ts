export const env = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000",
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  vapidPublicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "",
  googleClientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "",
  // Server-only (no NEXT_PUBLIC_ prefix — must never reach the client bundle). Must match the API's
  // REVALIDATE_SECRET (apps/api/.env). Checked by app/api/revalidate/route.ts.
  revalidateSecret: process.env.REVALIDATE_SECRET ?? "",
};
