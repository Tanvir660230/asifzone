/**
 * Portable media references (Phase 1B) — the ONE resolver from a stored media reference to the URL a browser, an email
 * or a crawler should load.
 *
 * Uploaded files live under the installation's uploads volume, served at the fixed mount `/uploads/`. What the database
 * stores is the domain-free reference `/uploads/<storage key>` (e.g. `/uploads/products/3f1c…-full.webp`): it carries no
 * host, so the same rows render unchanged on another domain, VPS or installation, and it still works as a plain `src`
 * (same-origin) in rich text and section JSON that never pass through this resolver.
 *
 * Accepted stored forms, all resolved against the runtime media base:
 *   - `products/x.webp`                              a bare storage key
 *   - `/uploads/products/x.webp`                     the canonical stored reference
 *   - `https://old-domain.example/uploads/products/x.webp` a legacy absolute URL (any host) — rendered from the CURRENT base,
 *                                                     so pre-Phase-1 rows keep working before and after the data migration
 * Anything else (an external https URL, `blob:`/`data:` previews) is returned unchanged.
 */

export const MEDIA_MOUNT = "/uploads";

const PASS_THROUGH = /^(blob:|data:)/i;
const ABSOLUTE = /^https?:\/\//i;

function trimSlashes(value: string): string {
  return value.replace(/^\/+/, "").replace(/\/+$/, "");
}

/** The storage key (`products/x.webp`) of an uploaded file reference, or null when the value is not one of ours. */
export function mediaStorageKey(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const value = ref.trim();
  if (!value || PASS_THROUGH.test(value)) return null;
  if (ABSOLUTE.test(value)) {
    // This package has no DOM/Node lib, so the pathname is taken without URL: scheme://host[:port] then the path.
    const pathname = /^https?:\/\/[^/?#]+(\/[^?#]*)?/i.exec(value)?.[1] ?? "";
    return pathname.startsWith(`${MEDIA_MOUNT}/`) ? trimSlashes(pathname.slice(MEDIA_MOUNT.length)) || null : null;
  }
  if (value.startsWith(`${MEDIA_MOUNT}/`)) return trimSlashes(value.slice(MEDIA_MOUNT.length)) || null;
  if (value.startsWith("/") || value.startsWith("//")) return null;
  return trimSlashes(value) || null;
}

/** The stored reference for a storage key — what an upload endpoint returns and the database keeps. */
export function mediaReference(storageKey: string): string {
  return `${MEDIA_MOUNT}/${trimSlashes(storageKey)}`;
}

/** The URL to load for a stored reference: `<base>/<storage key>`. `base` is the installation's runtime media base —
 * `/uploads` (same-origin, the default), `https://shop.example.com/uploads`, or a CDN origin serving the same keys. */
export function resolveMediaUrl(ref: string, base: string): string;
export function resolveMediaUrl(ref: string | null | undefined, base: string): string | null;
export function resolveMediaUrl(ref: string | null | undefined, base: string): string | null {
  if (ref == null) return null;
  const key = mediaStorageKey(ref);
  if (!key) return ref;
  const root = base.replace(/\/+$/, "");
  return `${root}/${key}`;
}

/** Rewrites absolute upload URLs on the given hosts (`shop.example.com`, `www.shop.example.com`, `203.0.113.7`, `localhost:4000`
 * — a host may carry a port) to the domain-free `/uploads/…` reference, anywhere inside a text value (plain URLs, rich
 * text HTML, serialized JSON). Used by the media-normalization script; hosts are explicit so a third party's
 * `/uploads/` path is never touched. */
export function normalizeMediaReferences(text: string, hosts: readonly string[]): string {
  if (!text || hosts.length === 0) return text;
  const alternatives = hosts.map((h) => h.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).filter(Boolean);
  if (alternatives.length === 0) return text;
  const pattern = new RegExp(`https?://(?:${alternatives.join("|")})(?=/uploads/)`, "gi");
  return text.replace(pattern, "");
}
