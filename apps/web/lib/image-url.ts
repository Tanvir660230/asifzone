import { env } from "./env";

/** Product image URLs used to be stored relative to the API origin; newer uploads store an
 * absolute URL directly (matching banner/category/logo images). Handles both so older rows
 * keep rendering correctly after the switch. */
export function resolveImageUrl(url: string): string {
  // blob:/data: are in-browser images not uploaded yet (the admin wizard's preview of staged photos) — already usable as-is.
  if (url.startsWith("http") || url.startsWith("blob:") || url.startsWith("data:")) return url;
  return `${env.apiUrl}${url}`;
}
