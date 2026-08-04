import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../config/env";

export interface AdminTokenPayload {
  adminId: string;
  role: "OWNER" | "STAFF";
}

const accessTokenOptions: SignOptions = { expiresIn: env.accessTokenTtl as SignOptions["expiresIn"] };
const refreshTokenOptions: SignOptions = { expiresIn: env.refreshTokenTtl as SignOptions["expiresIn"] };

export function signAccessToken(payload: AdminTokenPayload): string {
  return jwt.sign(payload, env.jwtAccessSecret, accessTokenOptions);
}

export function signRefreshToken(payload: AdminTokenPayload): string {
  return jwt.sign(payload, env.jwtRefreshSecret, refreshTokenOptions);
}

export function verifyAccessToken(token: string): AdminTokenPayload {
  return jwt.verify(token, env.jwtAccessSecret) as AdminTokenPayload;
}

export function verifyRefreshToken(token: string): AdminTokenPayload {
  return jwt.verify(token, env.jwtRefreshSecret) as AdminTokenPayload;
}
