import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { AppError } from "../../lib/app-error";
import { accessTokenCookieOptions, refreshTokenCookieOptions } from "../../lib/cookies";
import { getAdminById, loginAdmin, refreshAdminSession } from "./auth.service";

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { accessToken, refreshToken, admin } = await loginAdmin(req.body);
  res
    .cookie("access_token", accessToken, accessTokenCookieOptions)
    .cookie("refresh_token", refreshToken, refreshTokenCookieOptions)
    .json({ admin });
});

export const logout = asyncHandler(async (_req: Request, res: Response) => {
  res.clearCookie("access_token").clearCookie("refresh_token").status(204).send();
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const refreshToken = req.cookies?.refresh_token as string | undefined;
  if (!refreshToken) throw AppError.unauthorized("Login required");

  const accessToken = await refreshAdminSession(refreshToken);
  res.cookie("access_token", accessToken, accessTokenCookieOptions).json({ ok: true });
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  const admin = await getAdminById(req.admin!.adminId);
  res.json({ admin });
});
