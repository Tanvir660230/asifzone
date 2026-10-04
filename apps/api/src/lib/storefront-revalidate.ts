import { env } from "../config/env";
import { logger } from "./observability/logger";
import { captureError } from "./observability/error-capture";

/** Next.js fetch-cache tag the storefront puts on its `/api/settings` read (apps/web/lib/api/storefront.ts). */
export const SETTINGS_CACHE_TAG = "settings";

/** Tells the storefront app to drop specific Next.js fetch-cache tags right now, instead of waiting out their normal
 * revalidate window (see apps/web/lib/api/storefront.ts). Always fire-and-forget from the caller's side: a failure here
 * just means the page catches up within its usual window — it must never fail or slow down the admin's save. */
export async function revalidateStorefrontTags(tags: string[]): Promise<void> {
  if (!env.revalidateSecret || tags.length === 0) return; // not configured yet — the ISR window is the fallback
  try {
    const res = await fetch(`${env.webInternalUrl}/api/revalidate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Revalidate-Secret": env.revalidateSecret },
      body: JSON.stringify({ tags }),
    });
    if (!res.ok) logger.error(`[revalidate] storefront responded ${res.status} for tags`, { detail: tags });
  } catch (err) {
    captureError(err, { msg: "[revalidate] storefront trigger failed:" });
  }
}
