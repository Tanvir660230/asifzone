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
