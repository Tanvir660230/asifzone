/**
 * Bills of materials (docs/MANUFACTURING.md §4): what one finished unit of a product takes. Versioned — DRAFT (editable)
 * → APPROVED (frozen, used to plan production orders) → ARCHIVED. A change to an approved BOM is a new version (copy).
 * A line names a stock-tracked material variant, its quantity per finished unit (in the material's stock unit), expected
 * wastage and who supplies it (the business, issued from stock; or the producer, inside the producer's price), and applies
 * to every variant of the product or to one (a larger size).
 */
import type { BillOfMaterials, MaterialSupplier, Prisma } from "@prisma/client";
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { actorCan, recordFinanceAudit, type FinanceActor } from "../finance/finance-audit";
import { getFinanceContext } from "../finance/finance-context";
import { financeError } from "../finance/finance-values";
import { financeTransaction } from "../finance/finance-tx";
import { scaleDecimal } from "./requirements";

export interface BomLineInput {
  materialVariantId: string;
  finishedVariantId?: string | null;
  qtyPerUnit: string;
  wastagePct?: string;
  suppliedBy?: MaterialSupplier;
  notes?: string | null;
}

const BOM_INCLUDE = {
  product: { select: { id: true, name: true } },
  lines: {
    orderBy: { lineNo: "asc" },
    include: {
      materialVariant: { select: { id: true, sku: true, size: true, color: true, product: { select: { name: true, stockUnit: true, kind: true } } } },
      finishedVariant: { select: { id: true, sku: true, size: true, color: true } },
    },
  },
} satisfies Prisma.BillOfMaterialsInclude;
type BomRow = Prisma.BillOfMaterialsGetPayload<{ include: typeof BOM_INCLUDE }>;

export function bomDto(b: BomRow) {
  return {
    id: b.id,
    product: b.product,
    version: b.version,
    status: b.status,
    name: b.name,
    notes: b.notes,
    approvedAt: b.approvedAt,
    archivedAt: b.archivedAt,
    createdAt: b.createdAt,
    lines: b.lines.map((l) => ({
      id: l.id,
      lineNo: l.lineNo,
      material: { variantId: l.materialVariant.id, sku: l.materialVariant.sku, name: `${l.materialVariant.product.name} — ${l.materialVariant.size}${l.materialVariant.color ? ` / ${l.materialVariant.color}` : ""}`, stockUnit: l.materialVariant.product.stockUnit ?? "pcs", isMaterial: l.materialVariant.product.kind === "MATERIAL" },
      finishedVariant: l.finishedVariant ? { id: l.finishedVariant.id, sku: l.finishedVariant.sku, label: `${l.finishedVariant.size} / ${l.finishedVariant.color}` } : null,
      qtyPerUnit: l.qtyPerUnit.toString(),
      wastagePct: l.wastagePct.toString(),
      suppliedBy: l.suppliedBy,
      notes: l.notes,
    })),
  };
}

async function load(db: AppTransactionClient | typeof prisma, businessId: string, id: string) {
  const b = await db.billOfMaterials.findFirst({ where: { id, businessId }, include: BOM_INCLUDE });
  if (!b) throw financeError(404, "BOM_NOT_FOUND", "Bill of materials not found");
  return b;
}

async function lockBom(tx: AppTransactionClient, businessId: string, id: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "BillOfMaterials" WHERE id = ${id} AND "businessId" = ${businessId} FOR UPDATE`;
  if (!rows.length) throw financeError(404, "BOM_NOT_FOUND", "Bill of materials not found");
  return load(tx, businessId, id);
}

/** Validates lines: tracked materials that aren't the product itself, finished variants of this product, exact decimals. */
async function lineRows(tx: AppTransactionClient, productId: string, lines: BomLineInput[]): Promise<Array<Omit<Prisma.BillOfMaterialsLineCreateManyInput, "bomId">>> {
  if (!lines.length) throw financeError(400, "BOM_EMPTY", "Add at least one material");
  const ids = [...new Set(lines.map((l) => l.materialVariantId))];
  const materials = await tx.productVariant.findMany({ where: { id: { in: ids } }, select: { id: true, sku: true, productId: true, product: { select: { trackInventory: true, deletedAt: true } } } });
  const finished = new Set((await tx.productVariant.findMany({ where: { productId }, select: { id: true } })).map((v) => v.id));
  return lines.map((l, i) => {
    const m = materials.find((x) => x.id === l.materialVariantId);
    if (!m) throw financeError(400, "VARIANT_NOT_FOUND", `Line ${i + 1}: material not found`);
    if (m.productId === productId) throw financeError(400, "BOM_SELF", `Line ${i + 1}: a product isn't its own material`);
    if (!m.product.trackInventory) throw financeError(400, "BOM_UNTRACKED", `Line ${i + 1}: ${m.sku} isn't stock-tracked`);
    if (l.finishedVariantId && !finished.has(l.finishedVariantId)) throw financeError(400, "BOM_VARIANT", `Line ${i + 1}: that size / colour isn't a variant of this product`);
    const wastage = l.wastagePct ?? "0";
    try {
      if (scaleDecimal(l.qtyPerUnit, 6) <= 0n) throw new Error("zero");
      if (scaleDecimal(wastage, 2) >= 10_000n) throw new Error("wastage");
    } catch {
      throw financeError(400, "BOM_QUANTITY", `Line ${i + 1}: quantity per unit is a positive number (≤ 6 decimals); wastage is 0–99.99%`);
    }
    return { lineNo: i + 1, materialVariantId: m.id, finishedVariantId: l.finishedVariantId ?? null, qtyPerUnit: l.qtyPerUnit, wastagePct: wastage, suppliedBy: l.suppliedBy ?? "BUSINESS", notes: l.notes ?? null };
  });
}

async function finishedProduct(tx: AppTransactionClient, productId: string) {
  const p = await tx.product.findUnique({ where: { id: productId }, select: { id: true, name: true, kind: true, trackInventory: true, deletedAt: true } });
  if (!p || p.deletedAt) throw financeError(404, "PRODUCT_NOT_FOUND", "Product not found");
  if (p.kind !== "FINISHED") throw financeError(400, "BOM_FOR_MATERIAL", "A bill of materials is for a finished product");
  if (!p.trackInventory) throw financeError(400, "PRODUCT_UNTRACKED", `${p.name} isn't stock-tracked — produced goods must be`);
  return p;
}

export async function createBom(input: { productId: string; name?: string | null; notes?: string | null; lines: BomLineInput[] }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  return financeTransaction(async (tx) => {
    await finishedProduct(tx, input.productId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mfg-bom:${input.productId}`}))`;
    const max = await tx.billOfMaterials.aggregate({ where: { productId: input.productId }, _max: { version: true } });
    const rows = await lineRows(tx, input.productId, input.lines);
    const created = await tx.billOfMaterials.create({
      data: { businessId: business.id, productId: input.productId, version: (max._max.version ?? 0) + 1, name: input.name ?? null, notes: input.notes ?? null, createdByAdminId: actor.type === "ADMIN" ? actor.adminId : null, lines: { createMany: { data: rows } } },
      include: BOM_INCLUDE,
    });
    const dto = bomDto(created);
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "bom.create", entityType: "BillOfMaterials", entityId: created.id, after: dto });
    return dto;
  });
}

export async function updateBom(id: string, input: { name?: string | null; notes?: string | null; lines?: BomLineInput[] }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  return financeTransaction(async (tx) => {
    const before = await lockBom(tx, business.id, id);
    if (before.status !== "DRAFT") throw financeError(409, "BOM_NOT_DRAFT", "An approved bill of materials is frozen — copy it to a new version");
    if (input.lines) {
      const rows = await lineRows(tx, before.productId, input.lines);
      await tx.billOfMaterialsLine.deleteMany({ where: { bomId: id } });
      await tx.billOfMaterialsLine.createMany({ data: rows.map((r) => ({ ...r, bomId: id })) });
    }
    await tx.billOfMaterials.update({ where: { id }, data: { name: input.name === undefined ? undefined : input.name, notes: input.notes === undefined ? undefined : input.notes } });
    const after = bomDto(await load(tx, business.id, id));
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "bom.update", entityType: "BillOfMaterials", entityId: id, before: bomDto(before), after });
    return after;
  });
}

async function transition(id: string, actor: FinanceActor, action: string, apply: (b: BomRow) => Prisma.BillOfMaterialsUpdateInput) {
  const { business } = await getFinanceContext();
  return financeTransaction(async (tx) => {
    const before = await lockBom(tx, business.id, id);
    await tx.billOfMaterials.update({ where: { id }, data: apply(before) });
    const after = await load(tx, business.id, id);
    await recordFinanceAudit(tx, { businessId: business.id, actor, action, entityType: "BillOfMaterials", entityId: id, before: { status: before.status }, after: { status: after.status } });
    return bomDto(after);
  });
}

/**
 * Approves a draft. A product has one approved recipe at a time: the version approved before it is archived in the same
 * transaction (filling and planning read the latest approved one, so leaving the old one approved only confused the lists).
 * Production orders already planned on the old version keep it.
 */
export async function approveBom(id: string, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  return financeTransaction(async (tx) => {
    const before = await lockBom(tx, business.id, id);
    if (!actorCan(actor, "manufacturing.approve")) throw financeError(403, "FORBIDDEN", "Approving a bill of materials needs manufacturing.approve");
    if (before.status !== "DRAFT") throw financeError(409, "BOM_NOT_DRAFT", "Only a draft bill of materials is approved");
    if (!before.lines.length) throw financeError(409, "BOM_EMPTY", "Add at least one material");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mfg-bom:${before.productId}`}))`;
    const now = new Date();
    const replaced = await tx.billOfMaterials.findMany({ where: { productId: before.productId, status: "APPROVED", id: { not: id } }, select: { id: true, version: true } });
    if (replaced.length) await tx.billOfMaterials.updateMany({ where: { id: { in: replaced.map((r) => r.id) } }, data: { status: "ARCHIVED", archivedAt: now } });
    await tx.billOfMaterials.update({ where: { id }, data: { status: "APPROVED", approvedAt: now, approvedByAdminId: actor.type === "ADMIN" ? actor.adminId : null } });
    const after = await load(tx, business.id, id);
    for (const r of replaced) {
      await recordFinanceAudit(tx, { businessId: business.id, actor, action: "bom.archive", entityType: "BillOfMaterials", entityId: r.id, before: { status: "APPROVED" }, after: { status: "ARCHIVED", replacedBy: after.version } });
    }
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "bom.approve", entityType: "BillOfMaterials", entityId: id, before: { status: before.status }, after: { status: after.status, replaced: replaced.map((r) => r.version) } });
    return bomDto(after);
  });
}

export const archiveBom = (id: string, actor: FinanceActor) =>
  transition(id, actor, "bom.archive", (b) => {
    if (b.status !== "APPROVED") throw financeError(409, "BOM_STATUS", "Only an approved bill of materials is archived (delete a draft)");
    return { status: "ARCHIVED", archivedAt: new Date() };
  });

/** A new DRAFT version with the same lines — how an approved BOM changes. */
export async function copyBom(id: string, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const source = await load(prisma, business.id, id);
  return createBom({
    productId: source.productId,
    name: source.name,
    notes: source.notes,
    lines: source.lines.map((l) => ({ materialVariantId: l.materialVariantId, finishedVariantId: l.finishedVariantId, qtyPerUnit: l.qtyPerUnit.toString(), wastagePct: l.wastagePct.toString(), suppliedBy: l.suppliedBy, notes: l.notes })),
  }, actor);
}

export async function deleteDraftBom(id: string, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  return financeTransaction(async (tx) => {
    const b = await lockBom(tx, business.id, id);
    if (b.status !== "DRAFT") throw financeError(409, "BOM_NOT_DRAFT", "Only a draft is deleted — archive an approved bill of materials");
    await tx.billOfMaterialsLine.deleteMany({ where: { bomId: id } });
    await tx.billOfMaterials.delete({ where: { id } });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "bom.delete_draft", entityType: "BillOfMaterials", entityId: id, before: bomDto(b) });
  });
}

export async function getBom(id: string) {
  const { business } = await getFinanceContext();
  return bomDto(await load(prisma, business.id, id));
}

export async function listBoms(q: { productId?: string; status?: BillOfMaterials["status"] }) {
  const { business } = await getFinanceContext();
  const rows = await prisma.billOfMaterials.findMany({ where: { businessId: business.id, productId: q.productId, status: q.status }, include: BOM_INCLUDE, orderBy: [{ productId: "asc" }, { version: "desc" }], take: 500 });
  return { boms: rows.map(bomDto) };
}
