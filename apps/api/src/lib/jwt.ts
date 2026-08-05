import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../config/env";

export interface AdminTokenPayload {
  adminId: string;
  role: "OWNER" | "STAFF";
}

const accessTokenOptions: SignOptions = { expiresIn: env.accessTokenTtl as SignOptions["expiresIn"] };

export function signAccessToken(payload: AdminTokenPayload): string {
  return jwt.sign(payload, env.jwtAccessSecret, accessTokenOptions);
}

export function verifyAccessToken(token: string): AdminTokenPayload {
  return jwt.verify(token, env.jwtAccessSecret) as AdminTokenPayload;
}
