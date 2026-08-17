import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import type { AdminLoginInput, CreateAdminInviteInput, UpdateAdminInput } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { signAccessToken } from "../../lib/jwt";
import { sendMail } from "../../lib/mailer";
import { renderEmailLayout } from "../../lib/email-template";
import { hashToken } from "../../lib/token-hash";
import { env } from "../../config/env";

const googleClient = env.google.clientId ? new OAuth2Client(env.google.clientId) : null;

const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** No plaintext hashes to this — compared against on every login for an email that isn't
 * registered, so a failed login takes the same ~50-100ms bcrypt.compare cost whether or not the
 * account exists. Without this, the early-return-on-not-found path is measurably faster than the
 * wrong-password path, letting an attacker enumerate valid admin emails via response timing. */
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("no-account-has-this-password", 10);

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
  const passwordMatches = await bcrypt.compare(input.password, admin?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!admin || !admin.isActive || !passwordMatches) throw AppError.unauthorized("Invalid email or password");

  const refreshToken = await issueRefreshToken(admin.id, userAgent);
  return {
    accessToken: signAccessToken({ adminId: admin.id, role: admin.role }),
    refreshToken,
    admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role },
  };
}

/** Unlike the customer Google login, this never creates an AdminUser — admin accounts are
 * invite-only, so Google can only sign in someone who already has an active, invited account with a
 * matching email. First successful Google login links `googleId` for faster lookups next time. */
export async function loginAdminWithGoogle(idToken: string, userAgent?: string) {
  if (!googleClient) {
    throw new AppError(503, "Google sign-in isn't configured — set GOOGLE_CLIENT_ID on the API to enable it.");
  }

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken, audience: env.google.clientId });
    payload = ticket.getPayload();
  } catch {
    throw AppError.unauthorized("Invalid Google sign-in — please try again");
  }
  if (!payload?.sub || !payload.email) throw AppError.unauthorized("Invalid Google sign-in — please try again");

  const googleId = payload.sub;
  const email = payload.email.trim().toLowerCase();

  let admin = await prisma.adminUser.findUnique({ where: { googleId } });
  if (!admin) {
    const existingByEmail = await prisma.adminUser.findUnique({ where: { email } });
    if (!existingByEmail) {
      throw AppError.unauthorized("No admin account found for this Google email");
    }
    admin = await prisma.adminUser.update({ where: { id: existingByEmail.id }, data: { googleId } });
  }
  if (!admin.isActive) throw AppError.unauthorized("This admin account has been deactivated");

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

// --- admin management (no public registration — accounts only exist via an OWNER's invite) ---

export async function listAdmins() {
  return prisma.adminUser.findMany({
    select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function setAdminActive(adminId: string, requestingAdminId: string, isActive: boolean) {
  if (adminId === requestingAdminId && !isActive) {
    throw AppError.badRequest("You can't deactivate your own account");
  }
  const admin = await prisma.adminUser.update({
    where: { id: adminId },
    data: { isActive },
    select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
  });
  if (!isActive) await revokeAllRefreshTokens(adminId);
  return admin;
}

export async function updateAdmin(adminId: string, requestingAdminId: string, input: UpdateAdminInput) {
  if (adminId === requestingAdminId && input.role && input.role !== "OWNER") {
    throw AppError.badRequest("You can't change your own role away from owner");
  }

  const data: { name?: string; email?: string; role?: UpdateAdminInput["role"] } = { ...input };
  if (input.email) {
    const email = input.email.trim().toLowerCase();
    const existing = await prisma.adminUser.findUnique({ where: { email } });
    if (existing && existing.id !== adminId) {
      throw AppError.conflict("An admin account with this email already exists");
    }
    data.email = email;
  }

  return prisma.adminUser.update({
    where: { id: adminId },
    data,
    select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
  });
}

/** OWNER sets a teammate's password directly — no email round-trip needed, unlike the invite flow.
 * Revokes every existing session for that account, same as any other password change: a session
 * issued under the old password shouldn't outlive it. */
export async function setAdminPassword(adminId: string, password: string) {
  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.adminUser.update({ where: { id: adminId }, data: { passwordHash } });
  await revokeAllRefreshTokens(adminId);
}

export async function listAdminInvites() {
  return prisma.adminInvite.findMany({
    where: { acceptedAt: null },
    select: { id: true, name: true, email: true, role: true, expiresAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function createAdminInvite(input: CreateAdminInviteInput, invitedById: string) {
  const email = input.email.trim().toLowerCase();
  if (await prisma.adminUser.findUnique({ where: { email } })) {
    throw AppError.conflict("An admin account with this email already exists");
  }

  const token = crypto.randomBytes(32).toString("hex");
  await prisma.adminInvite.create({
    data: {
      email,
      name: input.name,
      role: input.role,
      tokenHash: hashToken(token),
      invitedById,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    },
  });

  const acceptUrl = `${env.webOrigin}/admin/accept-invite?token=${token}`;
  await sendMail({
    to: email,
    subject: "You've been invited to the admin console",
    html: renderEmailLayout({
      bodyHtml: `
        <p style="margin:0 0 8px;font-size:18px;font-weight:600;">You're invited</p>
        <p style="margin:0;">You've been invited as ${input.role === "OWNER" ? "an owner" : "a staff member"} on the admin console. Set your password to get started — this link expires in 7 days.</p>
      `,
      ctaLabel: "Accept invite",
      ctaUrl: acceptUrl,
    }),
  });
}

export async function revokeAdminInvite(inviteId: string) {
  await prisma.adminInvite.deleteMany({ where: { id: inviteId, acceptedAt: null } });
}

export async function acceptAdminInvite(token: string, password: string) {
  const tokenHash = hashToken(token);
  const invite = await prisma.adminInvite.findUnique({ where: { tokenHash } });

  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
    throw AppError.badRequest("This invite link is invalid or has expired");
  }
  if (await prisma.adminUser.findUnique({ where: { email: invite.email } })) {
    throw AppError.conflict("An admin account with this email already exists");
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const [admin] = await prisma.$transaction([
    prisma.adminUser.create({
      data: { name: invite.name, email: invite.email, passwordHash, role: invite.role },
      select: { id: true, name: true, email: true, role: true },
    }),
    prisma.adminInvite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } }),
  ]);

  const refreshToken = await issueRefreshToken(admin.id);
  return { accessToken: signAccessToken({ adminId: admin.id, role: admin.role }), refreshToken, admin };
}
