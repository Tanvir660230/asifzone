import { z } from "zod";
import { nullableString } from "./common";

/** Body of the anonymous pageview beacon the storefront fires on every route change. `sessionId`
 * is a random id generated client-side and held for the browser session — never tied to a
 * customer account. `referrer`/`utm*` carry first-touch attribution captured once at session
 * start and re-sent unchanged on every later pageview in the same session. */
export const trackPageViewSchema = z.object({
  sessionId: z.string().min(1).max(64),
  /** Persistent (1yr cookie) visitor id, distinct from `sessionId` — lets "returning visitor"
   * metrics recognize the same person across browser sessions. Optional so older clients that
   * haven't picked up the cookie yet don't fail validation. */
  visitorId: z.string().min(1).max(64).optional(),
  path: z.string().min(1).max(500),
  referrer: nullableString(500),
  utmSource: nullableString(120),
  utmMedium: nullableString(120),
  utmCampaign: nullableString(120),
});

export type TrackPageViewInput = z.infer<typeof trackPageViewSchema>;

/** Body of the "exit" beacon fired (via navigator.sendBeacon) when a visitor leaves a page whose
 * pageview was already recorded — carries engagement data that can only be known once the visit to
 * that page is over. Bounds exist purely to stop a public, unauthenticated endpoint from being fed
 * garbage (a scripted flood, not a real browsing session, could otherwise post an hour-long
 * "duration" on every request). */
export const trackPageExitSchema = z.object({
  durationMs: z.coerce.number().int().min(0).max(3_600_000),
  scrollDepthPct: z.coerce.number().int().min(0).max(100),
  clickCount: z.coerce.number().int().min(0).max(10_000),
});

export type TrackPageExitInput = z.infer<typeof trackPageExitSchema>;

/** Body of the funnel-event beacon — the two purchase-journey steps (Section 3 BI) that have no
 * other trace anywhere: picking a product variant, and adding to cart (guest add-to-cart
 * especially, which never touches the Cart table at all). `productId`/`variantId` are optional
 * since not every future event type will carry both. */
export const trackFunnelEventSchema = z.object({
  sessionId: z.string().min(1).max(64),
  visitorId: z.string().min(1).max(64).optional(),
  type: z.enum(["VARIANT_SELECTED", "ADD_TO_CART"]),
  productId: nullableString(64),
  variantId: nullableString(64),
  path: nullableString(500),
});

export type TrackFunnelEventInput = z.infer<typeof trackFunnelEventSchema>;

/** Body of the search-session correlation beacon (Section 4 BI) — fired once the search-results
 * page has rendered, to best-effort attach a session/visitor id to the SearchLog row that
 * `listStorefrontProducts` already created for this exact query text. See attributeSearchSession
 * in analytics.service.ts for how the match (and its small false-positive tolerance) works. */
export const attributeSearchSessionSchema = z.object({
  sessionId: z.string().min(1).max(64),
  visitorId: z.string().min(1).max(64).optional(),
  query: z.string().min(1).max(200),
});

export type AttributeSearchSessionInput = z.infer<typeof attributeSearchSessionSchema>;

/** Shared by every admin analytics GET endpoint that takes a lookback window and/or a result cap
 * — bounded so an admin session (compromised or otherwise) can't force an unbounded SQL LIMIT or
 * an absurdly wide date-range aggregation. Both optional since not every endpoint uses both, and
 * each controller applies its own default when omitted. */
export const analyticsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;
