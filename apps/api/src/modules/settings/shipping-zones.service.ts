import type { Prisma } from "@prisma/client";
import type { CreateShippingZoneInput, ShippingZoneRow, UpdateShippingZoneInput } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { LEGACY_ZONE_KEYS, insertShippingZone, removeShippingZone, writeShippingZone } from "../../domain/pricing/pricing-config";
import { invalidateSettingsCache, mirrorLegacyShippingFee } from "./settings.service";

/**
 * Admin V2 DR-17 (owner, 2026-10-08): delivery zones are edited directly. The engine (resolveZone) picks the matching
 * active zone with the highest priority, then the most specific rule; the default zone is the fallback.
 *
 * Invariants kept here:
 *  - the default zone stays: it can't be deleted, deactivated or given match rules (it is "everywhere else");
 *  - the two seeded zones can't be deleted, and their fee is mirrored to StoreSetting.shippingFeeDhaka / OutsideDhaka
 *    in the same transaction (legacy mirrors until the contract phase — pricingConfigDrift stays empty).
 */
const LEGACY_MIRROR: Record<string, "shippingFeeDhaka" | "shippingFeeOutsideDhaka"> = {
  [LEGACY_ZONE_KEYS.insideDhaka]: "shippingFeeDhaka",
  [LEGACY_ZONE_KEYS.outside]: "shippingFeeOutsideDhaka",
};
const INCLUDE = { matches: true, rate: true } as const;
type ZoneWithRate = Prisma.ShippingZoneGetPayload<{ include: typeof INCLUDE }>;

function toRow(z: ZoneWithRate): ShippingZoneRow {
  return {
    id: z.id,
    key: z.key,
    name: z.name,
    priority: z.priority,
    isDefault: z.isDefault,
    isActive: z.isActive,
    matches: z.matches.map((m) => ({ field: m.field, value: m.value })).sort((a, b) => a.field.localeCompare(b.field) || a.value.localeCompare(b.value)),
    fee: z.rate ? Number(z.rate.fee) : 0,
    freeOverAmount: z.rate?.freeOverAmount ? Number(z.rate.freeOverAmount) : null,
    protected: z.key in LEGACY_MIRROR,
  };
}

/** Default zone last; the rest by priority (highest first), then name. */
export async function listShippingZones(): Promise<ShippingZoneRow[]> {
  const zones = await prisma.shippingZone.findMany({ include: INCLUDE });
  return zones.map(toRow).sort((a, b) => Number(a.isDefault) - Number(b.isDefault) || b.priority - a.priority || a.name.localeCompare(b.name));
}

function slug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "zone";
}

async function uniqueKey(tx: Prisma.TransactionClient, name: string) {
  const base = slug(name);
  for (let i = 1; ; i++) {
    const key = i === 1 ? base : `${base}-${i}`;
    if (!(await tx.shippingZone.findUnique({ where: { key }, select: { id: true } }))) return key;
  }
}

function dedupe(matches: CreateShippingZoneInput["matches"]) {
  const seen = new Set<string>();
  return matches.filter((m) => {
    const k = `${m.field}:${m.value.toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function mirrorLegacyFee(tx: Prisma.TransactionClient, key: string, fee: number) {
  const field = LEGACY_MIRROR[key];
  if (field) await mirrorLegacyShippingFee(tx, field, fee);
}

export async function createShippingZone(input: CreateShippingZoneInput): Promise<ShippingZoneRow> {
  if (input.matches.length === 0) throw AppError.badRequest("Add at least one district, division or postcode", { code: "ZONE_NEEDS_RULE" });
  const zone = await prisma.$transaction(async (tx) => {
    const { id } = await insertShippingZone(tx, {
      key: await uniqueKey(tx, input.name),
      name: input.name,
      priority: input.priority,
      isActive: input.isActive,
      matches: dedupe(input.matches),
      fee: input.fee,
      freeOverAmount: input.freeOverAmount,
    });
    return tx.shippingZone.findUniqueOrThrow({ where: { id }, include: INCLUDE });
  });
  return toRow(zone);
}

export async function updateShippingZone(id: string, input: UpdateShippingZoneInput): Promise<ShippingZoneRow> {
  const zone = await prisma.$transaction(async (tx) => {
    const current = await tx.shippingZone.findUnique({ where: { id }, include: INCLUDE });
    if (!current) throw AppError.notFound("Zone not found");
    if (current.isDefault && input.isActive === false) throw AppError.badRequest("The default zone covers every address no other zone matches — it can't be switched off", { code: "ZONE_DEFAULT_LOCKED" });
    if (current.isDefault && input.matches && input.matches.length > 0) throw AppError.badRequest("The default zone covers everywhere else — it has no rules", { code: "ZONE_DEFAULT_LOCKED" });
    if (!current.isDefault && input.matches && input.matches.length === 0) throw AppError.badRequest("Add at least one district, division or postcode", { code: "ZONE_NEEDS_RULE" });

    await writeShippingZone(tx, id, {
      name: input.name,
      priority: input.priority,
      isActive: input.isActive,
      matches: input.matches ? dedupe(input.matches) : undefined,
      rate:
        input.fee !== undefined
          ? { fee: input.fee, freeOverAmount: input.freeOverAmount }
          : input.freeOverAmount !== undefined
            ? { freeOverAmount: input.freeOverAmount }
            : undefined,
    });
    if (input.fee !== undefined) await mirrorLegacyFee(tx, current.key, input.fee);
    return tx.shippingZone.findUniqueOrThrow({ where: { id }, include: INCLUDE });
  });
  if (input.fee !== undefined && zone.key in LEGACY_MIRROR) await invalidateSettingsCache();
  return toRow(zone);
}

export async function deleteShippingZone(id: string) {
  const zone = await prisma.shippingZone.findUnique({ where: { id }, select: { key: true, isDefault: true } });
  if (!zone) throw AppError.notFound("Zone not found");
  if (zone.isDefault || zone.key in LEGACY_MIRROR) throw AppError.badRequest("This zone came with the store and can't be deleted — switch it off or change its fee instead", { code: "ZONE_PROTECTED" });
  await removeShippingZone(prisma, id);
}
