import type { CookieOptions } from "express";
import { env } from "../config/env";

const base: CookieOptions = {
  httpOnly: true,
  secure: env.nodeEnv === "production",
  sameSite: "strict",
  path: "/",
};

export const accessTokenCookieOptions: CookieOptions = { ...base, maxAge: 15 * 60 * 1000 };
export const refreshTokenCookieOptions: CookieOptions = { ...base, maxAge: 7 * 24 * 60 * 60 * 1000 };
// Same cookie, no maxAge — expires when the browser closes. Used only for customer login with
// "remember me" explicitly unchecked; admin sessions and the default customer login are unaffected.
export const refreshTokenSessionCookieOptions: CookieOptions = { ...base };
// Deliberately NOT httpOnly — the frontend must be able to read this and echo it back as a header
// for the double-submit CSRF check (see middlewares/csrf.ts).
export const csrfTokenCookieOptions: CookieOptions = { ...base, httpOnly: false, maxAge: 7 * 24 * 60 * 60 * 1000 };

// Distinct names from the admin cookies above so an admin session and a customer session
// can coexist in the same browser without colliding.
export const CUSTOMER_ACCESS_COOKIE = "customer_access_token";
export const CUSTOMER_REFRESH_COOKIE = "customer_refresh_token";
