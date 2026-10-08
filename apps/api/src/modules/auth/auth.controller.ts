import crypto from "node:crypto";
import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { AppError } from "../../lib/app-error";
import { accessTokenCookieOptions, refreshTokenCookieOptions, csrfTokenCookieOptions } from "../../lib/cookies";
import * as authService from "./auth.service";
import { recordAudit } from "../../lib/audit";

/** Phase 10 (G-7): admin-account changes are audited with the exact before/after, in place of the generic row. */
function auditAdminChange(req: Request, res: Response, action: string, before: { role: string; isActive: boolean }, after: { role: string; isActive: boolean }) {
  res.locals.auditHandled = true;
  recordAudit({
    adminId: req.admin!.adminId,
    action,
    entityType: "admins",
    entityId: req.params.id ?? null,
    ipAddress: req.ip ?? null,
    metadata: { before: { role: before.role, isActive: before.isActive }, after: { role: after.role, isActive: after.isActive } },
  });
}

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

export const googleLogin = asyncHandler(async (req: Request, res: Response) => {
  const { accessToken, refreshToken, admin } = await authService.loginAdminWithGoogle(
    req.body.idToken,
    req.headers["user-agent"],
  );
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
  res.json({ sessions: await authService.listActiveSessions(req.admin!.adminId, req.cookies?.refresh_token as string | undefined) });
});

/** Sign out every other device (Account › Active sessions); this one stays signed in. */
export const revokeOtherSessions = asyncHandler(async (req: Request, res: Response) => {
  const revoked = await authService.revokeOtherSessions(req.admin!.adminId, req.cookies?.refresh_token as string | undefined);
  res.locals.auditHandled = true;
  recordAudit({ adminId: req.admin!.adminId, action: "sessions.revoke_others", entityType: "sessions", entityId: null, ipAddress: req.ip ?? null, metadata: { revoked } });
  res.json({ revoked });
});

/** Sign one of my other devices out (Account › Active sessions). */
export const revokeSession = asyncHandler(async (req: Request, res: Response) => {
  await authService.revokeSession(req.admin!.adminId, req.params.id!, req.cookies?.refresh_token as string | undefined);
  res.locals.auditHandled = true;
  recordAudit({ adminId: req.admin!.adminId, action: "sessions.revoke", entityType: "sessions", entityId: req.params.id!, ipAddress: req.ip ?? null });
  res.status(204).send();
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const refreshToken = req.cookies?.refresh_token as string | undefined;
  if (!refreshToken) throw AppError.unauthorized("Login required");

  let session: Awaited<ReturnType<typeof authService.refreshAdminSession>>;
  try {
    session = await authService.refreshAdminSession(refreshToken, req.headers["user-agent"]);
  } catch (err) {
    // A revoked, expired or reused refresh token: drop the dead cookies, or the web (which treats "has a refresh cookie"
    // as signed in) bounces between the login page and the dashboard.
    if (err instanceof AppError && err.statusCode === 401) res.clearCookie("access_token").clearCookie("refresh_token").clearCookie("csrf_token");
    throw err;
  }
  const { accessToken, refreshToken: newRefreshToken } = session;
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
  const { before, admin } = await authService.setAdminActive(req.params.id!, req.admin!.adminId, req.body.isActive);
  auditAdminChange(req, res, admin.isActive ? "admins.activate" : "admins.deactivate", before, admin);
  res.json({ admin });
});

export const updateAdmin = asyncHandler(async (req: Request, res: Response) => {
  const { before, admin } = await authService.updateAdmin(req.params.id!, req.admin!.adminId, req.body);
  auditAdminChange(req, res, before.role !== admin.role ? "admins.role_change" : "admins.update", before, admin);
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
