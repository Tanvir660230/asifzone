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
