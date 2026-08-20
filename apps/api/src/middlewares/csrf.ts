import type { NextFunction, Request, Response } from "express";
import { AppError } from "../lib/app-error";
import { CUSTOMER_ACCESS_COOKIE } from "../lib/cookies";
import { constantTimeEqual } from "../lib/token-hash";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Auth "bootstrap" endpoints — they authenticate with their own credentials (password, Google
 * idToken, OTP, refresh token, invite token) rather than trusting an existing session's ambient
 * authority, so a forged cross-site call to them can't do anything a stolen cookie value alone
 * wouldn't already require. They must stay reachable even when the browser is carrying a stale/dead
 * `access_token` or `customer_access_token` cookie from an earlier session (e.g. one invalidated
 * server-side, or left over without a matching `csrf_token`) — otherwise the presence-based skip
 * below wrongly locks the user out of the very endpoint that would fix their session, and login
 * fails with "Invalid or missing CSRF token" instead of just... logging in. */
const CSRF_EXEMPT_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/google",
  "/api/auth/logout",
  "/api/auth/refresh",
  "/api/auth/admin-invites/accept",
  "/api/customers/register",
  "/api/customers/login",
  "/api/customers/logout",
  "/api/customers/refresh",
  "/api/customers/forgot-password",
  "/api/customers/reset-password",
  "/api/customers/verify-email",
  "/api/customers/unsubscribe",
  "/api/customers/google",
  "/api/customers/otp/request",
  "/api/customers/otp/verify",
  "/api/analytics/funnel-event",
]);

/** Same trust model as CSRF_EXEMPT_PREFIX below: a public, rate-limited, fire-and-forget beacon
 * that only increments a view counter on one already-identified product, so a forged cross-site
 * call can't do anything the endpoint doesn't already let any caller do. Frontend sends it via a
 * plain `fetch(..., { method: "POST" })` with no credentials/CSRF pairing (lib/api/storefront.ts's
 * logProductView), which trips this check for any caller with a live session cookie riding along —
 * exemption matches what the endpoint already trusts anyone to do. Matched by regex since the
 * product id segment is dynamic. */
const PRODUCT_VIEW_PATH = /^\/api\/products\/[^/]+\/view$/;

/** Matched by prefix, not the exact-path Set above, since the pageview id segment is dynamic
 * (`/api/analytics/pageview/:id/exit`). Exempt for a different reason than the auth-bootstrap
 * paths above: this beacon requires no cookie-based session authority to act at all — it's public
 * by design, rate-limited, and only ever updates bounded engagement numbers on one already-existing
 * anonymous PageView row by its unguessable id, so a forged cross-site call can't do anything the
 * endpoint doesn't already let any caller do. It's also fired via navigator.sendBeacon on page
 * unload (see lib/analytics.ts's sendPageExit), which structurally cannot attach a custom
 * X-CSRF-Token header — exemption is the only option here, not just the simplest one. Read
 * requests to this same PageView beacon family (POST /pageview itself) still go through the
 * `credentials: "include"` + X-CSRF-Token pairing like any other authenticated-aware POST, since
 * that one *is* sent via fetch and can carry the header. */
const CSRF_EXEMPT_PREFIX = "/api/analytics/pageview/";

/** Double-submit cookie check. The `csrf_token` cookie is deliberately not httpOnly — the frontend
 * reads it and echoes it back as a header, which a cross-site attacker can't do (they can't read our
 * cookies). SameSite=strict on the auth cookies already blocks most cross-site sends, so this is
 * defense-in-depth for the request shapes that slip past it (e.g. same-site subdomains). Requests with
 * no session cookie yet (login) have nothing to protect and are skipped — checked for both the admin
 * (`access_token`) and customer (`customer_access_token`) cookie, since either one means there's a
 * live session this request could be forging on behalf of. */
export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (CSRF_EXEMPT_PATHS.has(req.path)) return next();
  if (req.path.startsWith(CSRF_EXEMPT_PREFIX)) return next();
  if (PRODUCT_VIEW_PATH.test(req.path)) return next();
  if (!req.cookies?.access_token && !req.cookies?.[CUSTOMER_ACCESS_COOKIE]) return next();

  const cookieToken = req.cookies?.csrf_token as string | undefined;
  const headerToken = req.headers["x-csrf-token"] as string | undefined;

  if (!cookieToken || !headerToken || !constantTimeEqual(cookieToken, headerToken)) {
    return next(AppError.forbidden("Invalid or missing CSRF token"));
  }
  next();
}
