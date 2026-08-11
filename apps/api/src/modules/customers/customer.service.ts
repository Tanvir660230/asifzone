import bcrypt from "bcryptjs";
import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { OAuth2Client } from "google-auth-library";
import type {
  CustomerRegisterInput,
  CustomerLoginInput,
  VerifyOtpInput,
  UpdateCustomerInput,
  CreateAddressInput,
  UpdateAddressInput,
  PaginationQuery,
  CustomerListQuery,
  PushSubscribeInput,
} from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { paginate } from "../../lib/paginate";
import { signCustomerAccessToken, signCustomerRefreshToken, verifyCustomerRefreshToken } from "../../lib/customer-jwt";
import { sendMail } from "../../lib/mailer";
import { sendSms } from "../../lib/sms";
import { renderEmailLayout } from "../../lib/email-template";
import { hashToken, signPayload, constantTimeEqual } from "../../lib/token-hash";
import { env } from "../../config/env";
import { getSettings } from "../settings/settings.service";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const EMAIL_VERIFICATION_TTL_MS = 60 * 60 * 1000;
const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
// Requesting a fresh code creates a new PhoneOtp row with its own attempts counter starting at 0
// — without a phone-level ceiling on top of the per-row one, resending resets the guess budget,
// turning a "5 wrong guesses" limit into "5 per code, and codes are nearly free to request."
const OTP_PHONE_LOCKOUT_WINDOW_MS = 30 * 60 * 1000;
const OTP_PHONE_MAX_TOTAL_ATTEMPTS = 5;

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
  smsMarketingOptIn: true,
  emailMarketingOptIn: true,
  rewardPoints: true,
  createdAt: true,
  updatedAt: true,
} as const;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

/** Looks up the customer's current tokenVersion fresh (rather than trusting a possibly-stale value
 * already in hand) so a just-completed password reset is reflected in the very next token issued. */
async function issueCustomerTokens(customerId: string) {
  const { tokenVersion } = await prisma.customer.findUniqueOrThrow({
    where: { id: customerId },
    select: { tokenVersion: true },
  });
  return {
    accessToken: signCustomerAccessToken({ customerId }),
    refreshToken: signCustomerRefreshToken({ customerId, tokenVersion }),
  };
}

/** Called from checkout (order.service.ts createOrder) for a guest — every order, phone-only or
 * not, ends up tied to a real Customer row. Matches an existing customer (guest or already-real
 * account, by either email or phone) before creating a new one, so a returning guest — or someone
 * who already has an account but forgot to log in — gets recognized instead of duplicated. */
export async function findOrCreateGuestCustomer(
  name: string,
  email: string | null,
  phone: string,
): Promise<string> {
  const normalizedEmail = email ? normalizeEmail(email) : null;
  const or: Prisma.CustomerWhereInput[] = [{ phone }];
  if (normalizedEmail) or.push({ email: normalizedEmail });

  const existing = await prisma.customer.findFirst({ where: { OR: or } });
  if (existing) return existing.id;

  try {
    const created = await prisma.customer.create({
      data: { name, email: normalizedEmail, phone },
      select: { id: true },
    });
    return created.id;
  } catch (err) {
    // Two concurrent guest checkouts with the same new email/phone raced past the findFirst above —
    // the loser here just reuses whichever row the winner created, same as the stock-decrement race
    // handling in order.service.ts.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const race = await prisma.customer.findFirst({ where: { OR: or } });
      if (race) return race.id;
    }
    throw err;
  }
}

/** A customer row with neither a password nor a linked Google account isn't a real, log-in-able
 * account yet — it's either a guest placeholder (see findOrCreateGuestCustomer) or a phone-OTP-only
 * signup. Safe to silently claim (attach new credentials to) rather than reject as a duplicate. */
function isClaimable(customer: { passwordHash: string | null; googleId: string | null }): boolean {
  return !customer.passwordHash && !customer.googleId;
}

export async function registerCustomer(input: CustomerRegisterInput) {
  const email = normalizeEmail(input.email);
  const existingByEmail = await prisma.customer.findUnique({ where: { email } });
  if (existingByEmail && !isClaimable(existingByEmail)) {
    throw AppError.conflict("An account with this email already exists");
  }

  // No email match — but a guest checkout may have already created a placeholder under this same
  // phone number, which this registration should claim rather than duplicate.
  const existingByPhone =
    !existingByEmail && input.phone
      ? await prisma.customer.findFirst({ where: { phone: input.phone, passwordHash: null, googleId: null } })
      : null;

  const target = existingByEmail ?? existingByPhone;
  const passwordHash = await bcrypt.hash(input.password, 10);

  const customer = target
    ? await prisma.customer.update({
        where: { id: target.id },
        data: { name: input.name, email, phone: input.phone ?? target.phone, passwordHash },
        select: publicSelect,
      })
    : await prisma.customer.create({
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

  return { ...(await issueCustomerTokens(customer.id)), customer };
}

export async function loginCustomer(input: CustomerLoginInput) {
  const email = normalizeEmail(input.email);
  const customer = await prisma.customer.findUnique({ where: { email } });
  const passwordMatches = await bcrypt.compare(input.password, customer?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!customer || !customer.passwordHash || !passwordMatches) {
    throw AppError.unauthorized("Invalid email or password");
  }

  return {
    ...(await issueCustomerTokens(customer.id)),
    customer: {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      emailVerifiedAt: customer.emailVerifiedAt,
      phone: customer.phone,
      rewardPoints: customer.rewardPoints,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
    },
  };
}

export async function refreshCustomerSession(refreshToken: string) {
  let payload;
  try {
    payload = verifyCustomerRefreshToken(refreshToken);
  } catch {
    throw AppError.unauthorized("Session expired, please log in again");
  }

  const customer = await prisma.customer.findUnique({ where: { id: payload.customerId } });
  // tokenVersion mismatch means this refresh token predates a password reset — reject it even
  // though the JWT signature and expiry are otherwise still valid.
  if (!customer || customer.tokenVersion !== payload.tokenVersion) {
    throw AppError.unauthorized("Session expired, please log in again");
  }

  return signCustomerAccessToken({ customerId: customer.id });
}

export async function getCustomerById(customerId: string) {
  const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: publicSelect });
  if (!customer) throw AppError.notFound("Account not found");
  return customer;
}

export async function updateCustomerProfile(customerId: string, input: UpdateCustomerInput) {
  await getCustomerById(customerId);
  return prisma.customer.update({ where: { id: customerId }, data: input, select: publicSelect });
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
    html: renderEmailLayout({
      bodyHtml: `
        <p style="margin:0 0 8px;font-size:18px;font-weight:600;">Reset your password</p>
        <p style="margin:0;">We got a request to reset your password. This link expires in 1 hour — if you didn't ask for this, you can safely ignore it.</p>
      `,
      ctaLabel: "Reset password",
      ctaUrl: resetUrl,
    }),
  });
}

export async function resetPassword(token: string, newPassword: string) {
  const tokenHash = hashToken(token);
  const resetToken = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });

  if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
    throw AppError.badRequest("This reset link is invalid or has expired");
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.$transaction([
    // Incrementing tokenVersion invalidates every refresh token issued before this reset —
    // otherwise a stolen refresh token would keep working for up to 7 more days regardless.
    prisma.customer.update({
      where: { id: resetToken.customerId },
      data: { passwordHash, tokenVersion: { increment: 1 } },
    }),
    prisma.passwordResetToken.update({ where: { id: resetToken.id }, data: { usedAt: new Date() } }),
  ]);
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
    html: renderEmailLayout({
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

  const googleId = payload.sub;
  const email = normalizeEmail(payload.email);
  const name = payload.name ?? email;

  let customer = await prisma.customer.findUnique({ where: { googleId }, select: publicSelect });

  if (!customer) {
    // Google has already proven ownership of this email — safe to auto-link an existing
    // password account, or create a fresh Google-only (no password) account.
    const existingByEmail = await prisma.customer.findUnique({ where: { email } });
    customer = existingByEmail
      ? await prisma.customer.update({
          where: { id: existingByEmail.id },
          data: { googleId, emailVerifiedAt: existingByEmail.emailVerifiedAt ?? new Date() },
          select: publicSelect,
        })
      : await prisma.customer.create({
          data: { name, email, googleId, emailVerifiedAt: new Date() },
          select: publicSelect,
        });
  }

  return { ...(await issueCustomerTokens(customer.id)), customer };
}

// --- phone / OTP sign-in ---

function generateOtpCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/** Total wrong guesses this phone has racked up across every code issued to it in the lockout
 * window — the real budget, since a single code's own `attempts` column resets to 0 on resend. */
async function getRecentOtpAttempts(phone: string): Promise<number> {
  const windowStart = new Date(Date.now() - OTP_PHONE_LOCKOUT_WINDOW_MS);
  const result = await prisma.phoneOtp.aggregate({
    where: { phone, createdAt: { gte: windowStart } },
    _sum: { attempts: true },
  });
  return result._sum.attempts ?? 0;
}

export async function requestOtp(phone: string) {
  const recent = await prisma.phoneOtp.findFirst({
    where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (recent && Date.now() - recent.createdAt.getTime() < OTP_RESEND_COOLDOWN_MS) {
    throw AppError.badRequest("Please wait a moment before requesting another code");
  }

  if ((await getRecentOtpAttempts(phone)) >= OTP_PHONE_MAX_TOTAL_ATTEMPTS) {
    throw AppError.badRequest("Too many incorrect attempts recently — please try again later");
  }

  const code = generateOtpCode();
  await prisma.phoneOtp.create({
    data: { phone, codeHash: hashToken(code), expiresAt: new Date(Date.now() + OTP_TTL_MS) },
  });

  await sendSms({ to: phone, body: `Your verification code is ${code}. It expires in 5 minutes.` });
}

export async function verifyOtp(input: VerifyOtpInput) {
  const otp = await prisma.phoneOtp.findFirst({
    where: { phone: input.phone, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!otp || otp.expiresAt < new Date()) throw AppError.badRequest("This code is invalid or has expired");
  if (otp.attempts >= OTP_MAX_ATTEMPTS) throw AppError.badRequest("Too many incorrect attempts — request a new code");
  // Phone-level ceiling on top of the per-row one above — catches the case where this particular
  // code's own attempts count is still under OTP_MAX_ATTEMPTS but the phone as a whole (across
  // earlier codes in the same lockout window) has already used up its guess budget.
  if ((await getRecentOtpAttempts(input.phone)) >= OTP_PHONE_MAX_TOTAL_ATTEMPTS) {
    throw AppError.badRequest("Too many incorrect attempts recently — please try again later");
  }

  if (otp.codeHash !== hashToken(input.code)) {
    await prisma.phoneOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    throw AppError.badRequest("Incorrect code");
  }

  let customer = await prisma.customer.findFirst({ where: { phone: input.phone }, select: publicSelect });

  // Deliberately NOT consuming the code yet if we're about to bounce back for name/email — the
  // frontend resubmits the same code once it has them, and a code that's already been marked used
  // would fail that resubmit for no real reason (it's still the same single verified possession of
  // the phone, just split across two requests).
  if (!customer && (!input.name || !input.email)) {
    throw new AppError(422, "NEW_PHONE_NEEDS_PROFILE");
  }

  await prisma.phoneOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });

  if (!customer) {
    const email = normalizeEmail(input.email!);
    const existingByEmail = await prisma.customer.findUnique({ where: { email } });
    if (existingByEmail && !isClaimable(existingByEmail)) {
      throw AppError.conflict("An account with this email already exists — sign in with email instead");
    }
    // A guest checkout may have already created a placeholder under this email (different phone,
    // or no phone at all) — this phone number just proved ownership of *a* phone, not that email,
    // so only claim rows with no existing credential of their own (see isClaimable).
    customer = existingByEmail
      ? await prisma.customer.update({
          where: { id: existingByEmail.id },
          data: { name: input.name!, phone: input.phone, emailVerifiedAt: existingByEmail.emailVerifiedAt ?? new Date() },
          select: publicSelect,
        })
      : await prisma.customer.create({
          data: { name: input.name!, email, phone: input.phone, emailVerifiedAt: new Date() },
          select: publicSelect,
        });
  }

  return { ...(await issueCustomerTokens(customer.id)), customer };
}

// --- admin ---

export async function listCustomersAdmin(query: CustomerListQuery) {
  const where = query.search
    ? {
        OR: [
          { name: { contains: query.search, mode: "insensitive" as const } },
          { email: { contains: query.search, mode: "insensitive" as const } },
          { phone: { contains: query.search } },
        ],
      }
    : {};

  return paginate(
    query,
    (p) =>
      prisma.customer.findMany({
        where,
        select: { ...publicSelect, _count: { select: { orders: true, wishlistItems: true } } },
        orderBy: { createdAt: "desc" },
        ...p,
      }),
    () => prisma.customer.count({ where }),
  );
}

export async function getCustomerDetailAdmin(customerId: string) {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      ...publicSelect,
      addresses: { orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }] },
      orders: { orderBy: { createdAt: "desc" }, take: 20, include: { items: true } },
      wishlistItems: { include: { product: { select: { id: true, name: true, slug: true } } } },
      pointsLedger: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  if (!customer) throw AppError.notFound("Customer not found");

  const spendAggregate = await prisma.order.aggregate({
    where: { customerId, status: { not: "CANCELLED" } },
    _sum: { total: true },
  });

  return { ...customer, totalSpent: Number(spendAggregate._sum.total ?? 0) };
}

/** Awards points for a delivered order — idempotent per order, so re-marking DELIVERED (e.g. after an
 * accidental status revert) never double-pays. No-ops while the store hasn't configured a reward rate. */
export async function awardDeliveryPoints(customerId: string, orderId: string, orderTotal: number) {
  const settings = await getSettings();
  const rate = Number(settings.rewardPointsPerCurrency);
  if (rate <= 0) return;

  const already = await prisma.rewardPointsEntry.findFirst({ where: { orderId, reason: "order_delivered" } });
  if (already) return;

  const points = Math.floor(orderTotal * rate);
  if (points <= 0) return;

  await prisma.$transaction([
    prisma.rewardPointsEntry.create({ data: { customerId, orderId, points, reason: "order_delivered" } }),
    prisma.customer.update({ where: { id: customerId }, data: { rewardPoints: { increment: points } } }),
  ]);
}

export async function adjustRewardPoints(customerId: string, points: number, reason: string) {
  if (points === 0) throw AppError.badRequest("Point adjustment cannot be zero");
  const customer = await getCustomerById(customerId);
  if (customer.rewardPoints + points < 0) {
    throw AppError.badRequest(`Customer only has ${customer.rewardPoints} points`);
  }

  await prisma.$transaction([
    prisma.rewardPointsEntry.create({ data: { customerId, points, reason: reason || "Manual adjustment" } }),
    prisma.customer.update({ where: { id: customerId }, data: { rewardPoints: { increment: points } } }),
  ]);

  return prisma.customer.findUnique({ where: { id: customerId }, select: publicSelect });
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
