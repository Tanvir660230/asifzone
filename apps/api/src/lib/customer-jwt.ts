import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../config/env";
import { assertTokenInstallation, TOKEN_AUDIENCE } from "../config/installation";

export interface CustomerTokenPayload {
  customerId: string;
}

/** tokenVersion pins a refresh token to the Customer.tokenVersion counter at issue time — bumping
 * that counter (e.g. on password reset) instantly invalidates every refresh token issued before it,
 * even though the JWT itself is otherwise still cryptographically valid until it expires. */
export interface CustomerRefreshTokenPayload extends CustomerTokenPayload {
  tokenVersion: number;
}

const accessTokenOptions: SignOptions = { expiresIn: env.accessTokenTtl as SignOptions["expiresIn"], audience: TOKEN_AUDIENCE };
const refreshTokenOptions: SignOptions = { expiresIn: env.refreshTokenTtl as SignOptions["expiresIn"], audience: TOKEN_AUDIENCE };

const CUSTOMER_TOKEN_TYPE = "customer";

export function signCustomerAccessToken(payload: CustomerTokenPayload): string {
  return jwt.sign({ ...payload, typ: CUSTOMER_TOKEN_TYPE }, env.jwtCustomerAccessSecret, accessTokenOptions);
}

export function signCustomerRefreshToken(payload: CustomerRefreshTokenPayload): string {
  return jwt.sign(payload, env.jwtCustomerRefreshSecret, refreshTokenOptions);
}

/** Only a customer access token of THIS installation passes — never an admin token (Phase 10), whatever the secrets are
 * configured to, and never one another installation signed. */
export function verifyCustomerAccessToken(token: string): CustomerTokenPayload {
  const payload = jwt.verify(token, env.jwtCustomerAccessSecret) as Partial<CustomerTokenPayload> & { typ?: unknown; aud?: unknown };
  if (payload.typ !== CUSTOMER_TOKEN_TYPE || typeof payload.customerId !== "string") throw new Error("not a customer access token");
  assertTokenInstallation(payload);
  return { customerId: payload.customerId };
}

export function verifyCustomerRefreshToken(token: string): CustomerRefreshTokenPayload {
  const payload = jwt.verify(token, env.jwtCustomerRefreshSecret) as CustomerRefreshTokenPayload & { aud?: unknown };
  assertTokenInstallation(payload);
  return payload;
}
