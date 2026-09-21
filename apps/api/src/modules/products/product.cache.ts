import { cacheDelByPrefix } from "../../config/redis";

/** Every cached product read (detail by slug, related rails, ...) lives under this prefix. */
export const PRODUCT_CACHE_PREFIX = "products:";

/** Kept separate from product.service so catalog config edits (which change how every product of a
 * type is presented) can bust the same cache without a circular import. */
export async function invalidateProductCache() {
  await cacheDelByPrefix(PRODUCT_CACHE_PREFIX);
}
