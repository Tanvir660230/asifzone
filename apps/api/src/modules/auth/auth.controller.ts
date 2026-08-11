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

export const listAdmins = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ admins: await authService.listAdmins() });
});

export const setAdminActive = asyncHandler(async (req: Request, res: Response) => {
  const admin = await authService.setAdminActive(req.params.id!, req.admin!.adminId, req.body.isActive);
  res.json({ admin });
});

export const updateAdmin = asyncHandler(async (req: Request, res: Response) => {
  const admin = await authService.updateAdmin(req.params.id!, req.admin!.adminId, req.body);
  res.json({ admin });
});

export const setAdminPassword = asyncHandler(async (req: Request, res: Response) => {
  await authService.setAdminPassword(req.params.id!, req.body.password);
  res.status(204).send();
});

export const listAdminInvites = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ invites: await authService.listAdminInvites() });
});

export const createAdminInvite = asyncHandler(async (req: Request, res: Response) => {
  await authService.createAdminInvite(req.body, req.admin!.adminId);
  res.status(201).json({ message: "Invite sent." });
});

export const revokeAdminInvite = asyncHandler(async (req: Request, res: Response) => {
  await authService.revokeAdminInvite(req.params.id!);
  res.status(204).send();
});

export const acceptAdminInvite = asyncHandler(async (req: Request, res: Response) => {
  const { accessToken, refreshToken, admin } = await authService.acceptAdminInvite(req.body.token, req.body.password);
  issueCsrfCookie(res);
  res
    .cookie("access_token", accessToken, accessTokenCookieOptions)
    .cookie("refresh_token", refreshToken, refreshTokenCookieOptions)
    .status(201)
    .json({ admin });
});
