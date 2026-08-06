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

/** Checkout/coupon endpoints — generous enough for real shoppers, tight enough to blunt scripted order or coupon-guessing floods. */
export const checkoutRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please slow down and try again shortly" },
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
