import type { Prisma, PrismaClient } from "@prisma/client";
import { fromMajor, type ShippingZoneRule, type TaxConfig } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";

/**
 * Loads (and, from the settings form, writes) the centralised pricing configuration: the TaxSetting singleton (D3, D10)
 * and the shipping zones/rates. These tables are the authority the engines read; the StoreSetting columns
 * taxEnabled/defaultTaxRate/shippingFeeDhaka/shippingFeeOutsideDhaka are legacy mirrors kept equal by the dual-write
 * below until the contract phase (docs/SSOT_REGISTRY.md).
 */
type Db = PrismaClient | Prisma.TransactionClient;

export const TAX_SETTING_ID = "singleton";
/** The two zones the Phase 2 migration seeds from the old "inside / outside Dhaka" fees. */
export const LEGACY_ZONE_KEYS = { insideDhaka: "dhaka-district", outside: "default" } as const;

export async function loadTaxConfig(db: Db = prisma): Promise<TaxConfig> {
  const row =
    (await db.taxSetting.findUnique({ where: { id: TAX_SETTING_ID } })) ??
    (await db.taxSetting.create({ data: { id: TAX_SETTING_ID } }));
  return {
    enabled: row.enabled,
    mode: row.mode,
    ratePct: row.defaultRate ? Number(row.defaultRate) : 0,
    shippingTaxable: row.shippingTaxable,
    shippingRatePct: row.shippingRate ? Number(row.shippingRate) : null,
  };
}

export async function loadShippingZones(currency: string, db: Db = prisma): Promise<ShippingZoneRule[]> {
  const zones = await db.shippingZone.findMany({ include: { matches: true, rate: true }, orderBy: { key: "asc" } });
  return zones
    .filter((z) => z.rate)
    .map((z) => ({
      id: z.id,
      key: z.key,
      name: z.name,
      priority: z.priority,
      isDefault: z.isDefault,
      isActive: z.isActive,
      matches: z.matches.map((m) => ({ field: m.field, value: m.value })),
      fee: fromMajor(z.rate!.fee.toString(), currency),
      freeOverAmount: z.rate!.freeOverAmount ? fromMajor(z.rate!.freeOverAmount.toString(), currency) : null,
    }));
}

/**
 * Dual-write from the existing settings form (settings.service.updateSettings): the legacy fields it still edits land in
 * their authoritative tables in the same transaction. `shippingTaxable` has no legacy column — it lives only here.
 */
export async function applySettingsToPricingConfig(
  tx: Prisma.TransactionClient,
  input: {
    taxEnabled?: boolean;
    defaultTaxRate?: number | null;
    shippingTaxable?: boolean;
    shippingFeeDhaka?: number;
    shippingFeeOutsideDhaka?: number;
  },
) {
  const tax: Prisma.TaxSettingUpdateInput = {};
  if (input.taxEnabled !== undefined) tax.enabled = input.taxEnabled;
  if (input.defaultTaxRate !== undefined) tax.defaultRate = input.defaultTaxRate;
  if (input.shippingTaxable !== undefined) tax.shippingTaxable = input.shippingTaxable;
  if (Object.keys(tax).length) {
    await tx.taxSetting.upsert({ where: { id: TAX_SETTING_ID }, update: tax, create: { id: TAX_SETTING_ID, ...(tax as Prisma.TaxSettingCreateInput) } });
  }
  const fees: Array<[string, number | undefined]> = [
    [LEGACY_ZONE_KEYS.insideDhaka, input.shippingFeeDhaka],
    [LEGACY_ZONE_KEYS.outside, input.shippingFeeOutsideDhaka],
  ];
  for (const [key, fee] of fees) {
    if (fee === undefined) continue;
    const zone = await tx.shippingZone.findUnique({ where: { key } });
    if (zone) await tx.shippingRate.upsert({ where: { zoneId: zone.id }, update: { fee }, create: { zoneId: zone.id, fee } });
  }
}

/** Reconciliation: do the legacy StoreSetting mirrors still equal their authorities? (docs/PRICING_INVARIANTS.md §10) */
export async function pricingConfigDrift(db: Db = prisma) {
  const [store, tax, zones] = await Promise.all([
    db.storeSetting.findUnique({ where: { id: "singleton" } }),
    db.taxSetting.findUnique({ where: { id: TAX_SETTING_ID } }),
    db.shippingZone.findMany({ where: { key: { in: Object.values(LEGACY_ZONE_KEYS) } }, include: { rate: true } }),
  ]);
  if (!store) return [];
  const fee = (key: string) => zones.find((z) => z.key === key)?.rate?.fee.toString();
  const issues: string[] = [];
  if (tax && tax.enabled !== store.taxEnabled) issues.push("taxEnabled");
  if (tax && String(tax.defaultRate ?? "") !== String(store.defaultTaxRate ?? "")) issues.push("defaultTaxRate");
  if (fee(LEGACY_ZONE_KEYS.insideDhaka) !== store.shippingFeeDhaka.toString()) issues.push("shippingFeeDhaka");
  if (fee(LEGACY_ZONE_KEYS.outside) !== store.shippingFeeOutsideDhaka.toString()) issues.push("shippingFeeOutsideDhaka");
  return issues;
}
