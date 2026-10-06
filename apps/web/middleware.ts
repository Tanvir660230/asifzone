import { NextResponse, type NextRequest } from "next/server";
import { buildContentSecurityPolicy, createNonce } from "@/lib/security/csp";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const REDIRECT_REVALIDATE_SECONDS = 300;
const API_ORIGIN = new URL(API_URL).origin;

interface ActiveRedirect {
  fromPath: string;
  toPath: string;
  statusCode: number;
}

/** Admin-managed redirects (e.g. after a slug change) — fetched with Next's fetch cache so this is
 * one API call per revalidate window across all traffic, not one per request. A fetch failure (API
 * down, etc.) must never break the site, so it just falls through to normal routing. */
async function findActiveRedirect(pathname: string): Promise<ActiveRedirect | null> {
  try {
    const res = await fetch(`${API_URL}/api/redirects/active`, {
      next: { revalidate: REDIRECT_REVALIDATE_SECONDS },
    });
    if (!res.ok) return null;
    const { redirects } = (await res.json()) as { redirects: ActiveRedirect[] };
    return redirects.find((r) => r.fromPath === pathname) ?? null;
  } catch {
    return null;
  }
}

/** Browsers/crawlers request this well-known path directly, regardless of the <link rel="icon">
 * tags generateMetadata renders in layout.tsx — so once an admin uploads a custom favicon, this is
 * what keeps the literal /favicon.ico URL in sync with it instead of serving the bundled default
 * forever. (Next's app-router file conventions don't support a route handler at app/favicon.ico —
 * that path is always treated as the static icon file — so this has to live in middleware instead.)
 * Falls through to the static app/favicon.ico file whenever no custom favicon is configured, or the
 * API call fails. */
async function faviconRedirect(): Promise<NextResponse | null> {
  try {
    const res = await fetch(`${API_URL}/api/settings`, { next: { revalidate: REDIRECT_REVALIDATE_SECONDS } });
    if (!res.ok) return null;
    const { settings } = (await res.json()) as { settings: { faviconUrl: string | null } };
    return settings.faviconUrl ? NextResponse.redirect(settings.faviconUrl) : null;
  } catch {
    return null;
  }
}

/** Cheap presence check only — the API independently verifies the JWT signature on every request via requireAdmin/requireCustomer. This just keeps signed-out users off gated pages without a round trip. */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Content-Security-Policy with a fresh nonce on every page response (lib/security/csp.ts). Next reads the nonce from the
  // request's CSP header and stamps it on its own scripts. Redirects carry no page, so they skip it.
  const nonce = createNonce();
  const csp = buildContentSecurityPolicy({ nonce, apiOrigin: API_ORIGIN, isDev: process.env.NODE_ENV === "development" });
  const pass = () => {
    const headers = new Headers(req.headers);
    headers.set("x-nonce", nonce);
    headers.set("Content-Security-Policy", csp);
    const res = NextResponse.next({ request: { headers } });
    res.headers.set("Content-Security-Policy", csp);
    return res;
  };

  if (pathname === "/favicon.ico") {
    return (await faviconRedirect()) ?? pass();
  }

  const redirect = await findActiveRedirect(pathname);
  if (redirect) {
    return NextResponse.redirect(new URL(redirect.toPath, req.url), redirect.statusCode);
  }

  if (pathname.startsWith("/admin")) {
    // Same reasoning as /account/verify-email below — an admin accepting an invite may or may not
    // already have a different session, and the page must work either way.
    if (pathname === "/admin/accept-invite") {
      return pass();
    }

    const isLoginPage = pathname === "/admin/login";
    // refresh_token outlives access_token (7d vs 15m) — treating either as "has a session" avoids
    // bouncing to login on navigation right after the access token's short expiry, before the
    // client gets a chance to silently refresh it (see apiFetch in lib/api-client.ts).
    const hasSession = req.cookies.has("access_token") || req.cookies.has("refresh_token");

    if (!isLoginPage && !hasSession) {
      const loginUrl = new URL("/admin/login", req.url);
      loginUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(loginUrl);
    }

    if (isLoginPage && hasSession) {
      return NextResponse.redirect(new URL("/admin/dashboard", req.url));
    }

    return pass();
  }

  if (pathname.startsWith("/account")) {
    // Works the same whether the visitor is logged in (resending from the account banner) or not
    // (clicking the email link straight from a mail client, no session yet) — never gated or
    // bounced away either direction, unlike the auth pages below. /account/unsubscribe needs the
    // same treatment: it's a one-click link from a marketing email, almost always clicked while
    // logged out, and carries its own customerId/token query params that a login-redirect would drop.
    // /account/claim (Phase 11): the emailed link that proves an existing guest record's email — clicked while logged out.
    if (pathname === "/account/verify-email" || pathname === "/account/unsubscribe" || pathname === "/account/claim") {
      return pass();
    }

    const isAuthPage =
      pathname === "/account/login" ||
      pathname === "/account/register" ||
      pathname === "/account/forgot-password" ||
      pathname === "/account/reset-password";
    const hasSession =
      req.cookies.has("customer_access_token") || req.cookies.has("customer_refresh_token");

    if (!isAuthPage && !hasSession) {
      const loginUrl = new URL("/account/login", req.url);
      loginUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(loginUrl);
    }

    if (isAuthPage && hasSession) {
      return NextResponse.redirect(new URL("/account", req.url));
    }

    return pass();
  }

  return pass();
}

export const config = {
  // Runs on every page request (not just /admin and /account) so admin-managed redirects can
  // apply anywhere on the site — excludes static assets/Next internals, which never have redirects.
  // favicon.ico is deliberately included (unlike the others) so faviconRedirect above can intercept it.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
