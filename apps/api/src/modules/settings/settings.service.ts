import type { UpdateSettingsInput } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { cacheDel, cacheGet, cacheSet } from "../../config/redis";

const CACHE_KEY = "settings:singleton";
const CACHE_TTL_SECONDS = 300;
const SINGLETON_ID = "singleton";

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
  await fetchOrCreate();
  const settings = await prisma.storeSetting.update({ where: { id: SINGLETON_ID }, data: input });
  await cacheDel(CACHE_KEY);
  return settings;
}
