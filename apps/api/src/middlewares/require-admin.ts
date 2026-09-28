import type { NextFunction, Request, Response } from "express";
import { AppError } from "../lib/app-error";
import { verifyAccessToken, type AdminTokenPayload } from "../lib/jwt";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      admin?: AdminTokenPayload;
    }
  }
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.access_token as string | undefined;
  if (!token) return next(AppError.unauthorized("Login required"));

  try {
    req.admin = verifyAccessToken(token);
    next();
  } catch {
    next(AppError.unauthorized("Session expired, please log in again"));
  }
}

export function requireRole(...roles: Array<"OWNER" | "STAFF">) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.admin || !roles.includes(req.admin.role)) {
      return next(AppError.forbidden());
    }
    next();
  };
}

/** Soft variant for public routes that offer extra options to staff (e.g. quoting for a specific customer): attaches
 * req.admin when a valid admin session is present, otherwise continues as an anonymous request — never rejects. */
export function attachAdminIfPresent(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.access_token as string | undefined;
  if (token) {
    try {
      req.admin = verifyAccessToken(token);
    } catch {
      // expired/invalid admin token on a public route — proceed anonymously
    }
  }
  next();
}
