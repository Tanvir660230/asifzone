import { Router } from "express";
import {
  adminLoginSchema,
  googleLoginSchema,
  createAdminInviteSchema,
  acceptAdminInviteSchema,
  updateAdminActiveSchema,
  updateAdminSchema,
  setAdminPasswordSchema,
  twoStepCodeSchema,
  twoStepLoginSchema,
} from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireAdmin, requirePermission, requireSelf } from "../../middlewares/require-admin";
import { loginRateLimit, refreshRateLimit } from "../../middlewares/rate-limit";
import {
  login,
  googleLogin,
  logout,
  logoutAllDevices,
  me,
  refresh,
  sessions,
  revokeSession,
  revokeOtherSessions,
  listAdmins,
  setAdminActive,
  updateAdmin,
  setAdminPassword,
  listAdminInvites,
  createAdminInvite,
  revokeAdminInvite,
  acceptAdminInvite,
  loginTwoStep,
  twoStepSetup,
  twoStepEnable,
  twoStepDisable,
  resetAdminTwoStep,
  revokeAdminSessions,
} from "./auth.controller";

export const authRouter = Router();

authRouter.post("/login", loginRateLimit, validate(adminLoginSchema), login);
authRouter.post("/google", loginRateLimit, validate(googleLoginSchema), googleLogin);
// 2-step sign-in (admin audit phase 2): the code after the password or Google, and each admin's own setup.
authRouter.post("/login/2fa", loginRateLimit, validate(twoStepLoginSchema), loginTwoStep);
authRouter.post("/2fa/setup", requireAdmin, requireSelf, twoStepSetup);
authRouter.post("/2fa/enable", requireAdmin, requireSelf, validate(twoStepCodeSchema), twoStepEnable);
authRouter.post("/2fa/disable", requireAdmin, requireSelf, validate(twoStepCodeSchema), twoStepDisable);
authRouter.post("/logout", logout);
authRouter.post("/logout-all", requireAdmin, requireSelf, logoutAllDevices);
authRouter.get("/sessions", requireAdmin, requireSelf, sessions);
authRouter.post("/sessions/revoke-others", requireAdmin, requireSelf, revokeOtherSessions);
authRouter.delete("/sessions/:id", requireAdmin, requireSelf, revokeSession);
authRouter.post("/refresh", refreshRateLimit, refresh);
authRouter.get("/me", requireAdmin, requireSelf, me);

// No public registration route exists anywhere for admin accounts — the only way one comes into
// being is an OWNER inviting it here, or prisma/seed.ts for the very first account.
authRouter.get("/admins", requireAdmin, requirePermission("users.manage"), listAdmins);
authRouter.patch(
  "/admins/:id/active",
  requireAdmin,
  requirePermission("users.manage"),
  validate(updateAdminActiveSchema),
  setAdminActive,
);
authRouter.patch("/admins/:id", requireAdmin, requirePermission("users.manage"), validate(updateAdminSchema), updateAdmin);
authRouter.patch(
  "/admins/:id/password",
  requireAdmin,
  requirePermission("users.manage"),
  validate(setAdminPasswordSchema),
  setAdminPassword,
);
authRouter.delete("/admins/:id/2fa", requireAdmin, requirePermission("users.manage"), resetAdminTwoStep);
authRouter.post("/admins/:id/sessions/revoke", requireAdmin, requirePermission("users.manage"), revokeAdminSessions);
authRouter.get("/admin-invites", requireAdmin, requirePermission("users.manage"), listAdminInvites);
authRouter.post(
  "/admin-invites",
  requireAdmin,
  requirePermission("users.manage"),
  validate(createAdminInviteSchema),
  createAdminInvite,
);
authRouter.delete("/admin-invites/:id", requireAdmin, requirePermission("users.manage"), revokeAdminInvite);
authRouter.post(
  "/admin-invites/accept",
  loginRateLimit,
  validate(acceptAdminInviteSchema),
  acceptAdminInvite,
);
