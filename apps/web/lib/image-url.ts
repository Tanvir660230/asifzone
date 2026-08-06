import { env } from "./env";

/** Product image URLs used to be stored relative to the API origin; newer uploads store an
 * absolute URL directly (matching banner/category/logo images). Handles both so older rows
 * keep rendering correctly after the switch. */
export function resolveImageUrl(url: string): string {
  return url.startsWith("http") ? url : `${env.apiUrl}${url}`;
}
