import { isStorefrontPath, type MetaBrowserEventInput } from "@clothing-brand/shared";
import { env } from "../../config/env";
import { getProviders } from "../../providers/registry";
import { logger } from "../observability/logger";
import { buildUserData, type MetaRequestContext, type MetaServerEvent } from "./capi";

/** The server twin of a browser Pixel event (every one except Purchase — see purchase.ts for that). The storefront
 * posts each event it tracks to /api/analytics/meta-event with the same eventID, and Meta keeps one of the pair: the
 * browser copy when it arrived, this one when an ad blocker, a closed tab or iOS dropped it. What it adds over the
 * Pixel is what only the request carries — IP, user agent and the Pixel's own _fbp/_fbc cookies, forwarded exactly
 * as the Pixel wrote them — plus the signed-in customer's id. */

interface BrowserEventOptions {
  context: MetaRequestContext;
  /** The signed-in customer's id, when a session cookie rode along — never taken from the request body. */
  externalId: string | null;
  webOrigin: string;
  now?: Date;
}

/** null = not a page of this store (another origin, or an admin/preview path), which is never reported. */
export function buildBrowserEvent(input: MetaBrowserEventInput, options: BrowserEventOptions): MetaServerEvent | null {
  let url: URL;
  try {
    url = new URL(input.eventSourceUrl);
  } catch {
    return null;
  }
  if (url.origin !== new URL(options.webOrigin).origin || !isStorefrontPath(url.pathname)) return null;

  const customer = input.customer ?? {};
  const customData = input.customData ?? {};
  return {
    event_name: input.eventName,
    event_time: Math.floor((options.now ?? new Date()).getTime() / 1000),
    event_id: input.eventId,
    action_source: "website",
    event_source_url: input.eventSourceUrl,
    user_data: buildUserData(
      {
        email: customer.email ?? null,
        phone: customer.phone ?? null,
        fullName: customer.fullName ?? null,
        city: customer.city ?? null,
        state: customer.state ?? null,
        externalId: options.externalId,
      },
      options.context,
    ),
    ...(Object.keys(customData).length > 0 ? { custom_data: customData } : {}),
  };
}

/** Fire-and-forget: the shopper's request never waits on Meta, and a failed send is only logged — a lost server copy
 * just leaves the browser copy to count on its own, which is what happened before this existed. */
export function relayBrowserEvent(input: MetaBrowserEventInput, options: Omit<BrowserEventOptions, "webOrigin" | "now">): void {
  const sink = getProviders().serverEvents;
  if (!sink.enabled()) return;
  const event = buildBrowserEvent(input, { ...options, webOrigin: env.webOrigin });
  if (!event) return;
  sink.send(event).catch((err: unknown) => {
    logger.warn(`[meta-capi] ${input.eventName} server copy not sent: ${err instanceof Error ? err.message : String(err)}`);
  });
}
