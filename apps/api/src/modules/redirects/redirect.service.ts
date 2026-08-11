import { Prisma } from "@prisma/client";
import type { CreateRedirectInput, UpdateRedirectInput, RedirectListQuery } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { paginate } from "../../lib/paginate";

export async function listRedirects(query: RedirectListQuery) {
  return paginate(
    query,
    (p) => prisma.redirect.findMany({ orderBy: { createdAt: "desc" }, ...p }),
    () => prisma.redirect.count(),
  );
}

export async function getRedirectById(id: string) {
  const redirect = await prisma.redirect.findUnique({ where: { id } });
  if (!redirect) throw AppError.notFound("Redirect not found");
  return redirect;
}

// fromPath carries a real DB unique constraint (schema.prisma) — the findUnique/findFirst checks
// below are a fast-path for the common case, but a concurrent create/rename can still race past
// them, so P2002 is caught here too rather than surfacing as the generic conflict message the
// global error handler would otherwise produce.
export async function createRedirect(input: CreateRedirectInput) {
  const existing = await prisma.redirect.findUnique({ where: { fromPath: input.fromPath } });
  if (existing) throw AppError.conflict("A redirect from this path already exists");
  try {
    return await prisma.redirect.create({ data: input });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw AppError.conflict("A redirect from this path already exists");
    }
    throw err;
  }
}

export async function updateRedirect(id: string, input: UpdateRedirectInput) {
  await getRedirectById(id);
  if (input.fromPath) {
    const existing = await prisma.redirect.findFirst({ where: { fromPath: input.fromPath, NOT: { id } } });
    if (existing) throw AppError.conflict("A redirect from this path already exists");
  }
  try {
    return await prisma.redirect.update({ where: { id }, data: input });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw AppError.conflict("A redirect from this path already exists");
    }
    throw err;
  }
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
