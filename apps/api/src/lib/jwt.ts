import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../config/env";

/** `role` is informational only (Phase 10): requireAdmin re-reads the admin's current role and active flag from the
 * database on every request, so a stale claim never grants anything. */
export interface AdminTokenPayload {
  adminId: string;
  role: "OWNER" | "STAFF";
}

const ADMIN_TOKEN_TYPE = "admin";
const accessTokenOptions: SignOptions = { expiresIn: env.accessTokenTtl as SignOptions["expiresIn"] };

export function signAccessToken(payload: AdminTokenPayload): string {
  return jwt.sign({ ...payload, typ: ADMIN_TOKEN_TYPE }, env.jwtAccessSecret, accessTokenOptions);
}

/** Only an admin access token passes — never a customer token, even if the two secrets were ever configured alike. */
export function verifyAccessToken(token: string): AdminTokenPayload {
  const payload = jwt.verify(token, env.jwtAccessSecret) as Partial<AdminTokenPayload> & { typ?: unknown };
  if (payload.typ !== ADMIN_TOKEN_TYPE || typeof payload.adminId !== "string") throw new Error("not an admin access token");
  return { adminId: payload.adminId, role: payload.role as AdminTokenPayload["role"] };
}
