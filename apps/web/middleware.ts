import { NextResponse, type NextRequest } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const REDIRECT_REVALIDATE_SECONDS = 300;

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

/** Cheap presence check only — the API independently verifies the JWT signature on every request via requireAdmin/requireCustomer. This just keeps signed-out users off gated pages without a round trip. */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const redirect = await findActiveRedirect(pathname);
  if (redirect) {
    return NextResponse.redirect(new URL(redirect.toPath, req.url), redirect.statusCode);
  }

  if (pathname.startsWith("/admin")) {
    // Same reasoning as /account/verify-email below — an admin accepting an invite may or may not
    // already have a different session, and the page must work either way.
    if (pathname === "/admin/accept-invite") {
      return NextResponse.next();
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

    return NextResponse.next();
  }

  if (pathname.startsWith("/account")) {
    // Works the same whether the visitor is logged in (resending from the account banner) or not
    // (clicking the email link straight from a mail client, no session yet) — never gated or
    // bounced away either direction, unlike the auth pages below.
    if (pathname === "/account/verify-email") {
      return NextResponse.next();
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

    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  // Runs on every page request (not just /admin and /account) so admin-managed redirects can
  // apply anywhere on the site — excludes static assets/Next internals, which never have redirects.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
