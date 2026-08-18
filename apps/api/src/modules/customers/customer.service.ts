import bcrypt from "bcryptjs";
import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { OAuth2Client } from "google-auth-library";
import {
  renderCustomerSmsTemplate,
  looksLikeFakePhone,
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
  type CustomerSmsVars,
} from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { paginate } from "../../lib/paginate";
import { mapWithConcurrency } from "../../lib/concurrency";
import { signCustomerAccessToken, signCustomerRefreshToken, verifyCustomerRefreshToken } from "../../lib/customer-jwt";
import { sendMail } from "../../lib/mailer";
import { sendSms } from "../../lib/sms";
import { renderEmailLayout } from "../../lib/email-template";
import { hashToken, signPayload, constantTimeEqual } from "../../lib/token-hash";
import { env } from "../../config/env";
import { getSettings } from "../settings/settings.service";

// Bulk sends dispatch this many recipients concurrently — same bound as campaign.service.ts's
// SEND_CONCURRENCY, for the same reason (bounded outbound connections to the SMS provider).
const SMS_SEND_CONCURRENCY = 10;

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
  const customers = await prisma.customer.findMany({
    where,
    select: {
      ...adminSelect,
      addresses: { where: { isDefault: true }, take: 1, select: { district: true } },
      orders: {
        where: { deletedAt: null },
        select: { total: true, status: true, createdAt: true, shippingDistrict: true, courierStatus: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  return customers.map(({ addresses, orders, ...customer }) => {
    const totalOrders = orders.length;
    const totalSpent = orders
      .filter((o) => o.status !== "CANCELLED")
      .reduce((sum, o) => sum + Number(o.total), 0);
    const cancelledOrders = orders.filter((o) => o.status === "CANCELLED").length;
    const holdOrders = orders.filter((o) => o.courierStatus === "hold").length;
    const lastOrderAt = orders[0]?.createdAt ?? null;
    const district = addresses[0]?.district ?? orders[0]?.shippingDistrict ?? null;
    const riskSignals = computeRiskSignals({ phone: customer.phone, totalOrders, cancelledOrders, holdOrders });
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
  const computed = await loadCustomersWithComputedFields({});
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

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

  const [spendAggregate, orderCounts, holdOrders, smsRecipients] = await Promise.all([
    prisma.order.aggregate({ where: { customerId, status: { not: "CANCELLED" } }, _sum: { total: true } }),
    prisma.order.groupBy({ by: ["status"], where: { customerId, deletedAt: null }, _count: true }),
    prisma.order.count({ where: { customerId, deletedAt: null, courierStatus: "hold" } }),
    prisma.campaignRecipient.findMany({
      where: { customerId },
      include: { campaign: { select: { id: true, name: true, body: true, channel: true } } },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);

  const totalSpent = Number(spendAggregate._sum.total ?? 0);
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
    totalOrders,
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
      averageOrderValue: totalOrders > 0 ? totalSpent / totalOrders : 0,
      lifetimeSpend: totalSpent,
    },
    smsHistory,
    timeline,
  };
}

export async function updateCustomerAdminFields(customerId: string, input: UpdateCustomerAdminFieldsInput) {
  const exists = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
  if (!exists) throw AppError.notFound("Customer not found");
  return prisma.customer.update({ where: { id: customerId }, data: input, select: adminSelect });
}

/** {{variable}} context for a given computed customer — shared by the individual and bulk send
 * paths below so a template renders identically regardless of which one sent it. */
function customerSmsVars(c: { name: string; phone: string; totalSpent: number; lastOrderAt: Date | null }): CustomerSmsVars {
  return {
    customerName: c.name,
    firstName: c.name.split(" ")[0] || c.name,
    phone: c.phone,
    totalSpent: `৳${Math.round(c.totalSpent).toLocaleString("en-BD")}`,
    lastOrder: c.lastOrderAt
      ? c.lastOrderAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
      : "no orders yet",
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

  const rendered = renderCustomerSmsTemplate(body, customerSmsVars({ ...customer, phone: customer.phone }));
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
  await mapWithConcurrency(withPhone, SMS_SEND_CONCURRENCY, async (c) => {
    const rendered = renderCustomerSmsTemplate(body, customerSmsVars(c));
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
