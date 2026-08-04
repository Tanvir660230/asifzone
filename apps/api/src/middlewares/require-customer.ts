import type { NextFunction, Request, Response } from "express";
import { AppError } from "../lib/app-error";
import { verifyCustomerAccessToken, type CustomerTokenPayload } from "../lib/customer-jwt";
import { CUSTOMER_ACCESS_COOKIE } from "../lib/cookies";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      customer?: CustomerTokenPayload;
    }
  }
}

export function requireCustomer(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[CUSTOMER_ACCESS_COOKIE] as string | undefined;
  if (!token) return next(AppError.unauthorized("Login required"));

  try {
    req.customer = verifyCustomerAccessToken(token);
    next();
  } catch {
    next(AppError.unauthorized("Session expired, please log in again"));
  }
}

/** Soft variant for guest-allowed routes (e.g. checkout): attaches req.customer if a valid
 * session cookie is present, otherwise just continues — never rejects the request. */
export function attachCustomerIfPresent(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[CUSTOMER_ACCESS_COOKIE] as string | undefined;
  if (token) {
    try {
      req.customer = verifyCustomerAccessToken(token);
    } catch {
      // invalid/expired token on a guest-allowed route — proceed as a guest
    }
  }
  next();
}
