import bcrypt from "bcryptjs";
import crypto from "crypto";
import type {
  CustomerRegisterInput,
  CustomerLoginInput,
  UpdateCustomerInput,
  CreateAddressInput,
  UpdateAddressInput,
  PaginationQuery,
  CustomerListQuery,
} from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { signCustomerAccessToken, signCustomerRefreshToken, verifyCustomerRefreshToken } from "../../lib/customer-jwt";
import { sendMail } from "../../lib/mailer";
import { env } from "../../config/env";
import { getSettings } from "../settings/settings.service";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

const publicSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  rewardPoints: true,
  createdAt: true,
  updatedAt: true,
} as const;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function registerCustomer(input: CustomerRegisterInput) {
  const email = normalizeEmail(input.email);
  const existing = await prisma.customer.findUnique({ where: { email } });
  if (existing) throw AppError.conflict("An account with this email already exists");

  const passwordHash = await bcrypt.hash(input.password, 10);
  const customer = await prisma.customer.create({
    data: { name: input.name, email, phone: input.phone ?? null, passwordHash },
    select: publicSelect,
  });

  const payload = { customerId: customer.id };
  return {
    accessToken: signCustomerAccessToken(payload),
    refreshToken: signCustomerRefreshToken(payload),
    customer,
  };
}

export async function loginCustomer(input: CustomerLoginInput) {
  const email = normalizeEmail(input.email);
  const customer = await prisma.customer.findUnique({ where: { email } });
  if (!customer || !customer.passwordHash) throw AppError.unauthorized("Invalid email or password");

  const passwordMatches = await bcrypt.compare(input.password, customer.passwordHash);
  if (!passwordMatches) throw AppError.unauthorized("Invalid email or password");

  const payload = { customerId: customer.id };
  return {
    accessToken: signCustomerAccessToken(payload),
    refreshToken: signCustomerRefreshToken(payload),
    customer: {
      id: customer.id,
      name: customer.name,
      email: customer.email,
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
  if (!customer) throw AppError.unauthorized("Session expired, please log in again");

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

export async function createAddress(customerId: string, input: CreateAddressInput) {
  if (input.isDefault) {
    return prisma.$transaction(async (tx) => {
      await tx.address.updateMany({ where: { customerId, isDefault: true }, data: { isDefault: false } });
      return tx.address.create({ data: { ...input, customerId } });
    });
  }
  return prisma.address.create({ data: { ...input, customerId } });
}

export async function updateAddress(customerId: string, addressId: string, input: UpdateAddressInput) {
  await getOwnedAddress(customerId, addressId);

  if (input.isDefault) {
    return prisma.$transaction(async (tx) => {
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
    to: customer.email,
    subject: "Reset your password",
    html: `<p>Click the link below to reset your password. This link expires in 1 hour.</p><p><a href="${resetUrl}">${resetUrl}</a></p>`,
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
    prisma.customer.update({ where: { id: resetToken.customerId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({ where: { id: resetToken.id }, data: { usedAt: new Date() } }),
  ]);
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

  const [items, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      select: { ...publicSelect, _count: { select: { orders: true, wishlistItems: true } } },
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.customer.count({ where }),
  ]);
  return { items, total, page: query.page, pageSize: query.pageSize };
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
  const [items, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: { items: true },
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.order.count({ where }),
  ]);
  return { items, total, page: query.page, pageSize: query.pageSize };
}

export async function listMyPointsLedger(customerId: string, query: PaginationQuery) {
  const where = { customerId };
  const [items, total] = await Promise.all([
    prisma.rewardPointsEntry.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.rewardPointsEntry.count({ where }),
  ]);
  return { items, total, page: query.page, pageSize: query.pageSize };
}
