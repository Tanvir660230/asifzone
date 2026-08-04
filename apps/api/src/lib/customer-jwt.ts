import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../config/env";

export interface CustomerTokenPayload {
  customerId: string;
}

const accessTokenOptions: SignOptions = { expiresIn: env.accessTokenTtl as SignOptions["expiresIn"] };
const refreshTokenOptions: SignOptions = { expiresIn: env.refreshTokenTtl as SignOptions["expiresIn"] };

export function signCustomerAccessToken(payload: CustomerTokenPayload): string {
  return jwt.sign(payload, env.jwtCustomerAccessSecret, accessTokenOptions);
}

export function signCustomerRefreshToken(payload: CustomerTokenPayload): string {
  return jwt.sign(payload, env.jwtCustomerRefreshSecret, refreshTokenOptions);
}

export function verifyCustomerAccessToken(token: string): CustomerTokenPayload {
  return jwt.verify(token, env.jwtCustomerAccessSecret) as CustomerTokenPayload;
}

export function verifyCustomerRefreshToken(token: string): CustomerTokenPayload {
  return jwt.verify(token, env.jwtCustomerRefreshSecret) as CustomerTokenPayload;
}
