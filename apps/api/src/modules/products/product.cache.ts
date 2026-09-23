import { cacheDelByPrefix } from "../../config/redis";
import { env } from "../../config/env";
import { prisma } from "../../config/prisma";

/** Every cached product read (detail by slug, related rails, ...) lives under this prefix. */
export const PRODUCT_CACHE_PREFIX = "products:";

/** Kept separate from product.service so catalog config edits (which change how every product of a
 * type is presented) can bust the same cache without a circular import. */
export async function invalidateProductCache() {
  await cacheDelByPrefix(PRODUCT_CACHE_PREFIX);
}

export interface RevalidationContext {
  /** A single product's id — most call sites. */
  productId?: string;
  /** Its slug, if the caller already has the row in hand — skips a lookup. Always pass this when a
   * mutation hard-deletes the row (permanentlyDeleteProduct): there's nothing left to look up by then. */
  slug?: string;
  /** The slug it had before this save, when a rename/re-slug just happened — the old page's cache is
   * busted too, alongside the redirect that now covers it (see redirect.service.ts's upsertSlugRedirect). */
  previousSlug?: string;
  /** Several products at once (bulk delete / status / category). */
  productIds?: string[];
}

/** Fills in slugs for ids the caller didn't already have loaded, so a bulk/image-only mutation that
 * only knows ids still busts the right product-detail pages. Best-effort: an id that no longer exists
 * (already hard-deleted) just yields no slug for that id, which is correct — there's no live page left
 * to revalidate. */
async function resolveSlugs(context: RevalidationContext): Promise<string[]> {
  const known = new Set<string>();
  if (context.slug) known.add(context.slug);
  if (context.previousSlug) known.add(context.previousSlug);

  const idsNeedingLookup = [...(context.productId && !context.slug ? [context.productId] : []), ...(context.productIds ?? [])];
  if (idsNeedingLookup.length === 0) return [...known];

  const rows = await prisma.product.findMany({ where: { id: { in: idsNeedingLookup } }, select: { slug: true } });
  for (const row of rows) known.add(row.slug);
  return [...known];
}

/** Pure: the Next.js cache tags a change to these products/slugs should bust. `products:listing`
 * is always included — cheap to revalidate, and any product create/delete/status/category/price
 * change can shift what a listing or facet response shows. Deduped since `resolveSlugs` can hand
 * back the same slug the caller already passed in `slug`/`previousSlug`. */
export function buildRevalidationTags(ids: string[], slugs: string[]): string[] {
  return ["products:listing", ...new Set([...ids.map((id) => `product:${id}`), ...slugs.map((s) => `product:${s}`)])];
}

/** Tells the storefront app to drop specific Next.js fetch-cache entries right now, instead of
 * waiting out their normal revalidate window (see apps/web/lib/api/storefront.ts). Always fire-and-
 * forget from the caller's side: a failure here just means the page catches up within its usual
 * window, same as before this existed — it must never fail or slow down the admin's save. */
export async function triggerStorefrontRevalidation(context: RevalidationContext = {}) {
  if (!env.revalidateSecret) return; // not configured yet — the ISR window is the fallback

  const ids = [...(context.productId ? [context.productId] : []), ...(context.productIds ?? [])];
  const slugs = await resolveSlugs(context);
  const tags = buildRevalidationTags(ids, slugs);

  try {
    const res = await fetch(`${env.webInternalUrl}/api/revalidate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Revalidate-Secret": env.revalidateSecret },
      body: JSON.stringify({ tags }),
    });
    if (!res.ok) console.error(`[revalidate] storefront responded ${res.status} for tags`, tags);
  } catch (err) {
    console.error("[revalidate] storefront trigger failed:", err);
  }
}
