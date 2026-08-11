import type {
  CreatePaymentMethodInput,
  UpdatePaymentMethodInput,
  ReorderPaymentMethodsInput,
} from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { cacheDelByPrefix, cacheGet, cacheSet } from "../../config/redis";
import { AppError } from "../../lib/app-error";

const CACHE_KEY = "payment-methods:active";
const CACHE_TTL_SECONDS = 300;

async function invalidateCache() {
  await cacheDelByPrefix(CACHE_KEY);
}

export async function listPaymentMethods() {
  return prisma.paymentMethodOption.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
}

/** Public footer/checkout feed — active methods only, in display order. */
export async function getActivePaymentMethods() {
  const cached = await cacheGet<Awaited<ReturnType<typeof listPaymentMethods>>>(CACHE_KEY);
  if (cached) return cached;

  const methods = await prisma.paymentMethodOption.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

  await cacheSet(CACHE_KEY, methods, CACHE_TTL_SECONDS);
  return methods;
}

export async function getPaymentMethodById(id: string) {
  const method = await prisma.paymentMethodOption.findUnique({ where: { id } });
  if (!method) throw AppError.notFound("Payment method not found");
  return method;
}

export async function createPaymentMethod(input: CreatePaymentMethodInput) {
  const nameTaken = await prisma.paymentMethodOption.findFirst({
    where: { name: { equals: input.name, mode: "insensitive" } },
  });
  if (nameTaken) throw AppError.conflict(`A payment method named "${input.name}" already exists`);

  const method = await prisma.paymentMethodOption.create({ data: input });
  await invalidateCache();
  return method;
}

export async function updatePaymentMethod(id: string, input: UpdatePaymentMethodInput) {
  await getPaymentMethodById(id);

  if (input.name) {
    const nameTaken = await prisma.paymentMethodOption.findFirst({
      where: { name: { equals: input.name, mode: "insensitive" }, NOT: { id } },
    });
    if (nameTaken) throw AppError.conflict(`A payment method named "${input.name}" already exists`);
  }

  const method = await prisma.paymentMethodOption.update({ where: { id }, data: input });
  await invalidateCache();
  return method;
}

export async function deletePaymentMethod(id: string) {
  await getPaymentMethodById(id);
  await prisma.paymentMethodOption.delete({ where: { id } });
  await invalidateCache();
}

export async function reorderPaymentMethods(input: ReorderPaymentMethodsInput) {
  const ids = input.items.map((item) => item.id);
  const existing = await prisma.paymentMethodOption.count({ where: { id: { in: ids } } });
  if (existing !== ids.length) throw AppError.badRequest("One or more payment methods were not found");

  await prisma.$transaction(
    input.items.map((item) => prisma.paymentMethodOption.update({ where: { id: item.id }, data: { sortOrder: item.sortOrder } })),
  );
  await invalidateCache();
}
