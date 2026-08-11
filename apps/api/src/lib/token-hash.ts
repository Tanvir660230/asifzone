import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** SHA-256 hash of an opaque token before it's stored/looked-up — used for password-reset,
 * email-verification, and refresh-token rows so the raw token value is never persisted (mirrors
 * password hashing: a DB leak doesn't hand out directly-usable tokens). Shared by auth.service.ts
 * (admin refresh tokens) and customer.service.ts (customer refresh/reset/verification tokens). */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** HMAC-SHA256 of `payload` under `secret` — for stateless, unexpiring links (e.g. one-click email
 * unsubscribe) where storing/expiring a token row isn't worth it: anyone holding the secret can
 * recompute the same value, so it doubles as a verifier with no DB round-trip. */
export function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** Timing-safe string equality for comparing secrets/tokens (CSRF double-submit, HMAC
 * verification) — a plain `===` leaks how many leading characters matched via response timing. */
export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
