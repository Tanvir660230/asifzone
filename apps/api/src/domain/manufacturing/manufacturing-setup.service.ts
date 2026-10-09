/**
 * Manufacturing set-up (docs/MANUFACTURING.md §2): the accounts production posts to (1630 WIP, 2116 production costs
 * accrued, 5220 production losses — plus inventory and 5150 already there), the default production cost categories, and
 * the hidden category material items live in. Idempotent and audited; never overrides an owner's change.
 */
import { MANUFACTURING_MAPPING_KEYS, type AccountMappingKey } from "@clothing-brand/shared";
import type { ProductionCostGroup } from "@prisma/client";
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { recordFinanceAudit, type FinanceActor, type FinanceAuditInput } from "../finance/finance-audit";
import { getFinanceContext, type FinanceBusinessInfo } from "../finance/finance-context";
import { financeTransaction } from "../finance/finance-tx";
import { chartState, provisionTemplateAccountsInTx } from "../finance/chart-provisioning";
import { financeError } from "../finance/finance-values";

export const MANUFACTURING_SETUP_ACTOR: FinanceActor = { type: "SYSTEM", label: "system:manufacturing-setup" };

/** Configurable defaults — a starting list, not a hard-coded process: the owner adds, renames and deactivates. */
export const DEFAULT_COST_CATEGORIES: Array<{ code: string; name: string; group: ProductionCostGroup }> = [
  { code: "MATERIAL_EXTRA", name: "Materials bought for this order", group: "MATERIAL" },
  { code: "TRIMS", name: "Trims, labels & tags", group: "MATERIAL" },
  { code: "PACKAGING", name: "Packaging", group: "MATERIAL" },
  { code: "CMT", name: "Contract manufacturing (per piece)", group: "EXTERNAL_SERVICE" },
  { code: "CUTTING", name: "Cutting", group: "LABOUR" },
  { code: "SEWING", name: "Sewing / stitching", group: "LABOUR" },
  { code: "EMBROIDERY", name: "Embroidery", group: "EXTERNAL_SERVICE" },
  { code: "PRINTING", name: "Printing", group: "EXTERNAL_SERVICE" },
  { code: "WASHING", name: "Washing & dyeing", group: "EXTERNAL_SERVICE" },
  { code: "FINISHING", name: "Finishing & ironing", group: "LABOUR" },
  { code: "ASSEMBLY", name: "Assembly", group: "LABOUR" },
  { code: "OVERTIME", name: "Overtime & extra labour", group: "LABOUR" },
  { code: "ARTWORK", name: "Artwork & design preparation", group: "OTHER" },
  { code: "SAMPLES", name: "Samples & prototypes", group: "OTHER" },
  { code: "SETUP", name: "Moulds, dies, screens & setup", group: "OTHER" },
  { code: "FREIGHT", name: "Freight & transport", group: "OTHER" },
  { code: "HANDLING", name: "Loading & unloading", group: "OTHER" },
  { code: "INSPECTION", name: "Inspection & testing", group: "OTHER" },
  { code: "DUTIES", name: "Non-recoverable taxes & duties", group: "OTHER" },
  { code: "OVERHEAD", name: "Allocated production overhead", group: "OVERHEAD" },
  { code: "OTHER", name: "Other direct production cost", group: "OTHER" },
];

export const MATERIALS_CATEGORY_SLUG = "_materials";

/** The hidden catalog category material items belong to (a product needs a category; this one is never shown). */
export async function materialsCategoryInTx(tx: AppTransactionClient): Promise<string> {
  const existing = await tx.category.findUnique({ where: { slug: MATERIALS_CATEGORY_SLUG }, select: { id: true } });
  if (existing) return existing.id;
  const created = await tx.category.create({ data: { name: "Materials (internal)", slug: MATERIALS_CATEGORY_SLUG, isActive: false } });
  return created.id;
}

export async function ensureManufacturingSetupInTx(tx: AppTransactionClient, business: Pick<FinanceBusinessInfo, "id">, actor: FinanceActor = MANUFACTURING_SETUP_ACTOR) {
  const audits: FinanceAuditInput[] = [];
  const { byCode, mapped } = await chartState(tx, business.id);
  const changes = await provisionTemplateAccountsInTx(tx, business, { needed: new Set<string>(MANUFACTURING_MAPPING_KEYS), byCode, mapped, audits, actor, reason: "Manufacturing accounting set-up" });
  const existing = new Set((await tx.productionCostCategory.findMany({ where: { businessId: business.id }, select: { code: true } })).map((c) => c.code));
  for (const [i, c] of DEFAULT_COST_CATEGORIES.entries()) {
    if (existing.has(c.code)) continue;
    const row = await tx.productionCostCategory.create({ data: { businessId: business.id, code: c.code, name: c.name, group: c.group, sortOrder: i } });
    audits.push({ businessId: business.id, actor, action: "production_cost_category.create", entityType: "ProductionCostCategory", entityId: row.id, after: row });
    changes.push(`cost category ${c.code}`);
  }
  await materialsCategoryInTx(tx);
  await recordFinanceAudit(tx, audits);
  return { changes, missing: MANUFACTURING_MAPPING_KEYS.filter((k) => !mapped.has(k)) };
}

export async function ensureManufacturingSetup(actor: FinanceActor = MANUFACTURING_SETUP_ACTOR) {
  const { business } = await getFinanceContext();
  return financeTransaction((tx) => ensureManufacturingSetupInTx(tx, business, actor));
}

export async function manufacturingReadiness(db: AppTransactionClient | typeof prisma, businessId: string): Promise<{ ready: boolean; missing: AccountMappingKey[] }> {
  const mapped = new Set((await db.accountMapping.findMany({ where: { businessId }, select: { key: true } })).map((m) => m.key));
  const missing = MANUFACTURING_MAPPING_KEYS.filter((k) => !mapped.has(k));
  return { ready: missing.length === 0, missing };
}

export async function manufacturingStatus() {
  const { business } = await getFinanceContext();
  const [readiness, categories, biz] = await Promise.all([
    manufacturingReadiness(prisma, business.id),
    prisma.productionCostCategory.count({ where: { businessId: business.id } }),
    prisma.financeBusiness.findUniqueOrThrow({ where: { id: business.id }, select: { inventoryCostingActivatedAt: true } }),
  ]);
  return { readiness, costCategories: categories, currency: business.baseCurrency, costingActive: Boolean(biz.inventoryCostingActivatedAt) };
}

/** Configurable categories: list, add, rename / reorder / (de)activate — never delete (trigger). */
export async function listCostCategories(activeOnly = false) {
  const { business } = await getFinanceContext();
  return { categories: await prisma.productionCostCategory.findMany({ where: { businessId: business.id, ...(activeOnly ? { isActive: true } : {}) }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }) };
}

export async function createCostCategory(input: { code: string; name: string; group: ProductionCostGroup }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  return financeTransaction(async (tx) => {
    if (await tx.productionCostCategory.findUnique({ where: { businessId_code: { businessId: business.id, code: input.code } } })) {
      throw financeError(409, "COST_CATEGORY_CODE_TAKEN", `${input.code} already exists`);
    }
    const max = await tx.productionCostCategory.aggregate({ where: { businessId: business.id }, _max: { sortOrder: true } });
    const row = await tx.productionCostCategory.create({ data: { businessId: business.id, ...input, sortOrder: (max._max.sortOrder ?? 0) + 1 } });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "production_cost_category.create", entityType: "ProductionCostCategory", entityId: row.id, after: row });
    return row;
  });
}

export async function updateCostCategory(id: string, input: { name?: string; group?: ProductionCostGroup; isActive?: boolean; sortOrder?: number }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  return financeTransaction(async (tx) => {
    const before = await tx.productionCostCategory.findFirst({ where: { id, businessId: business.id } });
    if (!before) {
      throw financeError(404, "COST_CATEGORY_NOT_FOUND", "Cost category not found");
    }
    const after = await tx.productionCostCategory.update({ where: { id }, data: input });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "production_cost_category.update", entityType: "ProductionCostCategory", entityId: id, before, after });
    return after;
  });
}
