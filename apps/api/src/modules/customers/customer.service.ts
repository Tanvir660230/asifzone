import bcrypt from "bcryptjs";
import type {
  CustomerRegisterInput,
  CustomerLoginInput,
  UpdateCustomerInput,
  CreateAddressInput,
  UpdateAddressInput,
  PaginationQuery,
} from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { signCustomerAccessToken, signCustomerRefreshToken, verifyCustomerRefreshToken } from "../../lib/customer-jwt";

const publicSelect = { id: true, name: true, email: true, phone: true, createdAt: true, updatedAt: true } as const;

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
    customer: { id: customer.id, name: customer.name, email: customer.email, phone: customer.phone, createdAt: customer.createdAt, updatedAt: customer.updatedAt },
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
