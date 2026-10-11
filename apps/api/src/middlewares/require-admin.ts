import type { NextFunction, Request, Response } from "express";
import type { Permission } from "@clothing-brand/shared";
import { AppError } from "../lib/app-error";
import { verifyAccessToken } from "../lib/jwt";
import { can, resolveAdminIdentity, type AdminIdentity } from "../domain/auth/authorization";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      admin?: AdminIdentity;
    }
  }
}

/** Authentication for admin routes (Phase 10): a valid admin access token AND an existing, active admin behind it. The
 * admin's current role comes from the database (see domain/auth/authorization.ts). No identity → 401. */
export async function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.access_token as string | undefined;
  if (!token) return next(AppError.unauthorized("Login required"));

  let adminId: string;
  try {
    ({ adminId } = verifyAccessToken(token));
  } catch {
    return next(AppError.unauthorized("Session expired, please log in again"));
  }
  try {
    const identity = await resolveAdminIdentity(adminId);
    if (!identity) return next(AppError.unauthorized("Session expired, please log in again"));
    req.admin = identity;
    next();
  } catch (err) {
    next(err);
  }
}

/** Authorization for admin routes: runs after requireAdmin; the admin must hold every listed permission. Missing
 * identity → 401, missing permission → 403 (a generic message — no hint about what exists). */
export function requirePermission(...permissions: [Permission, ...Permission[]]) {
  const middleware = (req: Request, _res: Response, next: NextFunction) => {
    if (!req.admin) return next(AppError.unauthorized("Login required"));
    if (!permissions.every((p) => can(req.admin, p))) return next(AppError.forbidden());
    next();
  };
  // Named for route introspection (the authorization guard test reads it).
  Object.defineProperty(middleware, "name", { value: `requirePermission(${permissions.join(",")})` });
  return middleware;
}

/** Self-service admin routes (own session, own notifications): any authenticated admin, no permission — declared
 * explicitly so every admin route states its authorization decision. */
export function requireSelf(req: Request, _res: Response, next: NextFunction) {
  if (!req.admin) return next(AppError.unauthorized("Login required"));
  next();
}

/** Soft variant for public routes that offer extra options to staff (e.g. quoting for a specific customer): attaches
 * req.admin when a valid session of an active admin is present, otherwise continues anonymously — never rejects. */
export async function attachAdminIfPresent(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.access_token as string | undefined;
  if (!token) return next();
  try {
    const identity = await resolveAdminIdentity(verifyAccessToken(token).adminId);
    if (identity) req.admin = identity;
  } catch {
    // expired/invalid admin token on a public route — proceed anonymously
  }
  next();
}
