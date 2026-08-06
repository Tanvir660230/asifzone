import { z } from "zod";
import { nullableString } from "./common";

/** Body of the anonymous pageview beacon the storefront fires on every route change. `sessionId`
 * is a random id generated client-side and held for the browser session — never tied to a
 * customer account. `referrer`/`utm*` carry first-touch attribution captured once at session
 * start and re-sent unchanged on every later pageview in the same session. */
export const trackPageViewSchema = z.object({
  sessionId: z.string().min(1).max(64),
  path: z.string().min(1).max(500),
  referrer: nullableString(500),
  utmSource: nullableString(120),
  utmMedium: nullableString(120),
  utmCampaign: nullableString(120),
});

export type TrackPageViewInput = z.infer<typeof trackPageViewSchema>;
