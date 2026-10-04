/**
 * Customer identity rules (Phase 11 — BD-11.1, BD-11.6 a, BD-11.7; docs/PHASE_11_IMPLEMENTATION_CONTRACT.md §0, §5.1).
 *
 * The one principle: **unverified contact data never grants access.**
 * - A phone is a login identifier only once an OTP to that exact phone succeeded (`phoneVerifiedAt`); a partial unique index
 *   allows one verified owner per phone. Unverified phones are contact data and may repeat.
 * - An email is proven by the verification link, a password-reset link, a claim link, or Google's `email_verified`.
 * - An **unclaimed placeholder** (no password, no Google link, no verified phone — typically a guest-checkout record) may be
 *   claimed only after proving the identity it was matched by (email link or phone OTP). Claims attach credentials to the
 *   record; they never move orders, points, payments, refunds or addresses between customers.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { hashToken } from "../../lib/token-hash";
import { recordAudit } from "../../lib/audit";

export const OTP_MAX_ATTEMPTS = 5;
export const OTP_PHONE_LOCKOUT_WINDOW_MS = 30 * 60 * 1000;
export const OTP_PHONE_MAX_TOTAL_ATTEMPTS = 5;

type Db = Prisma.TransactionClient | typeof prisma;

/** A record nobody can sign in to and whose phone nobody has proven: claimable only with proof of the matched identity. */
export function isUnclaimedPlaceholder(c: { passwordHash: string | null; googleId: string | null; phoneVerifiedAt: Date | null }): boolean {
  return !c.passwordHash && !c.googleId && !c.phoneVerifiedAt;
}

/** The single verified owner of a phone (the partial unique index guarantees at most one), or null. */
export function findVerifiedPhoneOwner<S extends Prisma.CustomerSelect>(phone: string, select: S, db: Db = prisma) {
  return db.customer.findFirst({ where: { phone, phoneVerifiedAt: { not: null } }, select });
}

/** Wrong guesses this phone has used across every code in the lockout window (resending doesn't reset the budget). */
async function recentOtpAttempts(phone: string, db: Db): Promise<number> {
  const result = await db.phoneOtp.aggregate({
    where: { phone, createdAt: { gte: new Date(Date.now() - OTP_PHONE_LOCKOUT_WINDOW_MS) } },
    _sum: { attempts: true },
  });
  return result._sum.attempts ?? 0;
}

export async function assertPhoneOtpBudget(phone: string, db: Db = prisma) {
  if ((await recentOtpAttempts(phone, db)) >= OTP_PHONE_MAX_TOTAL_ATTEMPTS) {
    throw AppError.badRequest("Too many incorrect attempts recently — please try again later");
  }
}

/**
 * Checks a code against the newest unconsumed OTP for `phone`. A wrong guess consumes one attempt with a single conditional
 * statement (`attempts < max`), so concurrent wrong guesses can never exceed the per-code cap (F-05). Returns the OTP id on
 * success; the caller consumes it inside the transaction that acts on the proof.
 */
export async function checkPhoneOtp(phone: string, code: string): Promise<string> {
  const otp = await prisma.phoneOtp.findFirst({ where: { phone, consumedAt: null }, orderBy: { createdAt: "desc" } });
  if (!otp || otp.expiresAt < new Date()) throw AppError.badRequest("This code is invalid or has expired");
  if (otp.attempts >= OTP_MAX_ATTEMPTS) throw AppError.badRequest("Too many incorrect attempts — request a new code");
  await assertPhoneOtpBudget(phone);

  if (otp.codeHash !== hashToken(code)) {
    const used = await prisma.$queryRaw<Array<{ attempts: number }>>`
      UPDATE "PhoneOtp" SET attempts = attempts + 1 WHERE id = ${otp.id} AND attempts < ${OTP_MAX_ATTEMPTS} RETURNING attempts`;
    if (used.length === 0) throw AppError.badRequest("Too many incorrect attempts — request a new code");
    throw AppError.badRequest("Incorrect code");
  }
  return otp.id;
}

/** Consumes a checked OTP exactly once (a concurrent second use of the same code fails). */
export async function consumePhoneOtp(tx: Prisma.TransactionClient, otpId: string) {
  const consumed = await tx.phoneOtp.updateMany({ where: { id: otpId, consumedAt: null }, data: { consumedAt: new Date() } });
  if (consumed.count !== 1) throw AppError.badRequest("This code is invalid or has expired");
}

/** True when a write hit the verified-phone partial unique index (another customer verified this phone first). */
export function isVerifiedPhoneConflict(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return false;
  const target = (err.meta?.target ?? "") as string | string[];
  return (Array.isArray(target) ? target.join(",") : target).includes("phone") || String(err.message).includes("Customer_phone_verified_key");
}

export const PHONE_IN_USE = () => AppError.conflict("This phone number is already in use by another account");

/** Every claim of an existing record is audited (no admin actor — the customer proved ownership themselves). */
export function auditCustomerClaim(customerId: string, method: "email_link" | "phone_otp" | "google" | "password_reset") {
  recordAudit({ adminId: null, action: "customers.claim", entityType: "customers", entityId: customerId, metadata: { method } });
}
