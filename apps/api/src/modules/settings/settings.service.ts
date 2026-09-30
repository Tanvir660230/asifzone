import type { UpdateSettingsInput } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { cacheDel, cacheGet, cacheSet } from "../../config/redis";
import { AppError } from "../../lib/app-error";
import { deleteSiteImageFile } from "../uploads/upload.service";
import { applySettingsToPricingConfig } from "../../domain/pricing/pricing-config";
import { revalidateStorefrontTags, SETTINGS_CACHE_TAG } from "../../lib/storefront-revalidate";

const CACHE_KEY = "settings:singleton";
const CACHE_TTL_SECONDS = 300;
const SINGLETON_ID = "singleton";
// Single-file image fields where a new upload fully replaces the old one — the old file has no
// other referrer once overwritten, so it should be cleaned up rather than left on disk forever.
const REPLACEABLE_IMAGE_FIELDS = ["logoUrl", "faviconUrl", "paymentMethodsImageUrl"] as const;

/** P6-4 / Phase 7: the store currency may be set freely until the first order exists; after that every recorded amount is in
 * it, so a change is refused. Saving the same currency is never a change. */
export function currencyChangeBlocked(requested: string | undefined, current: string, ordersExist: boolean): boolean {
  return requested !== undefined && requested !== current && ordersExist;
}

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

  const codEnabled = input.codEnabled ?? previous.codEnabled;
  const onlinePaymentEnabled = input.onlinePaymentEnabled ?? previous.onlinePaymentEnabled;
  if (!codEnabled && !onlinePaymentEnabled) {
    throw AppError.badRequest("At least one payment method (Cash on Delivery or Online Payment) must stay enabled");
  }

  // Tax and shipping fields also land in their authoritative tables (TaxSetting, ShippingRate) in the same
  // transaction — the StoreSetting columns are legacy mirrors (docs/SSOT_REGISTRY.md). shippingTaxable has no mirror.
  const { shippingTaxable, ...storeFields } = input;
  const settings = await prisma.$transaction(async (tx) => {
    // P6-4: orders record no currency — every money snapshot means "the store currency". Once any order exists,
    // changing it would silently reinterpret all history, so it is locked (docs/PHASE_6_AUDIT.md G5).
    if (currencyChangeBlocked(input.currency, previous.currency, (await tx.order.count({ take: 1 })) > 0)) {
      throw new AppError(409, "The store currency can't be changed once orders exist — every recorded amount is in it", { code: "CURRENCY_LOCKED" });
    }
    const updated = await tx.storeSetting.update({ where: { id: SINGLETON_ID }, data: storeFields });
    await applySettingsToPricingConfig(tx, {
      taxEnabled: input.taxEnabled,
      defaultTaxRate: input.defaultTaxRate,
      shippingTaxable,
      shippingFeeDhaka: input.shippingFeeDhaka,
      shippingFeeOutsideDhaka: input.shippingFeeOutsideDhaka,
    });
    return updated;
  });
  await cacheDel(CACHE_KEY);
  // The storefront's own copy (Next fetch cache, tag "settings") must not outlive the save either (Phase 7 D-7).
  void revalidateStorefrontTags([SETTINGS_CACHE_TAG]);

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
