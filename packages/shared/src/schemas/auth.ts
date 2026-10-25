import { z } from "zod";
import { ADMIN_ROLES } from "../permissions";

export const adminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const adminRoleSchema = z.enum(ADMIN_ROLES);

/** 2-step sign-in: a 6-digit app code or a recovery code ("k3f9-2mq7"). */
const twoStepCode = z.string().trim().min(6).max(20);
export const twoStepCodeSchema = z.object({ code: twoStepCode });
export const twoStepLoginSchema = z.object({ challenge: z.string().min(20).max(2000), code: twoStepCode });

export const createAdminInviteSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email(),
  role: adminRoleSchema,
});

export const acceptAdminInviteSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
});

export const updateAdminActiveSchema = z.object({
  isActive: z.boolean(),
});

export const updateAdminSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  email: z.string().email().optional(),
  role: adminRoleSchema.optional(),
});

export const setAdminPasswordSchema = z.object({
  password: z.string().min(8),
});

export type AdminLoginInput = z.infer<typeof adminLoginSchema>;
export type AdminRole = z.infer<typeof adminRoleSchema>;
export type CreateAdminInviteInput = z.infer<typeof createAdminInviteSchema>;
export type AcceptAdminInviteInput = z.infer<typeof acceptAdminInviteSchema>;
export type UpdateAdminActiveInput = z.infer<typeof updateAdminActiveSchema>;
export type UpdateAdminInput = z.infer<typeof updateAdminSchema>;
export type SetAdminPasswordInput = z.infer<typeof setAdminPasswordSchema>;
