/**
 * Empties Next's on-disk data cache (.next/cache/fetch-cache) before the e2e web server starts.
 *
 * That cache survives `next build` and server restarts. Storefront fetches are served stale-while-revalidate
 * (lib/api/storefront.ts), so after the database under test is reset and reseeded (same slugs, new ids) the first
 * product page would render a product id that no longer exists, and anything it posts (e.g. add to wishlist) gets
 * a 404. The e2e storefront must reflect the database under test, so it starts with no cached data.
 */
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", ".next", "cache", "fetch-cache");
rmSync(dir, { recursive: true, force: true });
console.log(`[e2e] cleared Next data cache: ${dir}`);
