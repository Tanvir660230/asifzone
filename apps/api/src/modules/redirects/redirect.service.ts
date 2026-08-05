import type { CreateRedirectInput, UpdateRedirectInput, RedirectListQuery } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";

export async function listRedirects(query: RedirectListQuery) {
  const [items, total] = await Promise.all([
    prisma.redirect.findMany({
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.redirect.count(),
  ]);
  return { items, total, page: query.page, pageSize: query.pageSize };
}

export async function getRedirectById(id: string) {
  const redirect = await prisma.redirect.findUnique({ where: { id } });
  if (!redirect) throw AppError.notFound("Redirect not found");
  return redirect;
}

export async function createRedirect(input: CreateRedirectInput) {
  const existing = await prisma.redirect.findUnique({ where: { fromPath: input.fromPath } });
  if (existing) throw AppError.conflict("A redirect from this path already exists");
  return prisma.redirect.create({ data: input });
}

export async function updateRedirect(id: string, input: UpdateRedirectInput) {
  await getRedirectById(id);
  if (input.fromPath) {
    const existing = await prisma.redirect.findFirst({ where: { fromPath: input.fromPath, NOT: { id } } });
    if (existing) throw AppError.conflict("A redirect from this path already exists");
  }
  return prisma.redirect.update({ where: { id }, data: input });
}

export async function deleteRedirect(id: string) {
  await getRedirectById(id);
  await prisma.redirect.delete({ where: { id } });
}

/** Every active redirect, for apps/web/middleware.ts to match the current request path against.
 * Fetched by the middleware with a short revalidate window rather than per-request. */
export async function listActiveRedirects() {
  return prisma.redirect.findMany({
    where: { isActive: true },
    select: { fromPath: true, toPath: true, statusCode: true },
  });
}
