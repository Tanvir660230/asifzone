import bcrypt from "bcryptjs";
import type { AdminLoginInput } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../../lib/jwt";

export async function loginAdmin(input: AdminLoginInput) {
  const admin = await prisma.adminUser.findUnique({ where: { email: input.email } });
  if (!admin || !admin.isActive) throw AppError.unauthorized("Invalid email or password");

  const passwordMatches = await bcrypt.compare(input.password, admin.passwordHash);
  if (!passwordMatches) throw AppError.unauthorized("Invalid email or password");

  const payload = { adminId: admin.id, role: admin.role };
  return {
    accessToken: signAccessToken(payload),
    refreshToken: signRefreshToken(payload),
    admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role },
  };
}

export async function refreshAdminSession(refreshToken: string) {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw AppError.unauthorized("Session expired, please log in again");
  }

  const admin = await prisma.adminUser.findUnique({ where: { id: payload.adminId } });
  if (!admin || !admin.isActive) throw AppError.unauthorized("Session expired, please log in again");

  return signAccessToken({ adminId: admin.id, role: admin.role });
}

export async function getAdminById(adminId: string) {
  const admin = await prisma.adminUser.findUnique({ where: { id: adminId } });
  if (!admin) throw AppError.notFound("Admin not found");
  return { id: admin.id, name: admin.name, email: admin.email, role: admin.role };
}
