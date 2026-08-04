import type { CreateBannerInput, UpdateBannerInput } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { cacheDelByPrefix, cacheGet, cacheSet } from "../../config/redis";
import { AppError } from "../../lib/app-error";

const CACHE_PREFIX = "banners:";
const CACHE_TTL_SECONDS = 300;

async function invalidateCache() {
  await cacheDelByPrefix(CACHE_PREFIX);
}

export async function listBanners() {
  return prisma.banner.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }] });
}

export async function getBannerById(id: string) {
  const banner = await prisma.banner.findUnique({ where: { id } });
  if (!banner) throw AppError.notFound("Banner not found");
  return banner;
}

export async function createBanner(input: CreateBannerInput) {
  const banner = await prisma.banner.create({ data: input });
  await invalidateCache();
  return banner;
}

export async function updateBanner(id: string, input: UpdateBannerInput) {
  await getBannerById(id);
  const banner = await prisma.banner.update({ where: { id }, data: input });
  await invalidateCache();
  return banner;
}

export async function deleteBanner(id: string) {
  await getBannerById(id);
  await prisma.banner.delete({ where: { id } });
  await invalidateCache();
}

/** Public homepage feed: active banners for a placement, scoped to any schedule window set on them. */
export async function getActiveBanners(placement: "HERO_CAROUSEL" | "PROMO_STRIP") {
  const cacheKey = `${CACHE_PREFIX}${placement}`;
  const cached = await cacheGet<Awaited<ReturnType<typeof listBanners>>>(cacheKey);
  if (cached) return cached;

  const now = new Date();
  const banners = await prisma.banner.findMany({
    where: {
      placement,
      isActive: true,
      OR: [{ startsAt: null }, { startsAt: { lte: now } }],
      AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
    },
    orderBy: { sortOrder: "asc" },
  });

  await cacheSet(cacheKey, banners, CACHE_TTL_SECONDS);
  return banners;
}
