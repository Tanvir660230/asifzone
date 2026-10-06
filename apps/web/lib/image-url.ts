import { mediaUrl } from "./runtime-config";

/** A stored image reference as the URL to render (Phase 1B): the domain-free `/uploads/…` reference, a bare storage key or
 * a legacy absolute upload URL all resolve against this installation's runtime media base (@clothing-brand/shared
 * resolveMediaUrl); `blob:`/`data:` previews (the admin wizard's staged photos) and external URLs pass through unchanged. */
export function resolveImageUrl(url: string): string {
  return mediaUrl(url);
}
