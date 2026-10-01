import bcrypt from "bcryptjs";
import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { OAuth2Client } from "google-auth-library";
import {
  clampNonNegative,
  fromMajor,
  rewardableMerchandiseValue,
  subtract,
  toMajor,
  renderCustomerSmsTemplate,
  looksLikeFakePhone,
  normalizeBdPhone,
  type CustomerRegisterInput,
  type CustomerLoginInput,
  type VerifyOtpInput,
  type UpdateCustomerInput,
  type CreateAddressInput,
  type UpdateAddressInput,
  type PaginationQuery,
  type CustomerListQuery,
  type PushSubscribeInput,
  type CustomerTag,
  type UpdateCustomerAdminFieldsInput,
  type CreateCustomerAdminInput,
  type CustomerSmsVars,
  type ChangeCustomerPasswordInput,
  formatDate,
  formatMoney,
} from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { paginate } from "../../lib/paginate";
import { mapWithConcurrency } from "../../lib/concurrency";
import { issueCustomerSession, revokeAllCustomerSessions, rotateCustomerSession, revokeCustomerSession, type IssuedSession } from "./customer-sessions";
import {
  assertPhoneOtpBudget,
  auditCustomerClaim,
  checkPhoneOtp,
  consumePhoneOtp,
  findVerifiedPhoneOwner,
  isUnclaimedPlaceholder,
  isVerifiedPhoneConflict,
  PHONE_IN_USE,
} from "./customer-identity";
import { sendMail } from "../../lib/mailer";
import { sendSms } from "../../lib/sms";
import { getSteadfastFraudCheck } from "../../lib/steadfast";
import { renderEmailLayout } from "../../lib/email-template";
import { hashToken, signPayload, constantTimeEqual } from "../../lib/token-hash";
import { env } from "../../config/env";
import { getSettings } from "../settings/settings.service";
import { customerMetricsIndex } from "../../domain/metrics/metrics.service";
import { resolveStoreRange } from "../../domain/metrics/store-time";
import { getCommerceSettings, type CommerceSettings } from "../../domain/config/commerce-settings";

// Bulk sends dispatch this many recipients concurrently — same bound as campaign.service.ts's
// SEND_CONCURRENCY, for the same reason (bounded outbound connections to the SMS provider).
const SMS_SEND_CONCURRENCY = 10;

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const EMAIL_VERIFICATION_TTL_MS = 60 * 60 * 1000;
const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const CLAIM_TTL_MS = 60 * 60 * 1000;
// OTP attempt budgets (per code, and per phone across resends) live in ./customer-identity.ts.

/** See apps/api/src/modules/auth/auth.service.ts for why this exists — same timing-side-channel fix,
 * applied to customer login. */
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("no-account-has-this-password", 10);

const googleClient = env.google.clientId ? new OAuth2Client(env.google.clientId) : null;

const publicSelect = {
  id: true,
  name: true,
  email: true,
  emailVerifiedAt: true,
  phone: true,
  phoneVerifiedAt: true,
  smsMarketingOptIn: true,
  emailMarketingOptIn: true,
  rewardPoints: true,
  createdAt: true,
  updatedAt: true,
} as const;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export interface SessionOptions {
  persistent?: boolean;
  userAgent?: string | null;
}

/** Every successful sign-in opens a DB-tracked session family (Phase 11 — see ./customer-sessions.ts). */
function issueCustomerTokens(customerId: string, opts: SessionOptions = {}): Promise<IssuedSession> {
  return issueCustomerSession(customerId, opts);
}

/** Called from checkout (order.service.ts createOrder) for a guest — every order ends up tied to a Customer row.
 * Phase 11 (BD-11.7 a): a guest order joins an existing customer **only through a verified identity** — the customer whose
 * phone is verified as this phone, else the customer whose email is verified as this email. Otherwise it goes to an unclaimed
 * guest placeholder keyed by the exact (phone, email) pair — reused for repeat guests, never a login account — so no one can
 * see another person's orders merely because unverified contact data matches. Nothing already attached is moved. */
export async function findOrCreateGuestCustomer(
  name: string,
  email: string | null,
  phone: string,
): Promise<string> {
  const normalizedEmail = email ? normalizeEmail(email) : null;

  const verifiedPhoneOwner = await findVerifiedPhoneOwner(phone, { id: true });
  if (verifiedPhoneOwner) return verifiedPhoneOwner.id;

  let placeholderEmail = normalizedEmail;
  if (normalizedEmail) {
    const byEmail = await prisma.customer.findUnique({ where: { email: normalizedEmail } });
    if (byEmail?.emailVerifiedAt) return byEmail.id;
    if (byEmail) {
      // The email belongs to an unverified record: reuse it only when it is the same guest's placeholder (same phone);
      // otherwise neither attach to it nor key a new placeholder on an email someone else holds.
      if (isUnclaimedPlaceholder(byEmail) && byEmail.phone === phone) return byEmail.id;
      placeholderEmail = null;
    }
  }

  const findPlaceholder = () =>
    prisma.customer.findFirst({
      where: { phone, email: placeholderEmail, passwordHash: null, googleId: null, phoneVerifiedAt: null },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
  const existing = await findPlaceholder();
  if (existing) return existing.id;

  try {
    const created = await prisma.customer.create({
      data: { name, email: placeholderEmail, phone },
      select: { id: true },
    });
    return created.id;
  } catch (err) {
    // Two concurrent guest checkouts with the same new email/phone raced past the lookup above — the loser reuses the
    // winner's placeholder, same as the stock-decrement race handling in order.service.ts.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const race = await findPlaceholder();
      if (race) return race.id;
    }
    throw err;
  }
}

export type RegisterResult =
  | ({ claimPending: false; customer: Awaited<ReturnType<typeof getCustomerById>> } & IssuedSession)
  | { claimPending: true };

/** Phase 11 (BD-11.6 a): registration never takes over an existing record. A new email → a new account (any phone given is
 * unverified contact data — registration can't prove a phone, so it never claims by phone). An email held by an unclaimed
 * placeholder → a claim link is emailed; only following it (proof of the email) attaches this password to that record.
 * An email held by anything else → 409. */
export async function registerCustomer(input: CustomerRegisterInput, opts: SessionOptions = {}): Promise<RegisterResult> {
  const email = normalizeEmail(input.email);
  const existingByEmail = await prisma.customer.findUnique({ where: { email } });
  const passwordHash = await bcrypt.hash(input.password, 10);

  if (existingByEmail) {
    if (!isUnclaimedPlaceholder(existingByEmail)) throw AppError.conflict("An account with this email already exists");
    await startEmailClaim(existingByEmail.id, email, { passwordHash, name: input.name, phone: input.phone ?? null });
    return { claimPending: true };
  }

  const customer = await prisma.customer.create({
    data: { name: input.name, email, phone: input.phone ?? null, passwordHash },
    select: publicSelect,
  });

  // Best-effort: a transient email-provider hiccup should never block account creation, unlike
  // requestPasswordReset (a flow the customer explicitly retries) where letting it throw is fine.
  try {
    await sendVerificationEmail(customer.id);
  } catch (err) {
    console.error("[customer] failed to send verification email:", err);
  }

  return { claimPending: false, ...(await issueCustomerTokens(customer.id, opts)), customer };
}

async function startEmailClaim(customerId: string, email: string, pending: { passwordHash: string; name: string; phone: string | null }) {
  const token = crypto.randomBytes(32).toString("hex");
  await prisma.customerClaim.create({
    data: { customerId, tokenHash: hashToken(token), passwordHash: pending.passwordHash, name: pending.name, phone: pending.phone, expiresAt: new Date(Date.now() + CLAIM_TTL_MS) },
  });
  const claimUrl = `${env.webOrigin}/account/claim?token=${token}`;
  await sendMail({
    to: email,
    subject: "Confirm your account",
    html: await renderEmailLayout({
      bodyHtml: `
        <p style="margin:0 0 8px;font-size:18px;font-weight:600;">Confirm it's you</p>
        <p style="margin:0;">We already have orders under this email address. Confirm that this is your email to finish creating your account and see them. This link expires in 1 hour — if you didn't try to sign up, you can ignore it.</p>
      `,
      ctaLabel: "Confirm my account",
      ctaUrl: claimUrl,
    }),
  });
}

/** BD-11.6 a: the claim link proves the email; the pending password attaches to the placeholder atomically — a concurrent
 * second claim (or a record that gained a credential meanwhile) fails. Existing history stays exactly where it is. */
export async function confirmEmailClaim(token: string, opts: SessionOptions = {}) {
  const now = new Date();
  const customerId = await prisma.$transaction(async (tx) => {
    const claim = await tx.customerClaim.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!claim || claim.usedAt || claim.expiresAt < now) throw AppError.badRequest("This link is invalid or has expired");
    const used = await tx.customerClaim.updateMany({ where: { id: claim.id, usedAt: null }, data: { usedAt: now } });
    if (used.count !== 1) throw AppError.badRequest("This link is invalid or has expired");

    const claimed = await tx.customer.updateMany({
      where: { id: claim.customerId, passwordHash: null, googleId: null, phoneVerifiedAt: null },
      data: { passwordHash: claim.passwordHash, name: claim.name, emailVerifiedAt: now },
    });
    if (claimed.count !== 1) throw AppError.conflict("This account has already been set up — sign in instead");
    if (claim.phone) await tx.customer.updateMany({ where: { id: claim.customerId, phone: null }, data: { phone: claim.phone } });
    await tx.customerClaim.updateMany({ where: { customerId: claim.customerId, usedAt: null }, data: { usedAt: now } });
    return claim.customerId;
  });
  auditCustomerClaim(customerId, "email_link");
  const customer = await getCustomerById(customerId);
  return { ...(await issueCustomerTokens(customerId, opts)), customer };
}

export async function loginCustomer(input: CustomerLoginInput, opts: SessionOptions = {}) {
  const email = normalizeEmail(input.email);
  const customer = await prisma.customer.findUnique({ where: { email } });
  const passwordMatches = await bcrypt.compare(input.password, customer?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!customer || !customer.passwordHash || !passwordMatches) {
    throw AppError.unauthorized("Invalid email or password");
  }

  return {
    ...(await issueCustomerTokens(customer.id, { ...opts, persistent: input.rememberMe !== false })),
    customer: {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      emailVerifiedAt: customer.emailVerifiedAt,
      phone: customer.phone,
      phoneVerifiedAt: customer.phoneVerifiedAt,
      rewardPoints: customer.rewardPoints,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
    },
  };
}

/** Rotation with reuse detection — see ./customer-sessions.ts. */
export function refreshCustomerSession(refreshToken: string, userAgent?: string | null) {
  return rotateCustomerSession(refreshToken, userAgent);
}

export function logoutCustomer(refreshToken: string | undefined) {
  return revokeCustomerSession(refreshToken);
}

export function logoutEverywhere(customerId: string) {
  return revokeAllCustomerSessions(customerId, "logout_all");
}

export async function getCustomerById(customerId: string) {
  const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: publicSelect });
  if (!customer) throw AppError.notFound("Account not found");
  return customer;
}

/** BD-11.1: a verified login phone changes only through OTP verification of the new number (requestPhoneVerification /
 * confirmPhoneVerification) — until then the old verified phone stays the login. An unverified phone is contact data and
 * may be edited freely; it stays unverified. */
export async function updateCustomerProfile(customerId: string, input: UpdateCustomerInput) {
  const current = await getCustomerById(customerId);
  const data: Prisma.CustomerUpdateInput = { ...input };
  if (input.phone !== undefined && input.phone !== current.phone) {
    if (current.phoneVerifiedAt) throw AppError.conflict("Verify your new number with a code to change your sign-in phone");
    data.phoneVerifiedAt = null;
  }
  return prisma.customer.update({ where: { id: customerId }, data, select: publicSelect });
}

/** Sends an OTP to `phone` so the signed-in customer can verify it (their current phone, or a new login phone). */
export async function requestPhoneVerification(_customerId: string, phone: string) {
  await requestOtp(phone);
}

/** OTP proved `phone`: it becomes this customer's verified login phone (replacing any previous one). Another customer
 * already verified with it → 409 via the partial unique index; nothing changes. */
export async function confirmPhoneVerification(customerId: string, phone: string, code: string) {
  const otpId = await checkPhoneOtp(phone, code);
  try {
    return await prisma.$transaction(async (tx) => {
      await consumePhoneOtp(tx, otpId);
      return tx.customer.update({ where: { id: customerId }, data: { phone, phoneVerifiedAt: new Date() }, select: publicSelect });
    });
  } catch (err) {
    if (isVerifiedPhoneConflict(err)) throw PHONE_IN_USE();
    throw err;
  }
}

/** Set or change the password while signed in. Every session is revoked; the caller gets a fresh one for this device. */
export async function changeCustomerPassword(customerId: string, input: ChangeCustomerPasswordInput, opts: SessionOptions = {}) {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw AppError.notFound("Account not found");
  if (customer.passwordHash) {
    const ok = input.currentPassword ? await bcrypt.compare(input.currentPassword, customer.passwordHash) : false;
    if (!ok) throw AppError.badRequest("Your current password is incorrect");
  }
  const passwordHash = await bcrypt.hash(input.newPassword, 10);
  await prisma.$transaction(async (tx) => {
    await tx.customer.update({ where: { id: customerId }, data: { passwordHash } });
    await revokeAllCustomerSessions(customerId, "password_change", tx);
  });
  return issueCustomerTokens(customerId, opts);
}

export async function listAddresses(customerId: string) {
  return prisma.address.findMany({ where: { customerId }, orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }] });
}

async function getOwnedAddress(customerId: string, addressId: string) {
  const address = await prisma.address.findUnique({ where: { id: addressId } });
  if (!address || address.customerId !== customerId) throw AppError.notFound("Address not found");
  return address;
}

/** A DB-level partial unique index (migration add_address_one_default_per_customer) is the real
 * guard against two addresses ending up isDefault at once — this unset-then-set is just the normal
 * path. If two requests race, the loser hits that index and gets a clear conflict here instead of a
 * raw 500. */
async function runSetDefaultAddress<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  try {
    return await prisma.$transaction(fn);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw AppError.conflict("Another default-address update is in progress — please try again");
    }
    throw err;
  }
}

export async function createAddress(customerId: string, input: CreateAddressInput) {
  if (input.isDefault) {
    return runSetDefaultAddress(async (tx) => {
      await tx.address.updateMany({ where: { customerId, isDefault: true }, data: { isDefault: false } });
      return tx.address.create({ data: { ...input, customerId } });
    });
  }
  return prisma.address.create({ data: { ...input, customerId } });
}

export async function updateAddress(customerId: string, addressId: string, input: UpdateAddressInput) {
  await getOwnedAddress(customerId, addressId);

  if (input.isDefault) {
    return runSetDefaultAddress(async (tx) => {
      await tx.address.updateMany({ where: { customerId, isDefault: true }, data: { isDefault: false } });
      return tx.address.update({ where: { id: addressId }, data: input });
    });
  }
  return prisma.address.update({ where: { id: addressId }, data: input });
}

export async function deleteAddress(customerId: string, addressId: string) {
  await getOwnedAddress(customerId, addressId);
  await prisma.address.delete({ where: { id: addressId } });
}

export async function requestPasswordReset(email: string) {
  const customer = await prisma.customer.findUnique({ where: { email: normalizeEmail(email) } });
  // Always return successfully regardless of whether the email exists, so this endpoint
  // can't be used to enumerate registered accounts.
  if (!customer) return;
  // Phase 11: an account whose only proven sign-in is its phone, with an email nobody has proven, can't gain a password
  // through that email (its owner sets one while signed in instead) — silently, like an unknown email.
  if (isPhoneOnlyWithUnprovenEmail(customer)) return;

  const token = crypto.randomBytes(32).toString("hex");
  await prisma.passwordResetToken.create({
    data: {
      customerId: customer.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    },
  });

  const resetUrl = `${env.webOrigin}/account/reset-password?token=${token}`;
  await sendMail({
    // Non-null — customer was looked up by this exact email a few lines up.
    to: customer.email!,
    subject: "Reset your password",
    html: await renderEmailLayout({
      bodyHtml: `
        <p style="margin:0 0 8px;font-size:18px;font-weight:600;">Reset your password</p>
        <p style="margin:0;">We got a request to reset your password. This link expires in 1 hour — if you didn't ask for this, you can safely ignore it.</p>
      `,
      ctaLabel: "Reset password",
      ctaUrl: resetUrl,
    }),
  });
}

function isPhoneOnlyWithUnprovenEmail(c: { passwordHash: string | null; googleId: string | null; phoneVerifiedAt: Date | null; emailVerifiedAt: Date | null }) {
  return !c.passwordHash && !c.googleId && !!c.phoneVerifiedAt && !c.emailVerifiedAt;
}

/** The reset link proves the email. Every session is revoked (Phase 11) and tokenVersion bumps (legacy tokens too). A reset
 * on an unclaimed placeholder is a claim by email proof (BD-11.6 a) and is audited as one. */
export async function resetPassword(token: string, newPassword: string) {
  const tokenHash = hashToken(token);
  const resetToken = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });

  if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
    throw AppError.badRequest("This reset link is invalid or has expired");
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  const now = new Date();
  const wasPlaceholder = await prisma.$transaction(async (tx) => {
    const used = await tx.passwordResetToken.updateMany({ where: { id: resetToken.id, usedAt: null }, data: { usedAt: now } });
    if (used.count !== 1) throw AppError.badRequest("This reset link is invalid or has expired");
    const customer = await tx.customer.findUniqueOrThrow({ where: { id: resetToken.customerId } });
    if (isPhoneOnlyWithUnprovenEmail(customer)) throw AppError.badRequest("This reset link is invalid or has expired");
    await tx.customer.update({
      where: { id: customer.id },
      data: { passwordHash, emailVerifiedAt: customer.emailVerifiedAt ?? now },
    });
    await revokeAllCustomerSessions(customer.id, "password_reset", tx);
    return isUnclaimedPlaceholder(customer);
  });
  if (wasPlaceholder) auditCustomerClaim(resetToken.customerId, "password_reset");
}

// --- email verification ---

export async function sendVerificationEmail(customerId: string) {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  // A phone-only customer (no email on file) has nothing to verify.
  if (!customer || customer.emailVerifiedAt || !customer.email) return;

  const token = crypto.randomBytes(32).toString("hex");
  await prisma.emailVerificationToken.create({
    data: {
      customerId: customer.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
    },
  });

  const verifyUrl = `${env.webOrigin}/account/verify-email?token=${token}`;
  await sendMail({
    to: customer.email,
    subject: "Verify your email",
    html: await renderEmailLayout({
      bodyHtml: `
        <p style="margin:0 0 8px;font-size:18px;font-weight:600;">Verify your email</p>
        <p style="margin:0;">Confirm this is your email address to secure your account. This link expires in 1 hour.</p>
      `,
      ctaLabel: "Verify email",
      ctaUrl: verifyUrl,
    }),
  });
}

export async function resendVerificationEmail(customerId: string) {
  const customer = await getCustomerById(customerId);
  if (customer.emailVerifiedAt) throw AppError.badRequest("This email is already verified");
  await sendVerificationEmail(customerId);
}

export async function verifyEmail(token: string) {
  const tokenHash = hashToken(token);
  const verificationToken = await prisma.emailVerificationToken.findUnique({ where: { tokenHash } });

  if (!verificationToken || verificationToken.usedAt || verificationToken.expiresAt < new Date()) {
    throw AppError.badRequest("This verification link is invalid or has expired");
  }

  await prisma.$transaction([
    prisma.customer.update({ where: { id: verificationToken.customerId }, data: { emailVerifiedAt: new Date() } }),
    prisma.emailVerificationToken.update({ where: { id: verificationToken.id }, data: { usedAt: new Date() } }),
  ]);
}

// --- google sign-in ---

export async function loginWithGoogle(idToken: string) {
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
  return signInWithGoogleIdentity({ sub: payload.sub, email: payload.email, emailVerified: payload.email_verified, name: payload.name });
}

/** Phase 11 (F-27, BD-11.6 a). Google proves an email only when it says so (`email_verified`). A proven Google email may:
 * create a new account; claim an unclaimed placeholder with that email; or link to an account whose email is itself
 * verified. It never links to an account whose email nobody has proven (that account's owner may not own the address). */
export async function signInWithGoogleIdentity(identity: { sub: string; email: string; emailVerified?: boolean | null; name?: string | null }, opts: SessionOptions = {}) {
  if (identity.emailVerified !== true) {
    throw AppError.unauthorized("Google couldn't confirm this email address — sign in another way");
  }
  const googleId = identity.sub;
  const email = normalizeEmail(identity.email);
  const name = identity.name ?? email;

  let customer = await prisma.customer.findUnique({ where: { googleId }, select: publicSelect });
  if (!customer) {
    const existing = await prisma.customer.findUnique({ where: { email } });
    if (!existing) {
      customer = await prisma.customer.create({ data: { name, email, googleId, emailVerifiedAt: new Date() }, select: publicSelect });
    } else if (existing.googleId) {
      throw AppError.conflict("This email is linked to a different Google account");
    } else if (isUnclaimedPlaceholder(existing) || existing.emailVerifiedAt) {
      const wasPlaceholder = isUnclaimedPlaceholder(existing);
      const linked = await prisma.customer.updateMany({
        where: { id: existing.id, googleId: null },
        data: { googleId, emailVerifiedAt: existing.emailVerifiedAt ?? new Date() },
      });
      if (linked.count !== 1) throw AppError.conflict("This account was just updated — please try again");
      if (wasPlaceholder) auditCustomerClaim(existing.id, "google");
      customer = await getCustomerById(existing.id);
    } else {
      throw AppError.conflict("An account with this email already exists — sign in with your password or phone and verify your email first");
    }
  }

  return { ...(await issueCustomerTokens(customer.id, opts)), customer };
}

// --- phone / OTP sign-in ---

function generateOtpCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export async function requestOtp(phone: string) {
  const recent = await prisma.phoneOtp.findFirst({
    where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (recent && Date.now() - recent.createdAt.getTime() < OTP_RESEND_COOLDOWN_MS) {
    throw AppError.badRequest("Please wait a moment before requesting another code");
  }

  await assertPhoneOtpBudget(phone);

  const code = generateOtpCode();
  await prisma.phoneOtp.create({
    data: { phone, codeHash: hashToken(code), expiresAt: new Date(Date.now() + OTP_TTL_MS) },
  });

  await sendSms({ to: phone, body: `Your verification code is ${code}. It expires in 5 minutes.` });
}

/** Phone OTP sign-in (Phase 11 — BD-11.1, BD-11.6 a, F-26).
 * - A customer whose phone is **verified** as this phone → signed in.
 * - Otherwise no unverified profile is ever signed in by this OTP. With a name and email, the proof of the phone may claim the
 *   unclaimed placeholder of this phone (one holding this email, else one with no email), or create a new account — the phone
 *   becomes verified; the email stays **unverified** until its own verification link is followed. */
export async function verifyOtp(input: VerifyOtpInput, opts: SessionOptions = {}) {
  const otpId = await checkPhoneOtp(input.phone, input.code);

  const verified = await findVerifiedPhoneOwner(input.phone, publicSelect);
  if (verified) {
    await prisma.$transaction((tx) => consumePhoneOtp(tx, otpId));
    return { ...(await issueCustomerTokens(verified.id, opts)), customer: verified };
  }

  // Deliberately NOT consuming the code yet if we're about to bounce back for name/email — the frontend resubmits the same
  // code once it has them (still the same single verified possession of the phone, just split across two requests).
  if (!input.name || !input.email) throw new AppError(422, "NEW_PHONE_NEEDS_PROFILE");

  const email = normalizeEmail(input.email);
  const now = new Date();
  let claimedId: string | null = null;
  let customerId: string;
  try {
    customerId = await prisma.$transaction(async (tx) => {
      await consumePhoneOtp(tx, otpId);
      const byEmail = await tx.customer.findUnique({ where: { email } });
      if (byEmail && !(isUnclaimedPlaceholder(byEmail) && byEmail.phone === input.phone)) {
        throw AppError.conflict("An account with this email already exists — sign in with email instead");
      }
      const target =
        byEmail ??
        (await tx.customer.findFirst({
          where: { phone: input.phone, email: null, passwordHash: null, googleId: null, phoneVerifiedAt: null },
          orderBy: { createdAt: "asc" },
        }));
      if (target) {
        const claimed = await tx.customer.updateMany({
          where: { id: target.id, passwordHash: null, googleId: null, phoneVerifiedAt: null },
          data: { name: input.name!, email, phone: input.phone, phoneVerifiedAt: now },
        });
        if (claimed.count !== 1) throw AppError.conflict("This account was just updated — please try again");
        claimedId = target.id;
        return target.id;
      }
      const created = await tx.customer.create({ data: { name: input.name!, email, phone: input.phone, phoneVerifiedAt: now }, select: { id: true } });
      return created.id;
    });
  } catch (err) {
    if (isVerifiedPhoneConflict(err)) throw PHONE_IN_USE();
    throw err;
  }
  if (claimedId) auditCustomerClaim(claimedId, "phone_otp");

  // The email was not proven by this OTP — send its own verification link (best effort).
  try {
    await sendVerificationEmail(customerId);
  } catch (err) {
    console.error("[customer] failed to send verification email:", err);
  }
  const customer = await getCustomerById(customerId);
  return { ...(await issueCustomerTokens(customerId, opts)), customer };
}

// --- admin ---

/** Lifetime-spend cutoffs (BDT) shared by the VIP/High Spender tags and (later) the loyalty-tier
 * display — Bronze is implicitly "below Silver". Suggested defaults; not yet exposed as an editable
 * setting (Phase 3 of the CRM build), so change here if the store wants different thresholds. */
const LOYALTY_THRESHOLDS = { silver: 10_000, gold: 30_000, platinum: 75_000 };
const NEW_CUSTOMER_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const INACTIVE_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

// A customer this cancel-prone is either a serial fake-orderer or has a real recurring problem
// either way, worth a human look. Only counted once there's enough history to mean something —
// one cancelled order out of one is normal buyer's remorse, not a pattern.
const CANCEL_RATE_REVIEW_THRESHOLD = 0.5;
const CANCEL_RATE_MIN_ORDERS = 3;
const HOLD_COUNT_REVIEW_THRESHOLD = 2;

/** Signals a human should look at, not proof of anything — a real customer can have a fake-looking
 * number (rare vanity/sequential numbers exist) or a bad delivery run for reasons that aren't their
 * fault. Returned as explainable strings (shown in the drawer) rather than a bare score, so an admin
 * can judge "why" instead of trusting an opaque flag. */
function computeRiskSignals(input: {
  phone: string | null;
  totalOrders: number;
  cancelledOrders: number;
  holdOrders: number;
}): string[] {
  const signals: string[] = [];
  if (input.phone && looksLikeFakePhone(input.phone)) {
    signals.push("Phone number matches a common fake/dummy pattern");
  }
  if (input.totalOrders >= CANCEL_RATE_MIN_ORDERS && input.cancelledOrders / input.totalOrders >= CANCEL_RATE_REVIEW_THRESHOLD) {
    signals.push(`${input.cancelledOrders} of ${input.totalOrders} orders were cancelled`);
  }
  if (input.holdOrders >= HOLD_COUNT_REVIEW_THRESHOLD) {
    signals.push(`Courier marked ${input.holdOrders} order(s) as hold/undeliverable`);
  }
  return signals;
}

function computeCustomerTags(input: {
  createdAt: Date;
  totalOrders: number;
  totalSpent: number;
  lastOrderAt: Date | null;
  isBlocked: boolean;
  codRisk: boolean;
  riskSignals: string[];
}): CustomerTag[] {
  const tags: CustomerTag[] = [];
  const now = Date.now();

  if (input.isBlocked) tags.push("BLOCKED");
  if (input.riskSignals.length > 0) tags.push("SUSPICIOUS");
  if (input.codRisk) tags.push("COD_RISK");
  if (input.totalSpent >= LOYALTY_THRESHOLDS.platinum) tags.push("VIP");
  else if (input.totalSpent >= LOYALTY_THRESHOLDS.gold) tags.push("HIGH_SPENDER");
  if (input.totalOrders >= 2) tags.push("REPEAT");
  if (now - input.createdAt.getTime() < NEW_CUSTOMER_WINDOW_MS) tags.push("NEW");

  const staleSince = input.lastOrderAt ? now - input.lastOrderAt.getTime() : now - input.createdAt.getTime();
  if (staleSince >= INACTIVE_WINDOW_MS) tags.push("INACTIVE");

  return tags;
}

const adminSelect = {
  ...publicSelect,
  adminNotes: true,
  isBlocked: true,
  codRisk: true,
} as const;

/** One shared query + tag/stat computation behind listCustomersAdmin, getCustomerStatsAdmin, and
 * (Section 6 BI) analytics.service.ts's RFM table / purchase-frequency distribution — fetches
 * every customer matching `where` with just enough order/address data to derive
 * totalOrders/totalSpent/lastOrderAt/district/tags in JS. Fine at this store's customer volumes
 * (computed once per request, not per row); a raw aggregate query would be the next step if the
 * customer base grows into the tens of thousands. Exported (not just used internally) so BI reads
 * derive from the exact same tag logic the customers list already shows, rather than a
 * re-derived approximation that could quietly drift out of sync with it. */
export async function loadCustomersWithComputedFields(where: Prisma.CustomerWhereInput) {
  const [customers, metrics] = await Promise.all([
    prisma.customer.findMany({
      where,
      select: {
        ...adminSelect,
        addresses: { where: { isDefault: true }, take: 1, select: { district: true } },
        orders: {
          where: { deletedAt: null },
          select: { status: true, createdAt: true, shippingDistrict: true, courierStatus: true },
          orderBy: { createdAt: "desc" },
        },
      },
    }),
    customerMetricsIndex(),
  ]);

  return customers.map(({ addresses, orders, ...customer }) => {
    // Spend and order count are the canonical customer metrics (docs/METRICS_REGISTRY.md §4.3, P5-4): realised net sales
    // and sale orders — the same facts as store revenue. Risk signals keep counting every non-trashed order, since a
    // cancellation rate needs the cancelled ones.
    const canonical = metrics.get(customer.id);
    const totalOrders = canonical?.orders ?? 0;
    const totalSpent = canonical?.netSpend ?? 0;
    const cancelledOrders = orders.filter((o) => o.status === "CANCELLED").length;
    const holdOrders = orders.filter((o) => o.courierStatus === "hold").length;
    const lastOrderAt = orders[0]?.createdAt ?? null;
    const district = addresses[0]?.district ?? orders[0]?.shippingDistrict ?? null;
    const riskSignals = computeRiskSignals({ phone: customer.phone, totalOrders: orders.length, cancelledOrders, holdOrders });
    const tags = computeCustomerTags({
      createdAt: customer.createdAt,
      totalOrders,
      totalSpent,
      lastOrderAt,
      isBlocked: customer.isBlocked,
      codRisk: customer.codRisk,
      riskSignals,
    });
    return { ...customer, totalOrders, totalSpent, lastOrderAt, district, tags };
  });
}

type ComputedCustomer = Awaited<ReturnType<typeof loadCustomersWithComputedFields>>[number];

function compareComputed(a: ComputedCustomer, b: ComputedCustomer, sortBy: NonNullable<CustomerListQuery["sortBy"]>) {
  switch (sortBy) {
    case "name":
      return a.name.localeCompare(b.name);
    case "totalSpent":
      return a.totalSpent - b.totalSpent;
    case "totalOrders":
      return a.totalOrders - b.totalOrders;
    case "lastOrderAt":
      return (a.lastOrderAt?.getTime() ?? 0) - (b.lastOrderAt?.getTime() ?? 0);
    case "createdAt":
    default:
      return a.createdAt.getTime() - b.createdAt.getTime();
  }
}

export async function listCustomersAdmin(query: CustomerListQuery) {
  const where: Prisma.CustomerWhereInput = query.search
    ? {
        OR: [
          { name: { contains: query.search, mode: "insensitive" as const } },
          { email: { contains: query.search, mode: "insensitive" as const } },
          { phone: { contains: query.search } },
          // Lets an admin land on a customer straight from an order number (e.g. from a support chat)
          // without a separate trip through the Orders page.
          { orders: { some: { orderNumber: { contains: query.search, mode: "insensitive" as const } } } },
        ],
      }
    : {};

  let computed = await loadCustomersWithComputedFields(where);

  if (query.tag) computed = computed.filter((c) => c.tags.includes(query.tag!));
  if (query.district) computed = computed.filter((c) => c.district === query.district);
  if (query.noOrders === "true") computed = computed.filter((c) => c.totalOrders === 0);
  if (query.lastOrderDays) {
    const cutoff = Date.now() - query.lastOrderDays * 24 * 60 * 60 * 1000;
    computed = computed.filter((c) => (c.lastOrderAt?.getTime() ?? 0) >= cutoff);
  }
  if (query.minSpend !== undefined) computed = computed.filter((c) => c.totalSpent >= query.minSpend!);
  if (query.minOrders !== undefined) computed = computed.filter((c) => c.totalOrders >= query.minOrders!);

  const sortBy = query.sortBy ?? "createdAt";
  const sortDir = query.sortDir ?? "desc";
  computed.sort((a, b) => (sortDir === "asc" ? 1 : -1) * compareComputed(a, b, sortBy));

  const total = computed.length;
  const start = (query.page - 1) * query.pageSize;
  const page = computed.slice(start, start + query.pageSize);

  // "Last SMS sent" per row — cheap to look up in one grouped query against just this page's ids
  // rather than folding it into loadCustomersWithComputedFields for every customer up front.
  const lastSmsByCustomer = await prisma.campaignRecipient.groupBy({
    by: ["customerId"],
    where: { customerId: { in: page.map((c) => c.id) }, sentAt: { not: null } },
    _max: { sentAt: true },
  });
  const lastSmsMap = new Map(lastSmsByCustomer.map((r) => [r.customerId, r._max.sentAt]));

  return {
    items: page.map((c) => ({ ...c, lastSmsSentAt: lastSmsMap.get(c.id) ?? null })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function getCustomerStatsAdmin() {
  const now = new Date();
  // Business-day boundaries in the store timezone (docs/METRICS_REGISTRY.md §1), not the server's local midnight.
  const [computed, today, month] = await Promise.all([
    loadCustomersWithComputedFields({}),
    resolveStoreRange({ preset: "today" }, now),
    resolveStoreRange({ preset: "this_month" }, now),
  ]);
  const startOfToday = today.startUtc;
  const startOfMonth = month.startUtc;

  function inactiveSince(days: number) {
    const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
    return computed.filter((c) => (c.lastOrderAt ? c.lastOrderAt.getTime() < cutoff : c.createdAt.getTime() < cutoff))
      .length;
  }

  return {
    totalCustomers: computed.length,
    newToday: computed.filter((c) => c.createdAt >= startOfToday).length,
    newThisMonth: computed.filter((c) => c.createdAt >= startOfMonth).length,
    repeatCustomers: computed.filter((c) => c.totalOrders >= 2).length,
    lifetimeRevenue: computed.reduce((sum, c) => sum + c.totalSpent, 0),
    vipCustomers: computed.filter((c) => c.tags.includes("VIP")).length,
    // Added for Section 6 BI ("High-Risk Customers" / "One-Time Buyers") — cheap to add here since
    // `computed` already holds everything needed; avoids a second full-customer-table scan.
    suspiciousCount: computed.filter((c) => c.tags.includes("SUSPICIOUS")).length,
    codRiskCount: computed.filter((c) => c.tags.includes("COD_RISK")).length,
    blockedCount: computed.filter((c) => c.tags.includes("BLOCKED")).length,
    oneTimeBuyers: computed.filter((c) => c.totalOrders === 1).length,
    inactive30: inactiveSince(30),
    inactive60: inactiveSince(60),
    inactive90: inactiveSince(90),
  };
}

export async function getCustomerDetailAdmin(customerId: string) {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      ...adminSelect,
      addresses: { orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }] },
      orders: { orderBy: { createdAt: "desc" }, take: 20, include: { items: true } },
      wishlistItems: { include: { product: { select: { id: true, name: true, slug: true } } } },
      pointsLedger: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  if (!customer) throw AppError.notFound("Customer not found");

  const [metrics, orderCounts, holdOrders, smsRecipients] = await Promise.all([
    customerMetricsIndex(),
    prisma.order.groupBy({ by: ["status"], where: { customerId, deletedAt: null }, _count: true }),
    prisma.order.count({ where: { customerId, deletedAt: null, courierStatus: "hold" } }),
    prisma.campaignRecipient.findMany({
      where: { customerId },
      include: { campaign: { select: { id: true, name: true, body: true, channel: true } } },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);

  // Canonical customer metrics (P5-4): the same net spend and sale-order count as the CRM list, BI and store revenue.
  const canonical = metrics.get(customerId);
  const totalSpent = canonical?.netSpend ?? 0;
  const saleOrders = canonical?.orders ?? 0;
  const realisedOrders = canonical?.realisedOrders ?? 0;
  const countsByStatus = new Map(orderCounts.map((r) => [r.status, r._count]));
  const totalOrders = orderCounts.reduce((sum, r) => sum + r._count, 0);
  const deliveredOrders = countsByStatus.get("DELIVERED") ?? 0;
  const cancelledOrders = countsByStatus.get("CANCELLED") ?? 0;
  const returnedOrders = countsByStatus.get("RETURNED") ?? 0;

  const lastOrderAt = customer.orders[0]?.createdAt ?? null;
  const district = customer.addresses.find((a) => a.isDefault)?.district ?? customer.orders[0]?.shippingDistrict ?? null;
  const riskSignals = computeRiskSignals({ phone: customer.phone, totalOrders, cancelledOrders, holdOrders });
  const tags = computeCustomerTags({
    createdAt: customer.createdAt,
    totalOrders: saleOrders,
    totalSpent,
    lastOrderAt,
    isBlocked: customer.isBlocked,
    codRisk: customer.codRisk,
    riskSignals,
  });

  // Favorite products — aggregated from the recently-fetched orders (capped at 20 above) rather
  // than a full unpaginated item scan; fine at this store's order volumes, revisit if that changes.
  const productTotals = new Map<string, { name: string; quantity: number }>();
  for (const order of customer.orders) {
    for (const item of order.items) {
      const existing = productTotals.get(item.skuSnapshot);
      if (existing) existing.quantity += item.quantity;
      else productTotals.set(item.skuSnapshot, { name: item.productNameSnapshot, quantity: item.quantity });
    }
  }
  const favoriteProducts = [...productTotals.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 5);

  const smsHistory = smsRecipients.map((r) => ({
    id: r.id,
    campaignId: r.campaignId,
    campaignName: r.campaign.name,
    body: r.renderedBody ?? r.campaign.body,
    status: r.status,
    sentAt: r.sentAt,
    error: r.error,
    createdAt: r.createdAt,
  }));

  const timeline = [
    ...customer.orders.map((o) => ({
      type: "ORDER" as const,
      date: o.createdAt,
      label: `Order ${o.orderNumber} placed`,
      detail: o.status,
    })),
    ...customer.pointsLedger.map((p) => ({
      type: "POINTS" as const,
      date: p.createdAt,
      label: p.reason,
      detail: `${p.points >= 0 ? "+" : ""}${p.points} pts`,
    })),
    ...smsRecipients
      .filter((r) => r.sentAt)
      .map((r) => ({
        type: "SMS" as const,
        date: r.sentAt!,
        label: `SMS sent — ${r.campaign.name}`,
        detail: (r.renderedBody ?? r.campaign.body).slice(0, 80),
      })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());

  return {
    ...customer,
    totalSpent,
    totalOrders,
    lastOrderAt,
    district,
    tags,
    riskSignals,
    favoriteProducts,
    purchaseAnalytics: {
      totalOrders,
      deliveredOrders,
      cancelledOrders,
      returnRate: totalOrders > 0 ? (returnedOrders / totalOrders) * 100 : 0,
      // Registry `aov` basis: net sales ÷ realised orders (P5-5).
      averageOrderValue: realisedOrders > 0 ? Math.round((totalSpent / realisedOrders) * 100) / 100 : 0,
      lifetimeSpend: totalSpent,
    },
    smsHistory,
    timeline,
  };
}

/** Manual add for someone who reached out (DM/call) instead of ordering through the storefront —
 * unlike findOrCreateGuestCustomer this rejects a phone/email that already matches an existing
 * customer rather than silently reusing it, since the admin is consciously creating a new record
 * and a silent merge would look like their new customer vanished. */
export async function createCustomerAdmin(input: CreateCustomerAdminInput) {
  const email = input.email ? normalizeEmail(input.email) : null;
  const or: Prisma.CustomerWhereInput[] = [{ phone: input.phone }];
  if (email) or.push({ email });

  const existing = await prisma.customer.findFirst({ where: { OR: or }, select: { id: true, name: true } });
  if (existing) {
    throw AppError.conflict(`A customer with this phone or email already exists (${existing.name})`);
  }

  return prisma.customer.create({
    data: { name: input.name, phone: input.phone, email, adminNotes: input.adminNotes ?? null },
    select: adminSelect,
  });
}

export async function updateCustomerAdminFields(customerId: string, input: UpdateCustomerAdminFieldsInput) {
  const exists = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
  if (!exists) throw AppError.notFound("Customer not found");
  return prisma.customer.update({ where: { id: customerId }, data: input, select: adminSelect });
}

/** {{variable}} context for a given computed customer — shared by the individual and bulk send
 * paths below so a template renders identically regardless of which one sent it. */
function customerSmsVars(c: { name: string; phone: string; totalSpent: number; lastOrderAt: Date | null }, commerce: CommerceSettings): CustomerSmsVars {
  return {
    customerName: c.name,
    firstName: c.name.split(" ")[0] || c.name,
    phone: c.phone,
    totalSpent: formatMoney(Math.round(c.totalSpent), commerce.currency),
    lastOrder: c.lastOrderAt ? formatDate(c.lastOrderAt, commerce.timezone, { year: "numeric", month: "long", day: "numeric" }) : "no orders yet",
    website: env.webOrigin,
  };
}

/** Sends one already-rendered SMS and records it as a CampaignRecipient under the given campaign
 * — the shared unit both sendAdHocSmsToCustomer (its own one-off Campaign) and
 * sendBulkSmsToCustomers (many recipients sharing one Campaign) build on. */
async function dispatchAndLogSms(campaignId: string, customerId: string, phone: string, renderedBody: string) {
  const recipient = await prisma.campaignRecipient.create({
    data: { campaignId, customerId, renderedBody },
  });
  try {
    await sendSms({ to: phone, body: renderedBody });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to send SMS";
    await prisma.campaignRecipient.update({ where: { id: recipient.id }, data: { status: "FAILED", error: message } });
    return { status: "FAILED" as const, error: message };
  }
  await prisma.campaignRecipient.update({ where: { id: recipient.id }, data: { status: "SENT", sentAt: new Date() } });
  return { status: "SENT" as const };
}

/** A direct 1:1 admin message — unlike Campaign sends, this is NOT gated by smsMarketingOptIn (that
 * flag is specifically marketing consent; this is the same trust level as an admin manually texting
 * a customer, e.g. "call before delivery"). Logged as a one-recipient Campaign/CampaignRecipient pair
 * purely so it shows up in this customer's SMS history/"last SMS sent" alongside real campaign sends
 * — see the module doc comment in campaign.service.ts for why that's the shared history model. */
export async function sendAdHocSmsToCustomer(customerId: string, body: string) {
  const [customer] = await loadCustomersWithComputedFields({ id: customerId });
  if (!customer) throw AppError.notFound("Customer not found");
  if (!customer.phone) throw AppError.badRequest("This customer has no phone number on file");

  const rendered = renderCustomerSmsTemplate(body, customerSmsVars({ ...customer, phone: customer.phone }, await getCommerceSettings()));
  const campaign = await prisma.campaign.create({
    data: { name: "Direct message", channel: "SMS", body, status: "SENDING" },
  });
  const result = await dispatchAndLogSms(campaign.id, customerId, customer.phone, rendered);
  await prisma.campaign.update({
    where: { id: campaign.id },
    data: result.status === "SENT" ? { status: "SENT", sentAt: new Date() } : { status: "FAILED" },
  });

  if (result.status === "FAILED") throw AppError.badRequest(result.error ?? "Failed to send SMS");
  return { ok: true as const, sentAt: new Date() };
}

/** Bulk send — every recipient rolls up under one shared Campaign row (unlike N separate ad-hoc
 * sends) so a batch reads as a single grouped item rather than N unrelated "Direct message" rows.
 * Not gated by smsMarketingOptIn, for the same reason as sendAdHocSmsToCustomer: the admin is
 * manually curating an exact recipient list here — 1 or 50 customers makes no difference to that —
 * not targeting a broad algorithmic segment the way a real Campaign send does. */
export async function sendBulkSmsToCustomers(customerIds: string[], body: string) {
  const customers = await loadCustomersWithComputedFields({ id: { in: customerIds } });
  const withPhone = customers.filter((c) => Boolean(c.phone)) as Array<ComputedCustomer & { phone: string }>;
  if (withPhone.length === 0) throw AppError.badRequest("None of the selected customers have a phone number on file");

  const campaign = await prisma.campaign.create({
    data: { name: `Bulk message (${withPhone.length} recipients)`, channel: "SMS", body, status: "SENDING" },
  });

  let sent = 0;
  let failed = 0;
  const commerce = await getCommerceSettings();
  await mapWithConcurrency(withPhone, SMS_SEND_CONCURRENCY, async (c) => {
    const rendered = renderCustomerSmsTemplate(body, customerSmsVars(c, commerce));
    const result = await dispatchAndLogSms(campaign.id, c.id, c.phone, rendered);
    if (result.status === "SENT") sent++;
    else failed++;
  });

  await prisma.campaign.update({
    where: { id: campaign.id },
    data: { status: sent > 0 ? "SENT" : "FAILED", sentAt: new Date() },
  });

  return { sent, failed, skipped: customers.length - withPhone.length };
}

/** D8: the order's rewardable merchandise value (`rewardableMerchandiseValue`, PRICING_INVARIANTS PI-9.4) from its own
 * snapshot: subtotal − bundle discount − coupon discount (− exchange credit on an exchange replacement order). Shipping,
 * shipping VAT, tax and the admin price adjustment are not inputs, so they can never be rewarded. */
export function loyaltyBase(
  order: { subtotal: unknown; discount: unknown; bundleDiscount: unknown; couponDiscount: unknown | null },
  currency: string,
): number {
  const m = (v: unknown) => fromMajor(String(v ?? 0), currency);
  const bundle = m(order.bundleDiscount);
  // Pre-Phase-2 rows without a coupon split: the coupon's share is the rest of `discount` (the migration backfill rule).
  const coupon = order.couponDiscount === null || order.couponDiscount === undefined ? clampNonNegative(subtract(m(order.discount), bundle)) : m(order.couponDiscount);
  // Whatever `discount` holds beyond bundle + coupon is an exchange replacement's credit (see return-request.service).
  const exchangeCredit = clampNonNegative(subtract(subtract(m(order.discount), bundle), coupon));
  return toMajor(rewardableMerchandiseValue({ subtotal: m(order.subtotal), bundleDiscount: bundle, couponDiscount: coupon, exchangeCredit }));
}

/** The transaction a loyalty write runs in — only what it touches, so both the app's and a raw Prisma transaction fit. */
type LoyaltyTx = Pick<Prisma.TransactionClient, "$queryRaw" | "rewardPointsEntry" | "customer">;

/** Awards points for a delivered order, INSIDE the delivery transaction (Phase 8: points are business truth — they commit
 * or roll back with the transition, never after it). Idempotent per order: the customer row is locked first, so two
 * concurrent deliveries can't both see "no award yet". No-ops while the store hasn't configured a reward rate.
 * `merchandiseBase` is loyaltyBase(order) (D8). */
export async function awardDeliveryPoints(tx: LoyaltyTx, customerId: string, orderId: string, merchandiseBase: number) {
  const settings = await getSettings();
  const rate = Number(settings.rewardPointsPerCurrency);
  if (rate <= 0) return;

  await tx.$queryRaw`SELECT id FROM "Customer" WHERE id = ${customerId} FOR UPDATE`;
  const already = await tx.rewardPointsEntry.findFirst({ where: { orderId, reason: "order_delivered" } });
  if (already) return;

  const points = Math.floor(merchandiseBase * rate);
  if (points <= 0) return;

  await tx.rewardPointsEntry.create({ data: { customerId, orderId, points, reason: "order_delivered" } });
  await tx.customer.update({ where: { id: customerId }, data: { rewardPoints: { increment: points } } });
}

/** D8: reverses the points an order earned, in proportion to the merchandise that came back or was refunded
 * (`fraction` 1 = all). Never reverses more than the order earned in total, however many returns/refunds follow, and
 * never takes the balance below zero; the ledger row records exactly what was reversed. Runs in the caller's transaction
 * (the return/refund that causes it — Phase 8). */
export async function reverseDeliveryPoints(tx: LoyaltyTx, customerId: string, orderId: string, fraction: number) {
  const f = Math.min(1, Math.max(0, fraction));
  if (f <= 0) return;
  const [customer] = await tx.$queryRaw<Array<{ rewardPoints: number }>>`SELECT "rewardPoints" FROM "Customer" WHERE id = ${customerId} FOR UPDATE`;
  if (!customer) return;
  const entries = await tx.rewardPointsEntry.findMany({ where: { orderId, reason: { in: ["order_delivered", "order_reversed"] } } });
  const earned = entries.filter((e) => e.reason === "order_delivered").reduce((a, e) => a + e.points, 0);
  const reversed = -entries.filter((e) => e.reason === "order_reversed").reduce((a, e) => a + e.points, 0);
  const wanted = Math.min(earned - reversed, Math.floor(earned * f));
  const points = Math.min(wanted, Math.max(0, customer.rewardPoints));
  if (points <= 0) return;
  await tx.rewardPointsEntry.create({ data: { customerId, orderId, points: -points, reason: "order_reversed" } });
  await tx.customer.update({ where: { id: customerId }, data: { rewardPoints: { decrement: points } } });
}

/** One Steadfast fraud_check call for a customer, cached onto their Customer row (fraud_check is
 * keyed by phone, not order, so every one of that customer's orders shares the same cached score).
 * Shared by the auto-check fired right after checkout (order.service.ts's insertOrderRecord) and
 * the admin "Check score" bulk action (courier.service.ts's checkDeliveryScoresBulk). Throws on
 * failure — the checkout call site must catch and log rather than let it fail the order. */
export async function checkAndUpdateDeliveryScore(customerId: string, rawPhone: string) {
  const phone = normalizeBdPhone(rawPhone);
  const result = await getSteadfastFraudCheck(phone);
  await prisma.customer.update({
    where: { id: customerId },
    data: {
      deliveryTotalParcels: result.totalParcels,
      deliverySuccessParcels: result.successParcels,
      deliveryCancelledParcels: result.cancelledParcels,
      deliverySuccessRate: result.successRate,
      deliveryScoreCheckedAt: new Date(),
    },
  });
  return result;
}

export async function adjustRewardPoints(customerId: string, points: number, reason: string) {
  if (points === 0) throw AppError.badRequest("Point adjustment cannot be zero");
  await getCustomerById(customerId);

  // Phase 9 (D-6): the balance check and the write happen under the customer row lock, so two concurrent deductions can't
  // both pass the check and take the balance below zero.
  await prisma.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<Array<{ rewardPoints: number }>>`SELECT "rewardPoints" FROM "Customer" WHERE id = ${customerId} FOR UPDATE`;
    if (!row) throw AppError.notFound("Customer not found");
    if (row.rewardPoints + points < 0) throw AppError.badRequest(`Customer only has ${row.rewardPoints} points`);
    await tx.rewardPointsEntry.create({ data: { customerId, points, reason: reason || "Manual adjustment" } });
    await tx.customer.update({ where: { id: customerId }, data: { rewardPoints: { increment: points } } });
  });

  return prisma.customer.findUnique({ where: { id: customerId }, select: publicSelect });
}

/** Phase 9 (D-7) — read-only loyalty reconciliation: every points writer changes the ledger (RewardPointsEntry) and the
 * cached balance (Customer.rewardPoints) together, so any customer whose balance ≠ Σ ledger has drifted. Reported, never
 * auto-corrected (a repair is an explained manual adjustment). */
export async function loyaltyDrift(limit = 100) {
  return prisma.$queryRaw<Array<{ customerId: string; name: string; balance: number; ledgerSum: number }>>`
    SELECT c.id AS "customerId", c.name, c."rewardPoints" AS balance, COALESCE(SUM(e.points), 0)::int AS "ledgerSum"
    FROM "Customer" c
    LEFT JOIN "RewardPointsEntry" e ON e."customerId" = c.id
    GROUP BY c.id, c.name, c."rewardPoints"
    HAVING c."rewardPoints" <> COALESCE(SUM(e.points), 0)
    ORDER BY c.name
    LIMIT ${limit}`;
}

export async function listCustomerOrders(customerId: string, query: PaginationQuery) {
  const where = { customerId };
  return paginate(
    query,
    (p) => prisma.order.findMany({ where, include: { items: true }, orderBy: { createdAt: "desc" }, ...p }),
    () => prisma.order.count({ where }),
  );
}

export async function listMyPointsLedger(customerId: string, query: PaginationQuery) {
  const where = { customerId };
  return paginate(
    query,
    (p) => prisma.rewardPointsEntry.findMany({ where, orderBy: { createdAt: "desc" }, ...p }),
    () => prisma.rewardPointsEntry.count({ where }),
  );
}

// --- push subscriptions ---

export async function listPushSubscriptions(customerId: string) {
  return prisma.pushSubscription.findMany({
    where: { customerId },
    select: { id: true, endpoint: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
}

/** `endpoint` is globally unique per browser/device, not per customer — upsert so re-subscribing
 * (e.g. after clearing site data) or a device switching accounts both just work. */
export async function subscribeToPush(customerId: string, input: PushSubscribeInput) {
  await prisma.pushSubscription.upsert({
    where: { endpoint: input.endpoint },
    update: { customerId, p256dh: input.keys.p256dh, auth: input.keys.auth },
    create: { customerId, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth },
  });
}

export async function unsubscribeFromPush(customerId: string, endpoint: string) {
  await prisma.pushSubscription.deleteMany({ where: { customerId, endpoint } });
}

// --- email marketing unsubscribe ---

/** Stateless (no DB row, never expires) so a years-old campaign email's unsubscribe link still
 * works — recomputed and compared on click rather than looked up. */
export function generateEmailUnsubscribeToken(customerId: string): string {
  return signPayload(customerId, env.jwtCustomerAccessSecret);
}

/** One click turns off both switches a marketing email could have come from: the account-level
 * consent flag (gates future Campaign sends, see campaign.service.ts's dispatchToRecipient) and,
 * if the same email is also on the separate newsletter list, that row too — a customer clicking
 * "unsubscribe" means "stop all marketing email", not "stop exactly one of the two lists". */
export async function unsubscribeFromEmailMarketing(customerId: string, token: string): Promise<void> {
  const expected = generateEmailUnsubscribeToken(customerId);
  if (!constantTimeEqual(token, expected)) throw AppError.badRequest("Invalid or expired unsubscribe link");

  const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { email: true } });
  if (!customer) throw AppError.notFound("Account not found");

  await prisma.customer.update({ where: { id: customerId }, data: { emailMarketingOptIn: false } });
  if (customer.email) {
    await prisma.newsletterSubscriber.deleteMany({ where: { email: customer.email } });
  }
}
