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

// Distinct names from the admin cookies above so an admin session and a customer session
// can coexist in the same browser without colliding.
export const CUSTOMER_ACCESS_COOKIE = "customer_access_token";
export const CUSTOMER_REFRESH_COOKIE = "customer_refresh_token";
