import { Router } from "express";
import {
  adminLoginSchema,
  createAdminInviteSchema,
  acceptAdminInviteSchema,
  updateAdminActiveSchema,
  updateAdminSchema,
  setAdminPasswordSchema,
} from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireAdmin, requireRole } from "../../middlewares/require-admin";
import { loginRateLimit } from "../../middlewares/rate-limit";
import {
  login,
  logout,
  logoutAllDevices,
  me,
  refresh,
  sessions,
  listAdmins,
  setAdminActive,
  updateAdmin,
  setAdminPassword,
  listAdminInvites,
  createAdminInvite,
  revokeAdminInvite,
  acceptAdminInvite,
} from "./auth.controller";

export const authRouter = Router();

authRouter.post("/login", loginRateLimit, validate(adminLoginSchema), login);
authRouter.post("/logout", logout);
authRouter.post("/logout-all", requireAdmin, logoutAllDevices);
authRouter.get("/sessions", requireAdmin, sessions);
authRouter.post("/refresh", refresh);
authRouter.get("/me", requireAdmin, me);

// No public registration route exists anywhere for admin accounts — the only way one comes into
// being is an OWNER inviting it here, or prisma/seed.ts for the very first account.
authRouter.get("/admins", requireAdmin, requireRole("OWNER"), listAdmins);
authRouter.patch(
  "/admins/:id/active",
  requireAdmin,
  requireRole("OWNER"),
  validate(updateAdminActiveSchema),
  setAdminActive,
);
authRouter.patch("/admins/:id", requireAdmin, requireRole("OWNER"), validate(updateAdminSchema), updateAdmin);
authRouter.patch(
  "/admins/:id/password",
  requireAdmin,
  requireRole("OWNER"),
  validate(setAdminPasswordSchema),
  setAdminPassword,
);
authRouter.get("/admin-invites", requireAdmin, requireRole("OWNER"), listAdminInvites);
authRouter.post(
  "/admin-invites",
  requireAdmin,
  requireRole("OWNER"),
  validate(createAdminInviteSchema),
  createAdminInvite,
);
authRouter.delete("/admin-invites/:id", requireAdmin, requireRole("OWNER"), revokeAdminInvite);
authRouter.post(
  "/admin-invites/accept",
  loginRateLimit,
  validate(acceptAdminInviteSchema),
  acceptAdminInvite,
);
