import { NextResponse, type NextRequest } from "next/server";

/** Cheap presence check only — the API independently verifies the JWT signature on every request via requireAdmin/requireCustomer. This just keeps signed-out users off gated pages without a round trip. */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/admin")) {
    const isLoginPage = pathname === "/admin/login";
    const hasSession = req.cookies.has("access_token");

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
    const isAuthPage =
      pathname === "/account/login" ||
      pathname === "/account/register" ||
      pathname === "/account/forgot-password" ||
      pathname === "/account/reset-password";
    const hasSession = req.cookies.has("customer_access_token");

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
  matcher: ["/admin/:path*", "/account/:path*"],
};
