import type { UpdateSettingsInput } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { cacheDel, cacheGet, cacheSet } from "../../config/redis";
import { deleteSiteImageFile } from "../uploads/upload.service";

const CACHE_KEY = "settings:singleton";
const CACHE_TTL_SECONDS = 300;
const SINGLETON_ID = "singleton";
// Single-file image fields where a new upload fully replaces the old one — the old file has no
// other referrer once overwritten, so it should be cleaned up rather than left on disk forever.
const REPLACEABLE_IMAGE_FIELDS = ["logoUrl", "faviconUrl", "paymentMethodsImageUrl"] as const;

/** Lazily creates the one settings row on first read — no seed step required for a fresh database. */
export async function getSettings() {
  const cached = await cacheGet<Awaited<ReturnType<typeof fetchOrCreate>>>(CACHE_KEY);
  if (cached) return cached;

  const settings = await fetchOrCreate();
  await cacheSet(CACHE_KEY, settings, CACHE_TTL_SECONDS);
  return settings;
}

async function fetchOrCreate() {
  const existing = await prisma.storeSetting.findUnique({ where: { id: SINGLETON_ID } });
  if (existing) return existing;
  return prisma.storeSetting.create({ data: { id: SINGLETON_ID } });
}

export async function updateSettings(input: UpdateSettingsInput) {
  const previous = await fetchOrCreate();
  const settings = await prisma.storeSetting.update({ where: { id: SINGLETON_ID }, data: input });
  await cacheDel(CACHE_KEY);

  // Fire-and-forget, after the DB write succeeds: never let disk cleanup fail or slow down the
  // admin's save, and never delete the old file before the new URL is safely persisted.
  for (const field of REPLACEABLE_IMAGE_FIELDS) {
    const oldUrl = previous[field];
    const newUrl = settings[field];
    if (oldUrl && oldUrl !== newUrl) {
      deleteSiteImageFile(oldUrl).catch((err) => console.error(`[settings] failed to delete old ${field}:`, err));
    }
  }

  return settings;
}
