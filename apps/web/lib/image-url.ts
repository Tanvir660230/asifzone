import { mediaUrl } from "./runtime-config";

/** A stored image reference as the URL to render (Phase 1B): the domain-free `/uploads/…` reference, a bare storage key or
 * a legacy absolute upload URL all resolve against this installation's runtime media base (@clothing-brand/shared
 * resolveMediaUrl); `blob:`/`data:` previews (the admin wizard's staged photos) and external URLs pass through unchanged. */
export function resolveImageUrl(url: string): string {
  return mediaUrl(url);
}

/** The 300px rendition of an uploaded product photo (`…-full.webp` → `…-thumb.webp`; the API writes thumb/card/full for
 * every upload) — for small list thumbnails, so a 48px square doesn't download the 1600px original. Anything else
 * (logos, external URLs, `blob:` previews) resolves unchanged. Pair with <Thumbnail>, which falls back to the original. */
export function thumbnailUrl(url: string): string {
  return resolveImageUrl(url).replace(/-full\.webp(?=$|[?#])/, "-thumb.webp");
}
