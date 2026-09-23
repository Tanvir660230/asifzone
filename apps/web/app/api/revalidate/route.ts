import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";

/** Server-to-server only — the API calls this right after a product mutation so the storefront's
 * Next.js data cache doesn't have to wait out its own revalidate window (see lib/api/storefront.ts's
 * `storefrontFetch`) to show the change. Never called from the browser: there's no secret a client
 * bundle could hold that wouldn't just be public.
 *
 * Fails safe in both directions: if `REVALIDATE_SECRET` isn't set on this side, every request is
 * refused (503, not a silent no-op) so a misconfigured deploy is loud, not just slow; the API's own
 * caller already treats an unset secret there as "feature not on yet" and skips calling this at all,
 * and treats any non-2xx response here as best-effort-failed — either way the page still catches up
 * on its own within the normal ISR window, so a broken/unset secret degrades to today's behavior
 * rather than breaking anything. */
export async function POST(req: Request) {
  if (!env.revalidateSecret) {
    return NextResponse.json({ error: "REVALIDATE_SECRET is not configured" }, { status: 503 });
  }
  if (req.headers.get("X-Revalidate-Secret") !== env.revalidateSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let tags: unknown;
  try {
    ({ tags } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(tags) || tags.some((t) => typeof t !== "string") || tags.length === 0) {
    return NextResponse.json({ error: "`tags` must be a non-empty string array" }, { status: 400 });
  }

  for (const tag of tags as string[]) revalidateTag(tag);
  return NextResponse.json({ revalidated: tags });
}
