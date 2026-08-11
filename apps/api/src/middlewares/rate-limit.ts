import rateLimit from "express-rate-limit";

/** Admin login — narrow window, low ceiling on *failed* attempts, so credential-stuffing gets throttled hard without locking out a real admin who just typed their own password correctly (skipSuccessfulRequests: a legitimate login never counts against the limit). */
export const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: "Too many login attempts, please try again later" },
});

/** Generic low-stakes public POSTs (bundle preview, contact feedback, newsletter signup) — one
 * shared budget is fine here since none of them block a customer from completing a purchase. */
export const checkoutRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please slow down and try again shortly" },
});

/** Separate limiters (not one shared instance) for order-create, order-track, and coupon-validate:
 * each is IP-keyed, so a shopper trying a few coupon codes at checkout must not eat into the same
 * budget that gates actually placing or tracking their order — that used to be able to lock a real
 * customer out of finishing checkout over nothing more than a typo'd coupon code. */
export const orderCreateRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many orders placed, please slow down and try again shortly" },
});

export const orderTrackRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many tracking requests, please slow down and try again shortly" },
});

export const couponValidateRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many coupon checks, please slow down and try again shortly" },
});

/** Public, unauthenticated tracking beacons (pageviews, product views) — high-frequency by design
 * (fires on every navigation), so the ceiling is generous; it exists only to blunt a scripted flood
 * writing rows faster than any real browsing session could. */
export const trackingRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests" },
});

/** AI generation calls a real, metered Claude API — already admin-only, but still capped so a
 * compromised admin session or a buggy retry loop can't run up an unbounded bill. */
export const aiRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many AI requests, please slow down and try again shortly" },
});

/** SSLCommerz callback routes (success/fail/cancel/ipn) — unauthenticated by design (the gateway
 * calls these directly), and success/ipn each trigger an outbound validation call to SSLCommerz
 * keyed off an attacker-suppliable val_id. Generous enough for the gateway's own retries/redirects
 * on a single real checkout, tight enough to blunt a scripted flood of junk val_id values. */
export const paymentCallbackRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again shortly" },
});

/** Steadfast's delivery-status webhook — unauthenticated by design (Steadfast calls this directly)
 * and, since Steadfast doesn't sign payloads, each call also triggers an outbound re-verification
 * call back to Steadfast's own status API keyed off an attacker-suppliable consignment id. Same
 * shape as paymentCallbackRateLimit for the same reason. */
export const courierWebhookRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again shortly" },
});

/** Every *successful* call here sends a real, metered SMS — deliberately NOT skipSuccessfulRequests
 * (unlike loginRateLimit) since a success is exactly the expensive case this needs to cap, not the
 * harmless one. Tighter ceiling than the other limiters for the same reason. */
export const otpRequestRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many codes requested, please try again later" },
});
