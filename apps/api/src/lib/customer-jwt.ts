import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../config/env";

export interface CustomerTokenPayload {
  customerId: string;
}

/** tokenVersion pins a refresh token to the Customer.tokenVersion counter at issue time — bumping
 * that counter (e.g. on password reset) instantly invalidates every refresh token issued before it,
 * even though the JWT itself is otherwise still cryptographically valid until it expires. */
export interface CustomerRefreshTokenPayload extends CustomerTokenPayload {
  tokenVersion: number;
}

const accessTokenOptions: SignOptions = { expiresIn: env.accessTokenTtl as SignOptions["expiresIn"] };
const refreshTokenOptions: SignOptions = { expiresIn: env.refreshTokenTtl as SignOptions["expiresIn"] };

export function signCustomerAccessToken(payload: CustomerTokenPayload): string {
  return jwt.sign(payload, env.jwtCustomerAccessSecret, accessTokenOptions);
}

export function signCustomerRefreshToken(payload: CustomerRefreshTokenPayload): string {
  return jwt.sign(payload, env.jwtCustomerRefreshSecret, refreshTokenOptions);
}

export function verifyCustomerAccessToken(token: string): CustomerTokenPayload {
  return jwt.verify(token, env.jwtCustomerAccessSecret) as CustomerTokenPayload;
}

export function verifyCustomerRefreshToken(token: string): CustomerRefreshTokenPayload {
  return jwt.verify(token, env.jwtCustomerRefreshSecret) as CustomerRefreshTokenPayload;
}
