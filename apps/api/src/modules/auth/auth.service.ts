import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import type { AdminLoginInput } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { signAccessToken } from "../../lib/jwt";

const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function generateOpaqueToken(): string {
  return crypto.randomBytes(40).toString("hex");
}

/** Issues a new opaque refresh token and stores only its hash — the raw value is never persisted, so a
 * DB leak can't be replayed as a live session. */
async function issueRefreshToken(adminId: string, userAgent?: string, replacesId?: string) {
  const raw = generateOpaqueToken();
  const token = await prisma.refreshToken.create({
    data: {
      adminId,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      userAgent: userAgent ?? null,
    },
  });
  if (replacesId) {
    await prisma.refreshToken.update({ where: { id: replacesId }, data: { revokedAt: new Date(), replacedById: token.id } });
  }
  return raw;
}

export async function loginAdmin(input: AdminLoginInput, userAgent?: string) {
  const admin = await prisma.adminUser.findUnique({ where: { email: input.email } });
  if (!admin || !admin.isActive) throw AppError.unauthorized("Invalid email or password");

  const passwordMatches = await bcrypt.compare(input.password, admin.passwordHash);
  if (!passwordMatches) throw AppError.unauthorized("Invalid email or password");

  const refreshToken = await issueRefreshToken(admin.id, userAgent);
  return {
    accessToken: signAccessToken({ adminId: admin.id, role: admin.role }),
    refreshToken,
    admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role },
  };
}

/** Rotates the refresh token on every use (old one is marked revoked+replaced) so a stolen token that
 * gets reused after the legitimate client already rotated is detectable as reuse-of-a-revoked-token. */
export async function refreshAdminSession(rawToken: string, userAgent?: string) {
  const tokenHash = hashToken(rawToken);
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });

  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw AppError.unauthorized("Session expired, please log in again");
  }

  const admin = await prisma.adminUser.findUnique({ where: { id: stored.adminId } });
  if (!admin || !admin.isActive) throw AppError.unauthorized("Session expired, please log in again");

  const newRefreshToken = await issueRefreshToken(admin.id, userAgent, stored.id);
  return {
    accessToken: signAccessToken({ adminId: admin.id, role: admin.role }),
    refreshToken: newRefreshToken,
  };
}

export async function revokeRefreshToken(rawToken: string) {
  const tokenHash = hashToken(rawToken);
  await prisma.refreshToken.updateMany({ where: { tokenHash, revokedAt: null }, data: { revokedAt: new Date() } });
}

/** "Log out of all devices" — revokes every still-active session for this admin. */
export async function revokeAllRefreshTokens(adminId: string) {
  await prisma.refreshToken.updateMany({ where: { adminId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function listActiveSessions(adminId: string) {
  return prisma.refreshToken.findMany({
    where: { adminId, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, userAgent: true, createdAt: true, expiresAt: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function getAdminById(adminId: string) {
  const admin = await prisma.adminUser.findUnique({ where: { id: adminId } });
  if (!admin) throw AppError.notFound("Admin not found");
  return { id: admin.id, name: admin.name, email: admin.email, role: admin.role };
}
