import crypto from "node:crypto";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { openTotpSecret, sealTotpSecret } from "../../lib/secret-box";
import { env } from "../../config/env";
import { signPayload } from "../../lib/token-hash";
import { generateTotpSecret, otpauthUrl, verifyTotp } from "../../lib/totp";

/**
 * 2-step sign-in for the admin console (admin audit phase 2, owner 2026-10-25): after the password (or Google), a code
 * from an authenticator app. Recovery codes cover a lost phone; five wrong codes in a row lock the step for 15 minutes
 * (on top of the per-IP login limit); a code is never accepted twice. An owner can reset a teammate's (audited by the
 * controller). Optional per admin — the console nudges owners to turn it on.
 */

const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;
const RECOVERY_CODES = 8;

/** Keyed (HMAC under a server secret) and bound to the admin: a leaked database alone can't be brute-forced into codes,
 * and one admin's stored hash means nothing on another's row. */
const recoveryHash = (adminId: string, code: string) =>
  signPayload(`totp-recovery:${adminId}:${code.trim().toLowerCase().replace(/\s/g, "")}`, process.env.TOTP_ENCRYPTION_KEY || env.jwtAccessSecret);
/** "k3f9-2mq7" — 40 bits each, easy to read off paper. */
function newRecoveryCode(): string {
  const raw = crypto.randomBytes(5).toString("hex");
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

async function loadAdmin(adminId: string) {
  const admin = await prisma.adminUser.findUnique({ where: { id: adminId } });
  if (!admin) throw AppError.notFound("Admin not found");
  return admin;
}

/** Starts (or restarts) setup: a new secret, stored sealed and not yet in force. Turning it on needs a code from it. */
export async function startSetup(adminId: string, storeName: string) {
  const admin = await loadAdmin(adminId);
  if (admin.totpEnabledAt) throw AppError.conflict("2-step sign-in is already on — turn it off first to set up a new phone");
  const secret = generateTotpSecret();
  await prisma.adminUser.update({ where: { id: adminId }, data: { totpSecret: sealTotpSecret(adminId, secret), totpLastStep: null } });
  return { secret, otpauthUrl: otpauthUrl({ issuer: storeName, account: admin.email, secret }) };
}

/** Confirms setup with a code from the app; returns the recovery codes — shown once, stored only as hashes. */
export async function enable(adminId: string, code: string) {
  const admin = await loadAdmin(adminId);
  if (admin.totpEnabledAt) throw AppError.conflict("2-step sign-in is already on");
  const secret = admin.totpSecret ? openTotpSecret(adminId, admin.totpSecret) : null;
  if (!secret) throw AppError.badRequest("Start the setup again — scan the new code with your app");
  const step = verifyTotp(secret, code);
  if (step === null) throw AppError.badRequest("That code didn't match — check the time on your phone and try the newest code");
  const recoveryCodes = Array.from({ length: RECOVERY_CODES }, newRecoveryCode);
  await prisma.adminUser.update({
    where: { id: adminId },
    data: { totpEnabledAt: new Date(), totpLastStep: step, totpRecoveryHashes: recoveryCodes.map((c) => recoveryHash(adminId, c)), totpFailures: 0, totpLockedUntil: null },
  });
  return { recoveryCodes };
}

/** Turns it off for yourself — proven with a current code (or a recovery code). */
export async function disable(adminId: string, code: string) {
  const admin = await loadAdmin(adminId);
  if (!admin.totpEnabledAt) return;
  if (!(await checkCode(adminId, code))) throw AppError.badRequest("That code didn't match");
  await clear(adminId);
}

/** An owner resets a teammate's 2-step sign-in (lost phone and no recovery codes). */
export async function reset(adminId: string) {
  await loadAdmin(adminId);
  await clear(adminId);
}

function clear(adminId: string) {
  return prisma.adminUser.update({
    where: { id: adminId },
    data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null, totpRecoveryHashes: [], totpFailures: 0, totpLockedUntil: null },
  });
}

/**
 * The second step at sign-in. True when the code (app or recovery) is good; counts wrong codes and refuses everything
 * while locked (AppError 429). An app code's step must be newer than the last one used; a recovery code is spent.
 * The update is conditional on what was read, so two requests racing with the same code can't both succeed.
 */
export async function checkCode(adminId: string, typed: string): Promise<boolean> {
  const admin = await loadAdmin(adminId);
  if (!admin.totpEnabledAt || !admin.totpSecret) return false;
  if (admin.totpLockedUntil && admin.totpLockedUntil > new Date()) {
    throw new AppError(429, "Too many wrong codes — try again in 15 minutes, or ask another owner to reset your 2-step sign-in");
  }
  const secret = openTotpSecret(adminId, admin.totpSecret);
  const step = secret ? verifyTotp(secret, typed) : null;
  if (step !== null && (admin.totpLastStep === null || step > admin.totpLastStep)) {
    const won = await prisma.adminUser.updateMany({
      where: { id: adminId, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
      data: { totpLastStep: step, totpFailures: 0, totpLockedUntil: null },
    });
    if (won.count === 1) return true;
  }
  const hash = recoveryHash(adminId, typed);
  if (step === null && admin.totpRecoveryHashes.includes(hash)) {
    const won = await prisma.adminUser.updateMany({
      where: { id: adminId, totpRecoveryHashes: { has: hash } },
      data: { totpRecoveryHashes: admin.totpRecoveryHashes.filter((h) => h !== hash), totpFailures: 0, totpLockedUntil: null },
    });
    if (won.count === 1) return true;
  }
  const failures = admin.totpFailures + 1;
  await prisma.adminUser.update({
    where: { id: adminId },
    data: failures >= MAX_FAILURES ? { totpFailures: 0, totpLockedUntil: new Date(Date.now() + LOCK_MS) } : { totpFailures: failures },
  });
  return false;
}
