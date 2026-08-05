import crypto from "node:crypto";
import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { AppError } from "../../lib/app-error";
import { accessTokenCookieOptions, refreshTokenCookieOptions, csrfTokenCookieOptions } from "../../lib/cookies";
import * as authService from "./auth.service";

function issueCsrfCookie(res: Response) {
  res.cookie("csrf_token", crypto.randomBytes(24).toString("hex"), csrfTokenCookieOptions);
}

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { accessToken, refreshToken, admin } = await authService.loginAdmin(req.body, req.headers["user-agent"]);
  issueCsrfCookie(res);
  res
    .cookie("access_token", accessToken, accessTokenCookieOptions)
    .cookie("refresh_token", refreshToken, refreshTokenCookieOptions)
    .json({ admin });
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  const refreshToken = req.cookies?.refresh_token as string | undefined;
  if (refreshToken) await authService.revokeRefreshToken(refreshToken);
  res.clearCookie("access_token").clearCookie("refresh_token").clearCookie("csrf_token").status(204).send();
});

export const logoutAllDevices = asyncHandler(async (req: Request, res: Response) => {
  await authService.revokeAllRefreshTokens(req.admin!.adminId);
  res.clearCookie("access_token").clearCookie("refresh_token").clearCookie("csrf_token").status(204).send();
});

export const sessions = asyncHandler(async (req: Request, res: Response) => {
  res.json({ sessions: await authService.listActiveSessions(req.admin!.adminId) });
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const refreshToken = req.cookies?.refresh_token as string | undefined;
  if (!refreshToken) throw AppError.unauthorized("Login required");

  const { accessToken, refreshToken: newRefreshToken } = await authService.refreshAdminSession(
    refreshToken,
    req.headers["user-agent"],
  );
  issueCsrfCookie(res);
  res
    .cookie("access_token", accessToken, accessTokenCookieOptions)
    .cookie("refresh_token", newRefreshToken, refreshTokenCookieOptions)
    .json({ ok: true });
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  const admin = await authService.getAdminById(req.admin!.adminId);
  res.json({ admin });
});
