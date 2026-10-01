import crypto from "crypto";
import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { AppError } from "../../lib/app-error";
import {
  accessTokenCookieOptions,
  refreshTokenCookieOptions,
  refreshTokenSessionCookieOptions,
  csrfTokenCookieOptions,
  CUSTOMER_ACCESS_COOKIE,
  CUSTOMER_REFRESH_COOKIE,
} from "../../lib/cookies";
import * as customerService from "./customer.service";
import { getOrderForCustomer } from "../orders/order.service";
import { toCustomerOrder } from "../orders/customer-order-view";

// Same double-submit token as the admin login flow (middlewares/csrf.ts) — customer login was
// never issuing this cookie, which left every customer-session mutation unprotected by the CSRF
// check regardless of what the middleware itself checked for.
function withCsrfCookie(res: Response) {
  return res.cookie("csrf_token", crypto.randomBytes(24).toString("hex"), csrfTokenCookieOptions);
}

/** Phase 11: one place sets the session cookies. A grace-window refresh returns no refresh token — the browser keeps the
 * cookie the winning tab already set. A non-persistent ("remember me" off) session keeps a browser-session cookie. */
function setSessionCookies(res: Response, session: { accessToken: string; refreshToken: string | null; persistent: boolean }) {
  res.cookie(CUSTOMER_ACCESS_COOKIE, session.accessToken, accessTokenCookieOptions);
  if (session.refreshToken) {
    res.cookie(CUSTOMER_REFRESH_COOKIE, session.refreshToken, session.persistent ? refreshTokenCookieOptions : refreshTokenSessionCookieOptions);
  }
  return res;
}

const sessionOpts = (req: Request) => ({ userAgent: req.headers["user-agent"] ?? null });

export const register = asyncHandler(async (req: Request, res: Response) => {
  const result = await customerService.registerCustomer(req.body, sessionOpts(req));
  if (result.claimPending) {
    // BD-11.6 a: an existing record holds this email — nothing is signed in until the emailed link proves ownership.
    return res.status(202).json({ claimPending: true, message: "Check your email to confirm it's you and finish setting up your account." });
  }
  setSessionCookies(withCsrfCookie(res), result).status(201).json({ customer: result.customer });
});

export const confirmClaim = asyncHandler(async (req: Request, res: Response) => {
  const { customer, ...session } = await customerService.confirmEmailClaim(req.body.token, sessionOpts(req));
  setSessionCookies(withCsrfCookie(res), session).json({ customer });
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { customer, ...session } = await customerService.loginCustomer(req.body, sessionOpts(req));
  setSessionCookies(withCsrfCookie(res), session).json({ customer });
});

export const googleLogin = asyncHandler(async (req: Request, res: Response) => {
  const { customer, ...session } = await customerService.loginWithGoogle(req.body.idToken);
  setSessionCookies(withCsrfCookie(res), session).json({ customer });
});

export const requestOtp = asyncHandler(async (req: Request, res: Response) => {
  await customerService.requestOtp(req.body.phone);
  res.json({ message: "A verification code has been sent." });
});

export const verifyOtp = asyncHandler(async (req: Request, res: Response) => {
  const { customer, ...session } = await customerService.verifyOtp(req.body, sessionOpts(req));
  setSessionCookies(withCsrfCookie(res), session).json({ customer });
});

function clearSessionCookies(res: Response) {
  return res.clearCookie(CUSTOMER_ACCESS_COOKIE).clearCookie(CUSTOMER_REFRESH_COOKIE).clearCookie("csrf_token");
}

/** Revokes this session's refresh family server-side (Phase 11), then clears the cookies. Always 204. */
export const logout = asyncHandler(async (req: Request, res: Response) => {
  await customerService.logoutCustomer(req.cookies?.[CUSTOMER_REFRESH_COOKIE] as string | undefined);
  clearSessionCookies(res).status(204).send();
});

export const logoutAll = asyncHandler(async (req: Request, res: Response) => {
  await customerService.logoutEverywhere(req.customer!.customerId);
  clearSessionCookies(res).status(204).send();
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const refreshToken = req.cookies?.[CUSTOMER_REFRESH_COOKIE] as string | undefined;
  if (!refreshToken) throw AppError.unauthorized("Login required");
  const session = await customerService.refreshCustomerSession(refreshToken, req.headers["user-agent"] ?? null);
  setSessionCookies(res, session).json({ ok: true });
});

export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  const session = await customerService.changeCustomerPassword(req.customer!.customerId, req.body, sessionOpts(req));
  setSessionCookies(res, session).json({ ok: true });
});

export const requestPhoneVerification = asyncHandler(async (req: Request, res: Response) => {
  await customerService.requestPhoneVerification(req.customer!.customerId, req.body.phone);
  res.json({ message: "A verification code has been sent." });
});

export const confirmPhoneVerification = asyncHandler(async (req: Request, res: Response) => {
  const customer = await customerService.confirmPhoneVerification(req.customer!.customerId, req.body.phone, req.body.code);
  res.json({ customer });
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  const customer = await customerService.getCustomerById(req.customer!.customerId);
  res.json({ customer });
});

export const updateMe = asyncHandler(async (req: Request, res: Response) => {
  const customer = await customerService.updateCustomerProfile(req.customer!.customerId, req.body);
  res.json({ customer });
});

export const listAddresses = asyncHandler(async (req: Request, res: Response) => {
  const addresses = await customerService.listAddresses(req.customer!.customerId);
  res.json({ addresses });
});

export const createAddress = asyncHandler(async (req: Request, res: Response) => {
  const address = await customerService.createAddress(req.customer!.customerId, req.body);
  res.status(201).json({ address });
});

export const updateAddress = asyncHandler(async (req: Request, res: Response) => {
  const address = await customerService.updateAddress(req.customer!.customerId, req.params.id!, req.body);
  res.json({ address });
});

export const deleteAddress = asyncHandler(async (req: Request, res: Response) => {
  await customerService.deleteAddress(req.customer!.customerId, req.params.id!);
  res.status(204).send();
});

export const listOrders = asyncHandler(async (req: Request, res: Response) => {
  const result = await customerService.listCustomerOrders(req.customer!.customerId, req.query as never);
  res.json({ ...result, items: result.items.map(toCustomerOrder) });
});

export const getOrder = asyncHandler(async (req: Request, res: Response) => {
  const order = await getOrderForCustomer(req.customer!.customerId, req.params.id!);
  res.json({ order: toCustomerOrder(order) });
});

export const listPoints = asyncHandler(async (req: Request, res: Response) => {
  const result = await customerService.listMyPointsLedger(req.customer!.customerId, req.query as never);
  res.json(result);
});

export const listMyPushSubscriptions = asyncHandler(async (req: Request, res: Response) => {
  res.json({ subscriptions: await customerService.listPushSubscriptions(req.customer!.customerId) });
});

export const subscribePush = asyncHandler(async (req: Request, res: Response) => {
  await customerService.subscribeToPush(req.customer!.customerId, req.body);
  res.status(201).json({ ok: true });
});

export const unsubscribePush = asyncHandler(async (req: Request, res: Response) => {
  await customerService.unsubscribeFromPush(req.customer!.customerId, (req.query as { endpoint: string }).endpoint);
  res.status(204).send();
});

export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  await customerService.requestPasswordReset(req.body.email);
  res.json({ message: "If an account exists for that email, a reset link has been sent." });
});

export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  await customerService.resetPassword(req.body.token, req.body.password);
  res.json({ message: "Password updated, please sign in." });
});

export const verifyEmail = asyncHandler(async (req: Request, res: Response) => {
  await customerService.verifyEmail(req.body.token);
  res.json({ message: "Email verified." });
});

export const resendVerification = asyncHandler(async (req: Request, res: Response) => {
  await customerService.resendVerificationEmail(req.customer!.customerId);
  res.json({ message: "Verification email sent." });
});

export const unsubscribeEmail = asyncHandler(async (req: Request, res: Response) => {
  await customerService.unsubscribeFromEmailMarketing(req.body.customerId, req.body.token);
  res.json({ message: "You've been unsubscribed from marketing emails." });
});

// --- admin ---

export const listCustomersAdmin = asyncHandler(async (req: Request, res: Response) => {
  res.json(await customerService.listCustomersAdmin(req.query as never));
});

export const getCustomerStatsAdmin = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await customerService.getCustomerStatsAdmin());
});

export const createCustomerAdmin = asyncHandler(async (req: Request, res: Response) => {
  const customer = await customerService.createCustomerAdmin(req.body);
  res.status(201).json({ customer });
});

export const getCustomerDetailAdmin = asyncHandler(async (req: Request, res: Response) => {
  res.json({ customer: await customerService.getCustomerDetailAdmin(req.params.id!) });
});

export const adjustPoints = asyncHandler(async (req: Request, res: Response) => {
  const customer = await customerService.adjustRewardPoints(req.params.id!, req.body.points, req.body.reason);
  res.json({ customer });
});

export const updateCustomerAdminFields = asyncHandler(async (req: Request, res: Response) => {
  const customer = await customerService.updateCustomerAdminFields(req.params.id!, req.body);
  res.json({ customer });
});

export const sendAdHocSms = asyncHandler(async (req: Request, res: Response) => {
  const result = await customerService.sendAdHocSmsToCustomer(req.params.id!, req.body.body);
  res.json(result);
});

export const sendBulkSms = asyncHandler(async (req: Request, res: Response) => {
  const result = await customerService.sendBulkSmsToCustomers(req.body.customerIds, req.body.body);
  res.json(result);
});
