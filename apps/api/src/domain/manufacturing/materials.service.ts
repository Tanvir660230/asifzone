/**
 * Material items (docs/MANUFACTURING.md §3, decision D-M1): raw materials, components, trims and packaging are products of
 * kind MATERIAL — stock-tracked variants like any other, so receiving, issuing, counting, costing (moving average),
 * valuation and the cutover all apply unchanged; but never sold: the database keeps a material inactive and unpublished,
 * and the one purchasability rule (isActive) keeps it out of every storefront and checkout path.
 *
 * A material's variants carry its specification (size field: width, grade, gauge…) and colour. Every quantity is a whole
 * number of the material's stock unit (cm, g, pcs…), so the inventory engine's integer stock is exact.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { recordFinanceAudit, type FinanceActor } from "../finance/finance-audit";
import { getFinanceContext } from "../finance/finance-context";
import { financeError, toDecimal, toMajorNumber, toMinor } from "../finance/finance-values";
import { financeTransaction } from "../finance/finance-tx";
import { materialsCategoryInTx } from "./manufacturing-setup.service";

export interface MaterialVariantInput {
  sku: string;
  spec: string;
  color?: string | null;
}

export interface MaterialCreateInput {
  name: string;
  stockUnit: string;
  description?: string | null;
  /** A typed reference cost per stock unit — a planning aid; the valuation uses received costs. */
  referenceCost?: number | null;
  variants: MaterialVariantInput[];
}

const MATERIAL_SELECT = {
  id: true, name: true, slug: true, stockUnit: true, description: true, costPrice: true, deletedAt: true, createdAt: true,
  variants: { select: { id: true, sku: true, size: true, color: true, stock: true, isActive: true }, orderBy: { sku: "asc" } },
} satisfies Prisma.ProductSelect;
type MaterialRow = Prisma.ProductGetPayload<{ select: typeof MATERIAL_SELECT }>;

function materialDto(m: MaterialRow, cur: string, costs: Map<string, { avg: number | null; value: number; valuedQty: number }>) {
  return {
    id: m.id,
    name: m.name,
    stockUnit: m.stockUnit,
    description: m.description,
    referenceCost: m.costPrice === null ? null : toMajorNumber(toMinor(m.costPrice, cur), cur),
    archived: m.deletedAt !== null,
    variants: m.variants.map((v) => ({ id: v.id, sku: v.sku, spec: v.size, color: v.color, stock: v.stock, averageCost: costs.get(v.id)?.avg ?? null, value: costs.get(v.id)?.value ?? null })),
  };
}

const slugOf = (name: string) => `material-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60)}-${Date.now().toString(36)}`;

function checkUnit(unit: string) {
  if (!/^[A-Za-z][A-Za-z0-9 ./-]{0,15}$/.test(unit.trim())) throw financeError(400, "MATERIAL_UNIT", "A stock unit is a short word such as cm, m, g, kg or pcs");
}

export async function createMaterial(input: MaterialCreateInput, actor: FinanceActor, opts: { canSeeCost: boolean }) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  checkUnit(input.stockUnit);
  if (!input.variants.length) throw financeError(400, "MATERIAL_VARIANTS", "Add at least one variant (specification / colour)");
  return financeTransaction(async (tx) => {
    const taken = await tx.productVariant.findMany({ where: { sku: { in: input.variants.map((v) => v.sku) } }, select: { sku: true } });
    if (taken.length) throw financeError(409, "SKU_TAKEN", `SKU already used: ${taken.map((t) => t.sku).join(", ")}`);
    const categoryId = await materialsCategoryInTx(tx);
    const created = await tx.product.create({
      data: {
        name: input.name, slug: slugOf(input.name), description: input.description ?? "", categoryId, basePrice: 0,
        costPrice: input.referenceCost == null ? null : toDecimal(toMinor(input.referenceCost, cur), cur),
        kind: "MATERIAL", stockUnit: input.stockUnit.trim(), status: "DRAFT", isActive: false, trackInventory: true,
        variants: { create: input.variants.map((v, i) => ({ sku: v.sku, size: v.spec || "Standard", color: v.color ?? "", stock: 0, isActive: true, sortOrder: i })) },
      },
      select: MATERIAL_SELECT,
    });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "material.create", entityType: "Product", entityId: created.id, after: { name: created.name, stockUnit: created.stockUnit, variants: created.variants.map((v) => v.sku) } });
    return redact(materialDto(created, cur, new Map()), opts.canSeeCost);
  });
}

export async function updateMaterial(id: string, input: { name?: string; stockUnit?: string; description?: string | null; referenceCost?: number | null; addVariants?: MaterialVariantInput[] }, actor: FinanceActor, opts: { canSeeCost: boolean }) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  if (input.stockUnit !== undefined) checkUnit(input.stockUnit);
  return financeTransaction(async (tx) => {
    const before = await tx.product.findFirst({ where: { id, kind: "MATERIAL" }, select: MATERIAL_SELECT });
    if (!before) throw financeError(404, "MATERIAL_NOT_FOUND", "Material not found");
    // Changing the unit of a material that already has stock would silently re-mean every quantity — refused.
    if (input.stockUnit !== undefined && input.stockUnit.trim() !== before.stockUnit && before.variants.some((v) => v.stock !== 0)) {
      throw financeError(409, "MATERIAL_UNIT_IN_USE", "This material has stock — its stock unit can't change");
    }
    if (input.addVariants?.length) {
      const taken = await tx.productVariant.findMany({ where: { sku: { in: input.addVariants.map((v) => v.sku) } }, select: { sku: true } });
      if (taken.length) throw financeError(409, "SKU_TAKEN", `SKU already used: ${taken.map((t) => t.sku).join(", ")}`);
      await tx.productVariant.createMany({ data: input.addVariants.map((v, i) => ({ productId: id, sku: v.sku, size: v.spec || "Standard", color: v.color ?? "", stock: 0, sortOrder: before.variants.length + i })) });
    }
    const after = await tx.product.update({
      where: { id },
      data: {
        name: input.name, description: input.description === undefined ? undefined : input.description ?? "", stockUnit: input.stockUnit?.trim(),
        costPrice: input.referenceCost === undefined ? undefined : input.referenceCost === null ? null : toDecimal(toMinor(input.referenceCost, cur), cur),
      },
      select: MATERIAL_SELECT,
    });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "material.update", entityType: "Product", entityId: id, before: { name: before.name, stockUnit: before.stockUnit }, after: { name: after.name, stockUnit: after.stockUnit, added: input.addVariants?.map((v) => v.sku) ?? [] } });
    return redact(materialDto(after, cur, new Map()), opts.canSeeCost);
  });
}

function redact<T extends { referenceCost: number | null; variants: Array<{ averageCost: number | null; value: number | null }> }>(dto: T, canSeeCost: boolean): T {
  if (canSeeCost) return dto;
  return { ...dto, referenceCost: null, variants: dto.variants.map((v) => ({ ...v, averageCost: null, value: null })) };
}

/** Materials with their stock and — for costing.read — their moving-average cost and value. */
export async function listMaterials(q: { q?: string; includeArchived?: boolean }, opts: { canSeeCost: boolean }) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const rows = await prisma.product.findMany({
    where: {
      kind: "MATERIAL",
      ...(q.includeArchived ? {} : { deletedAt: null }),
      ...(q.q ? { OR: [{ name: { contains: q.q, mode: "insensitive" } }, { variants: { some: { sku: { contains: q.q, mode: "insensitive" } } } }] } : {}),
    },
    select: MATERIAL_SELECT,
    orderBy: { name: "asc" },
    take: 500,
  });
  const ids = rows.flatMap((r) => r.variants.map((v) => v.id));
  const states = opts.canSeeCost && ids.length ? await prisma.inventoryCostState.findMany({ where: { variantId: { in: ids } }, select: { variantId: true, avgUnitCost: true, value: true, valuedQty: true } }) : [];
  const costs = new Map(states.map((s) => [s.variantId, { avg: s.avgUnitCost === null ? null : Number(s.avgUnitCost), value: toMajorNumber(toMinor(s.value, cur), cur), valuedQty: s.valuedQty }]));
  return { materials: rows.map((r) => redact(materialDto(r, cur, costs), opts.canSeeCost)) };
}
