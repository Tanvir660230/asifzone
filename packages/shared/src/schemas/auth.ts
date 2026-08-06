import { z } from "zod";

export const adminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const adminRoleSchema = z.enum(["OWNER", "STAFF"]);

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

export type AdminLoginInput = z.infer<typeof adminLoginSchema>;
export type AdminRole = z.infer<typeof adminRoleSchema>;
export type CreateAdminInviteInput = z.infer<typeof createAdminInviteSchema>;
export type AcceptAdminInviteInput = z.infer<typeof acceptAdminInviteSchema>;
export type UpdateAdminActiveInput = z.infer<typeof updateAdminActiveSchema>;
