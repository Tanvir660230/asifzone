import jwt, { type SignOptions } from "jsonwebtoken";
import type { AdminRoleName } from "@clothing-brand/shared";
import { env } from "../config/env";
import { assertTokenInstallation, TOKEN_AUDIENCE } from "../config/installation";

/** `role` is informational only (Phase 10): requireAdmin re-reads the admin's current role and active flag from the
 * database on every request, so a stale claim never grants anything. */
export interface AdminTokenPayload {
  adminId: string;
  role: AdminRoleName;
}

const ADMIN_TOKEN_TYPE = "admin";
const accessTokenOptions: SignOptions = { expiresIn: env.accessTokenTtl as SignOptions["expiresIn"], audience: TOKEN_AUDIENCE };

export function signAccessToken(payload: AdminTokenPayload): string {
  return jwt.sign({ ...payload, typ: ADMIN_TOKEN_TYPE }, env.jwtAccessSecret, accessTokenOptions);
}

/** Only an admin access token of THIS installation passes — never a customer token, even if the two secrets were ever
 * configured alike, and never one another installation signed. */
export function verifyAccessToken(token: string): AdminTokenPayload {
  const payload = jwt.verify(token, env.jwtAccessSecret) as Partial<AdminTokenPayload> & { typ?: unknown; aud?: unknown };
  if (payload.typ !== ADMIN_TOKEN_TYPE || typeof payload.adminId !== "string") throw new Error("not an admin access token");
  assertTokenInstallation(payload);
  return { adminId: payload.adminId, role: payload.role as AdminTokenPayload["role"] };
}

const TWO_STEP_TYPE = "admin-2fa";

/** Admin audit phase 2: after a correct password (or Google) for an admin with 2-step sign-in, this short-lived token
 * stands for "first step done" until the code arrives. A different `typ`, so it never passes as an access token and an
 * access token never passes as it; it must name this installation. */
export function signTwoStepChallenge(adminId: string): string {
  return jwt.sign({ adminId, typ: TWO_STEP_TYPE }, env.jwtAccessSecret, { expiresIn: "5m", audience: TOKEN_AUDIENCE });
}

/** The admin the challenge was issued to, or null when it is forged, expired, from another installation or not a challenge. */
export function verifyTwoStepChallenge(token: string): string | null {
  try {
    const payload = jwt.verify(token, env.jwtAccessSecret, { audience: TOKEN_AUDIENCE }) as { adminId?: unknown; typ?: unknown };
    return payload.typ === TWO_STEP_TYPE && typeof payload.adminId === "string" ? payload.adminId : null;
  } catch {
    return null;
  }
}
