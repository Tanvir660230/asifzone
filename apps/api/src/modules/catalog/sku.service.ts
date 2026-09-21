import { Prisma } from "@prisma/client";
import { defaultTypeCode, renderSkuPattern, sanitizeSkuPart, type SkuSettingsInput } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";

const SINGLETON = "singleton";

/** Created on first read, like StoreSetting — an empty install already has the default pattern. */
export async function getSkuSettings() {
  return prisma.catalogSetting.upsert({ where: { id: SINGLETON }, update: {}, create: { id: SINGLETON } });
}

export async function updateSkuSettings(input: SkuSettingsInput) {
  return prisma.catalogSetting.upsert({ where: { id: SINGLETON }, update: input, create: { id: SINGLETON, ...input } });
}

/** Takes the next number for a scope. The upsert is a single atomic statement per attempt, so two admins generating
 * at once can never be handed the same number; the rare race on *creating* the counter row is retried. */
async function nextSequence(scope: string): Promise<number> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const row = await prisma.skuCounter.upsert({
        where: { scope },
        create: { scope, next: 2 },
        update: { next: { increment: 1 } },
      });
      return row.next - 1;
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    }
  }
  throw AppError.conflict("Couldn't reserve a SKU number — try again");
}

export interface SkuRequest {
  typeId: string;
  color?: string | null;
  size?: string | null;
  /** SKUs already chosen in the form (not saved yet), so two new variants can't collide with each other. */
  taken?: string[];
}

/** Generates a SKU from the configured pattern that is unique in the database and among `taken`.
 * Numbers are never reused, even if the admin discards the SKU — a gap is harmless, a duplicate is not. */
export async function generateSku(input: SkuRequest): Promise<string> {
  const [settings, type] = await Promise.all([
    getSkuSettings(),
    prisma.productTypeDef.findUnique({ where: { id: input.typeId }, select: { name: true, skuCode: true } }),
  ]);
  if (!type) throw AppError.badRequest("Product type does not exist");
  const typeCode = sanitizeSkuPart(type.skuCode) || defaultTypeCode(type.name);
  const taken = new Set((input.taken ?? []).map((s) => s.toUpperCase()));

  for (let attempt = 0; attempt < 25; attempt++) {
    const seq = await nextSequence(typeCode);
    const sku = renderSkuPattern(settings.skuPattern, { prefix: settings.skuPrefix, typeCode, color: input.color, size: input.size, seq });
    if (taken.has(sku.toUpperCase())) continue;
    if (!(await prisma.productVariant.findUnique({ where: { sku }, select: { id: true } }))) return sku;
  }
  throw AppError.conflict("Couldn't find a free SKU — check the pattern includes {SEQ}");
}
