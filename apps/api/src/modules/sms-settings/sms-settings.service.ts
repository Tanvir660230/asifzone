import type { UpdateSmsSettingsInput } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { cacheDel, cacheGet, cacheSet } from "../../config/redis";

const CACHE_KEY = "sms-settings:singleton";
const CACHE_TTL_SECONDS = 300;
const SINGLETON_ID = "singleton";

/** Lazily creates the one settings row on first read — no seed step required for a fresh database. */
export async function getSmsSettings() {
  const cached = await cacheGet<Awaited<ReturnType<typeof fetchOrCreate>>>(CACHE_KEY);
  if (cached) return cached;

  const settings = await fetchOrCreate();
  await cacheSet(CACHE_KEY, settings, CACHE_TTL_SECONDS);
  return settings;
}

async function fetchOrCreate() {
  const existing = await prisma.smsNotificationSetting.findUnique({ where: { id: SINGLETON_ID } });
  if (existing) return existing;
  return prisma.smsNotificationSetting.create({ data: { id: SINGLETON_ID } });
}

export async function updateSmsSettings(input: UpdateSmsSettingsInput) {
  // upsert, not update — on a fresh database the singleton row may not exist yet if this is the
  // very first call (e.g. PATCH before any GET), and a plain update() would 404 instead of applying.
  const settings = await prisma.smsNotificationSetting.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, ...input },
    update: input,
  });
  await cacheDel(CACHE_KEY);
  return settings;
}
