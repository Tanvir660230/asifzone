import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { AppError } from "../../lib/app-error";
import {
  accessTokenCookieOptions,
  refreshTokenCookieOptions,
  CUSTOMER_ACCESS_COOKIE,
  CUSTOMER_REFRESH_COOKIE,
} from "../../lib/cookies";
import * as customerService from "./customer.service";
import { getOrderForCustomer } from "../orders/order.service";

export const register = asyncHandler(async (req: Request, res: Response) => {
  const { accessToken, refreshToken, customer } = await customerService.registerCustomer(req.body);
  res
    .cookie(CUSTOMER_ACCESS_COOKIE, accessToken, accessTokenCookieOptions)
    .cookie(CUSTOMER_REFRESH_COOKIE, refreshToken, refreshTokenCookieOptions)
    .status(201)
    .json({ customer });
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { accessToken, refreshToken, customer } = await customerService.loginCustomer(req.body);
  res
    .cookie(CUSTOMER_ACCESS_COOKIE, accessToken, accessTokenCookieOptions)
    .cookie(CUSTOMER_REFRESH_COOKIE, refreshToken, refreshTokenCookieOptions)
    .json({ customer });
});

export const logout = asyncHandler(async (_req: Request, res: Response) => {
  res.clearCookie(CUSTOMER_ACCESS_COOKIE).clearCookie(CUSTOMER_REFRESH_COOKIE).status(204).send();
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const refreshToken = req.cookies?.[CUSTOMER_REFRESH_COOKIE] as string | undefined;
  if (!refreshToken) throw AppError.unauthorized("Login required");

  const accessToken = await customerService.refreshCustomerSession(refreshToken);
  res.cookie(CUSTOMER_ACCESS_COOKIE, accessToken, accessTokenCookieOptions).json({ ok: true });
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
  res.json(result);
});

export const getOrder = asyncHandler(async (req: Request, res: Response) => {
  const order = await getOrderForCustomer(req.customer!.customerId, req.params.id!);
  res.json({ order });
});

export const listPoints = asyncHandler(async (req: Request, res: Response) => {
  const result = await customerService.listMyPointsLedger(req.customer!.customerId, req.query as never);
  res.json(result);
});

export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  await customerService.requestPasswordReset(req.body.email);
  res.json({ message: "If an account exists for that email, a reset link has been sent." });
});

export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  await customerService.resetPassword(req.body.token, req.body.password);
  res.json({ message: "Password updated, please sign in." });
});

// --- admin ---

export const listCustomersAdmin = asyncHandler(async (req: Request, res: Response) => {
  res.json(await customerService.listCustomersAdmin(req.query as never));
});

export const getCustomerDetailAdmin = asyncHandler(async (req: Request, res: Response) => {
  res.json({ customer: await customerService.getCustomerDetailAdmin(req.params.id!) });
});

export const adjustPoints = asyncHandler(async (req: Request, res: Response) => {
  const customer = await customerService.adjustRewardPoints(req.params.id!, req.body.points, req.body.reason);
  res.json({ customer });
});
