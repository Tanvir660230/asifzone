import type { CreateSocialLinkInput, UpdateSocialLinkInput } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { cacheDelByPrefix, cacheGet, cacheSet } from "../../config/redis";
import { AppError } from "../../lib/app-error";

const CACHE_KEY = "social-links:active";
const CACHE_TTL_SECONDS = 300;

async function invalidateCache() {
  await cacheDelByPrefix(CACHE_KEY);
}

export async function listSocialLinks() {
  return prisma.socialLink.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
}

export async function getSocialLinkById(id: string) {
  const link = await prisma.socialLink.findUnique({ where: { id } });
  if (!link) throw AppError.notFound("Social link not found");
  return link;
}

export async function createSocialLink(input: CreateSocialLinkInput) {
  const link = await prisma.socialLink.create({ data: input });
  await invalidateCache();
  return link;
}

export async function updateSocialLink(id: string, input: UpdateSocialLinkInput) {
  await getSocialLinkById(id);
  const link = await prisma.socialLink.update({ where: { id }, data: input });
  await invalidateCache();
  return link;
}

export async function deleteSocialLink(id: string) {
  await getSocialLinkById(id);
  await prisma.socialLink.delete({ where: { id } });
  await invalidateCache();
}

/** Public footer feed — active links only, in display order. */
export async function getActiveSocialLinks() {
  const cached = await cacheGet<Awaited<ReturnType<typeof listSocialLinks>>>(CACHE_KEY);
  if (cached) return cached;

  const links = await prisma.socialLink.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

  await cacheSet(CACHE_KEY, links, CACHE_TTL_SECONDS);
  return links;
}
