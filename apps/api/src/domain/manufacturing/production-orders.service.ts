/**
 * Production orders (docs/MANUFACTURING.md §5). One order makes one finished product, planned per variant (size × colour),
 * by a producer (an existing Supplier — decision D-M6) or in-house. Its material requirements come from an approved BOM
 * version (requirements.ts — exact, rounded up to whole stock units) plus any added by hand, and its planned non-material
 * costs per configurable category. Totals are derived from the lines, never stored.
 *
 * Lifecycle (database trigger M-4): DRAFT → APPROVED → IN_PRODUCTION → PARTIALLY_RECEIVED → RECEIVED → CLOSED, CANCELLED
 * before anything is issued. M1 covers planning and approval; issuing materials (M2), costs (M3), receipts and inspection
 * (M4) and closing (M5) build on it. Approval snapshots each business-supplied material's moving-average cost — the planned
 * material cost the actuals are later compared with.
 */
import type { Prisma, ProductionOrderStatus } from "@prisma/client";
import { minorDigits } from "@clothing-brand/shared";
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { actorCan, recordFinanceAudit, type FinanceActor } from "../finance/finance-audit";
import { businessToday, getFinanceContext } from "../finance/finance-context";
import { businessDateOf, dateColumn, financeError, toDecimal, toMajorNumber, toMinor } from "../finance/finance-values";
import { financeTransaction } from "../finance/finance-tx";
import { nextFinanceSequence } from "../finance/suppliers.service";
import { divRound } from "../finance/costing.service";
import { computeRequirements, scaleDecimal } from "./requirements";
import { costEntryDto } from "./production-costs.service";

export const moNumber = (n: number) => `MO-${String(n).padStart(6, "0")}`;
const adminOf = (actor: FinanceActor) => (actor.type === "ADMIN" ? actor.adminId : null);

export interface ProductionOrderInput {
  productId: string;
  producerSupplierId?: string | null;
  bomId?: string | null;
  orderDate?: string;
  expectedDate?: string | null;
  terms?: string | null;
  notes?: string | null;
  lines: Array<{ variantId: string; plannedQty: number }>;
  /** Materials added by hand (beyond the BOM), in the material's stock units. */
  extraMaterials?: Array<{ materialVariantId: string; plannedQty: number; suppliedBy?: "BUSINESS" | "PRODUCER" }>;
  plannedCosts?: Array<{ categoryId: string; amount: number; basis?: string | null }>;
}

const MO_INCLUDE = {
  product: { select: { id: true, name: true } },
  producer: { select: { id: true, code: true, displayName: true, status: true } },
  bom: { select: { id: true, version: true, status: true } },
  lines: { orderBy: { lineNo: "asc" }, include: { variant: { select: { id: true, sku: true, size: true, color: true } } } },
  materials: { orderBy: { lineNo: "asc" }, include: { materialVariant: { select: { id: true, sku: true, size: true, color: true, stock: true, product: { select: { name: true, stockUnit: true } } } }, moves: { select: { kind: true, value: true } } } },
  plannedCosts: { include: { category: { select: { id: true, code: true, name: true, group: true } } } },
  costEntries: { orderBy: { createdAt: "asc" }, include: { category: { select: { id: true, code: true, name: true, group: true } }, supplier: { select: { id: true, code: true, displayName: true } } } },
} satisfies Prisma.ProductionOrderInclude;
type MoRow = Prisma.ProductionOrderGetPayload<{ include: typeof MO_INCLUDE }>;

/** Σ qty × unit cost (10⁻⁶ major units) in minor units, half-even. */
function materialCostMinor(qty: number, unitCost: Prisma.Decimal, cur: string): number {
  const scaled = scaleDecimal(unitCost.toFixed(6), 6);
  return Number(divRound(BigInt(qty) * scaled, 10n ** BigInt(6 - minorDigits(cur))));
}

export function productionOrderDto(o: MoRow, cur: string, opts: { canSeeCost: boolean }) {
  const plannedUnits = o.lines.reduce((n, l) => n + l.plannedQty, 0);
  const business = o.materials.filter((m) => m.suppliedBy === "BUSINESS");
  const costed = business.filter((m) => m.plannedUnitCost !== null);
  const materialMinor = costed.reduce((s, m) => s + materialCostMinor(m.plannedQty, m.plannedUnitCost!, cur), 0);
  const otherMinor = o.plannedCosts.reduce((s, c) => s + toMinor(c.amount, cur), 0);
  const moveValue = (m: MoRow["materials"][number], kind: "ISSUE" | "RETURN") => m.moves.filter((x) => x.kind === kind).reduce((s, x) => s + toMinor(x.value, cur), 0);
  const wipMinor = o.materials.reduce((s, m) => s + moveValue(m, "ISSUE") - moveValue(m, "RETURN"), 0);
  const approved = o.costEntries.filter((c) => c.status === "APPROVED");
  const approvedMinor = approved.reduce((s, c) => s + toMinor(c.amount, cur), 0);
  // Planned vs actual per category: materials (plan snapshot vs net issued value) and each cost category.
  const categories = new Map<string, { category: { id: string; code: string; name: string; group: string }; plannedMinor: number; actualMinor: number }>();
  for (const pc of o.plannedCosts) categories.set(pc.categoryId, { category: pc.category, plannedMinor: toMinor(pc.amount, cur), actualMinor: 0 });
  for (const c of approved) {
    const row = categories.get(c.categoryId) ?? { category: c.category, plannedMinor: 0, actualMinor: 0 };
    row.actualMinor += toMinor(c.amount, cur);
    categories.set(c.categoryId, row);
  }
  const cost = (v: number | null) => (opts.canSeeCost ? v : null);
  return {
    id: o.id,
    number: moNumber(o.number),
    status: o.status,
    product: o.product,
    producer: o.producer,
    inHouse: !o.producerSupplierId,
    bom: o.bom,
    orderDate: businessDateOf(o.orderDate),
    expectedDate: o.expectedDate ? businessDateOf(o.expectedDate) : null,
    terms: o.terms,
    notes: o.notes,
    approvedAt: o.approvedAt,
    startedAt: o.startedAt,
    closedAt: o.closedAt,
    closedReason: o.closedReason,
    cancelledReason: o.cancelledReason,
    createdAt: o.createdAt,
    plannedUnits,
    lines: o.lines.map((l) => ({ id: l.id, lineNo: l.lineNo, variantId: l.variantId, sku: l.variant.sku, size: l.variant.size, color: l.variant.color, plannedQty: l.plannedQty })),
    materials: o.materials.map((m) => ({
      id: m.id,
      lineNo: m.lineNo,
      materialVariantId: m.materialVariantId,
      sku: m.materialVariant.sku,
      name: `${m.materialVariant.product.name} — ${m.materialVariant.size}${m.materialVariant.color ? ` / ${m.materialVariant.color}` : ""}`,
      stockUnit: m.materialVariant.product.stockUnit ?? "pcs",
      suppliedBy: m.suppliedBy,
      fromBom: m.fromBom,
      qtyPerUnit: m.qtyPerUnit?.toString() ?? null,
      wastagePct: m.wastagePct?.toString() ?? null,
      plannedQty: m.plannedQty,
      inStock: m.materialVariant.stock,
      shortfall: m.suppliedBy === "BUSINESS" ? Math.max(0, m.plannedQty - m.issuedQty - m.materialVariant.stock) : 0,
      plannedUnitCost: cost(m.plannedUnitCost === null ? null : Number(m.plannedUnitCost)),
      plannedCost: cost(m.plannedUnitCost === null ? null : toMajorNumber(materialCostMinor(m.plannedQty, m.plannedUnitCost, cur), cur)),
      issuedQty: m.issuedQty,
      returnedQty: m.returnedQty,
      consumedQty: m.consumedQty,
      scrappedQty: m.scrappedQty,
      atProducer: m.issuedQty - m.returnedQty - m.consumedQty - m.scrappedQty,
      issuedValue: cost(toMajorNumber(moveValue(m, "ISSUE"), cur)),
      returnedValue: cost(toMajorNumber(moveValue(m, "RETURN"), cur)),
    })),
    /** Value now in work in progress for this order: material issued − returned + approved production costs. */
    wip: opts.canSeeCost ? { materials: toMajorNumber(wipMinor, cur), costs: toMajorNumber(approvedMinor, cur), total: toMajorNumber(wipMinor + approvedMinor, cur) } : null,
    costs: o.costEntries.map((c) => costEntryDto(c, cur)),
    /** Planned vs actual: actual = net material issued + approved costs; variance = actual − planned (positive = over plan). */
    comparison: opts.canSeeCost
      ? {
          materials: { planned: toMajorNumber(materialMinor, cur), actual: toMajorNumber(wipMinor, cur), variance: toMajorNumber(wipMinor - materialMinor, cur), plannedIncomplete: business.length - costed.length > 0 },
          categories: [...categories.values()].map((r) => ({ category: r.category, planned: toMajorNumber(r.plannedMinor, cur), actual: toMajorNumber(r.actualMinor, cur), variance: toMajorNumber(r.actualMinor - r.plannedMinor, cur) })),
          total: { planned: toMajorNumber(materialMinor + otherMinor, cur), actual: toMajorNumber(wipMinor + approvedMinor, cur), variance: toMajorNumber(wipMinor + approvedMinor - materialMinor - otherMinor, cur) },
          pendingApproval: toMajorNumber(o.costEntries.filter((c) => c.status === "DRAFT").reduce((s, c) => s + toMinor(c.amount, cur), 0), cur),
        }
      : null,
    plannedCosts: o.plannedCosts.map((c) => ({ id: c.id, category: c.category, amount: cost(toMajorNumber(toMinor(c.amount, cur), cur)), basis: c.basis })),
    planned: opts.canSeeCost
      ? {
          materialCost: toMajorNumber(materialMinor, cur),
          /** Business-supplied materials with no known cost yet — the material cost is then incomplete. */
          materialsWithoutCost: business.length - costed.length,
          otherCost: toMajorNumber(otherMinor, cur),
          totalCost: toMajorNumber(materialMinor + otherMinor, cur),
          costPerUnit: plannedUnits ? toMajorNumber(Math.round((materialMinor + otherMinor) / plannedUnits), cur) : null,
        }
      : null,
  };
}

async function load(db: AppTransactionClient | typeof prisma, businessId: string, id: string) {
  const o = await db.productionOrder.findFirst({ where: { id, businessId }, include: MO_INCLUDE });
  if (!o) throw financeError(404, "PRODUCTION_ORDER_NOT_FOUND", "Production order not found");
  return o;
}

export async function lockProductionOrder(tx: AppTransactionClient, businessId: string, id: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "ProductionOrder" WHERE id = ${id} AND "businessId" = ${businessId} FOR UPDATE`;
  if (!rows.length) throw financeError(404, "PRODUCTION_ORDER_NOT_FOUND", "Production order not found");
  return load(tx, businessId, id);
}

/** Validates and builds the plan: finished lines, material requirements (BOM + extra), planned costs. */
async function buildPlan(tx: AppTransactionClient, businessId: string, cur: string, input: ProductionOrderInput) {
  const product = await tx.product.findUnique({ where: { id: input.productId }, select: { id: true, name: true, kind: true, trackInventory: true, deletedAt: true } });
  if (!product || product.deletedAt) throw financeError(404, "PRODUCT_NOT_FOUND", "Product not found");
  if (product.kind !== "FINISHED") throw financeError(400, "PRODUCE_MATERIAL", "Production orders make finished products");
  if (!product.trackInventory) throw financeError(400, "PRODUCT_UNTRACKED", `${product.name} isn't stock-tracked — produced goods must be`);
  if (!input.lines.length) throw financeError(400, "MO_EMPTY", "Plan at least one size / colour");
  const variants = new Map((await tx.productVariant.findMany({ where: { productId: product.id }, select: { id: true } })).map((v) => [v.id, v]));
  const seen = new Set<string>();
  for (const [i, l] of input.lines.entries()) {
    if (!variants.has(l.variantId)) throw financeError(400, "MO_VARIANT", `Line ${i + 1}: not a variant of ${product.name}`);
    if (seen.has(l.variantId)) throw financeError(400, "MO_VARIANT_TWICE", `Line ${i + 1}: each variant once`);
    if (!Number.isSafeInteger(l.plannedQty) || l.plannedQty <= 0) throw financeError(400, "MO_QTY", `Line ${i + 1}: planned quantity is a positive whole number`);
    seen.add(l.variantId);
  }
  if (input.producerSupplierId) {
    const s = await tx.supplier.findFirst({ where: { id: input.producerSupplierId, businessId } });
    if (!s) throw financeError(404, "SUPPLIER_NOT_FOUND", "Producer not found");
    if (s.status !== "ACTIVE") throw financeError(409, "SUPPLIER_NOT_ACTIVE", `${s.displayName} isn't active`);
  }
  let requirements: ReturnType<typeof computeRequirements> = [];
  if (input.bomId) {
    const bom = await tx.billOfMaterials.findFirst({ where: { id: input.bomId, businessId }, include: { lines: true } });
    if (!bom) throw financeError(404, "BOM_NOT_FOUND", "Bill of materials not found");
    if (bom.productId !== product.id) throw financeError(400, "BOM_PRODUCT", "That bill of materials is for another product");
    if (bom.status !== "APPROVED") throw financeError(409, "BOM_NOT_APPROVED", "Plan from an approved bill of materials");
    requirements = computeRequirements(
      bom.lines.map((l) => ({ id: l.id, materialVariantId: l.materialVariantId, finishedVariantId: l.finishedVariantId, qtyPerUnit: l.qtyPerUnit.toString(), wastagePct: l.wastagePct.toString(), suppliedBy: l.suppliedBy })),
      input.lines,
    );
  }
  const extra = input.extraMaterials ?? [];
  if (extra.length) {
    const found = await tx.productVariant.findMany({ where: { id: { in: extra.map((e) => e.materialVariantId) } }, select: { id: true, sku: true, product: { select: { trackInventory: true } } } });
    for (const [i, e] of extra.entries()) {
      const v = found.find((x) => x.id === e.materialVariantId);
      if (!v) throw financeError(400, "VARIANT_NOT_FOUND", `Extra material ${i + 1}: not found`);
      if (!v.product.trackInventory) throw financeError(400, "MATERIAL_UNTRACKED", `Extra material ${i + 1}: ${v.sku} isn't stock-tracked`);
      if (!Number.isSafeInteger(e.plannedQty) || e.plannedQty <= 0) throw financeError(400, "MO_QTY", `Extra material ${i + 1}: a positive whole number of stock units`);
    }
  }
  const costs = input.plannedCosts ?? [];
  if (costs.length) {
    const cats = await tx.productionCostCategory.findMany({ where: { businessId, id: { in: costs.map((c) => c.categoryId) } } });
    for (const c of costs) {
      const cat = cats.find((x) => x.id === c.categoryId);
      if (!cat) throw financeError(400, "COST_CATEGORY_NOT_FOUND", "A planned cost names an unknown category");
      if (!cat.isActive) throw financeError(400, "COST_CATEGORY_INACTIVE", `${cat.name} is inactive`);
    }
    if (new Set(costs.map((c) => c.categoryId)).size !== costs.length) throw financeError(400, "PLANNED_COST_TWICE", "One planned amount per category");
  }
  return {
    lines: input.lines.map((l, i) => ({ lineNo: i + 1, variantId: l.variantId, plannedQty: l.plannedQty })),
    materials: [
      ...requirements.map((r) => ({ materialVariantId: r.materialVariantId, suppliedBy: r.suppliedBy, fromBom: true, bomLineId: r.bomLineId, qtyPerUnit: r.qtyPerUnit, wastagePct: r.wastagePct, plannedQty: r.plannedQty })),
      ...extra.map((e) => ({ materialVariantId: e.materialVariantId, suppliedBy: e.suppliedBy ?? ("BUSINESS" as const), fromBom: false, bomLineId: null, qtyPerUnit: null, wastagePct: null, plannedQty: e.plannedQty })),
    ].map((m, i) => ({ ...m, lineNo: i + 1 })),
    plannedCosts: costs.map((c) => ({ categoryId: c.categoryId, amount: toDecimal(toMinor(c.amount, cur), cur), basis: c.basis ?? null })),
  };
}

function checkDates(orderDate: string, expectedDate: string | null | undefined, openingDate: string | null) {
  if (openingDate && orderDate < openingDate) throw financeError(400, "BEFORE_OPENING_DATE", `The books start on ${openingDate}`);
  if (expectedDate && expectedDate < orderDate) throw financeError(400, "MO_DATES", "The expected date is before the order date");
}

export async function createProductionOrder(input: ProductionOrderInput, actor: FinanceActor, opts: { canSeeCost: boolean }) {
  const { business, brand } = await getFinanceContext();
  const cur = business.baseCurrency;
  const orderDate = input.orderDate ?? businessToday(business);
  checkDates(orderDate, input.expectedDate, business.openingDate);
  return financeTransaction(async (tx) => {
    const plan = await buildPlan(tx, business.id, cur, input);
    const created = await tx.productionOrder.create({
      data: {
        businessId: business.id, brandId: brand.id, number: await nextFinanceSequence(tx, business.id, "production_order"), productId: input.productId,
        bomId: input.bomId ?? null, producerSupplierId: input.producerSupplierId ?? null, orderDate: dateColumn(orderDate),
        expectedDate: input.expectedDate ? dateColumn(input.expectedDate) : null, terms: input.terms ?? null, notes: input.notes ?? null, createdByAdminId: adminOf(actor),
        lines: { createMany: { data: plan.lines } }, materials: { createMany: { data: plan.materials } }, plannedCosts: { createMany: { data: plan.plannedCosts } },
      },
      include: MO_INCLUDE,
    });
    const dto = productionOrderDto(created, cur, { canSeeCost: true });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "production_order.create", entityType: "ProductionOrder", entityId: created.id, after: dto });
    return productionOrderDto(created, cur, opts);
  });
}

/** A draft only: the whole plan is rebuilt from the input (header fields kept when not sent). */
export async function updateProductionOrder(id: string, input: Partial<ProductionOrderInput>, actor: FinanceActor, opts: { canSeeCost: boolean }) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  return financeTransaction(async (tx) => {
    const before = await lockProductionOrder(tx, business.id, id);
    if (before.status !== "DRAFT") throw financeError(409, "MO_NOT_DRAFT", "Only a draft production order is edited");
    const merged: ProductionOrderInput = {
      productId: input.productId ?? before.productId,
      producerSupplierId: input.producerSupplierId !== undefined ? input.producerSupplierId : before.producerSupplierId,
      bomId: input.bomId !== undefined ? input.bomId : before.bomId,
      orderDate: input.orderDate ?? businessDateOf(before.orderDate),
      expectedDate: input.expectedDate !== undefined ? input.expectedDate : before.expectedDate ? businessDateOf(before.expectedDate) : null,
      terms: input.terms !== undefined ? input.terms : before.terms,
      notes: input.notes !== undefined ? input.notes : before.notes,
      lines: input.lines ?? before.lines.map((l) => ({ variantId: l.variantId, plannedQty: l.plannedQty })),
      extraMaterials: input.extraMaterials ?? before.materials.filter((m) => !m.fromBom).map((m) => ({ materialVariantId: m.materialVariantId, plannedQty: m.plannedQty, suppliedBy: m.suppliedBy })),
      plannedCosts: input.plannedCosts ?? before.plannedCosts.map((c) => ({ categoryId: c.categoryId, amount: toMajorNumber(toMinor(c.amount, cur), cur), basis: c.basis })),
    };
    checkDates(merged.orderDate!, merged.expectedDate, business.openingDate);
    const plan = await buildPlan(tx, business.id, cur, merged);
    await tx.productionOrderLine.deleteMany({ where: { productionOrderId: id } });
    await tx.productionMaterialLine.deleteMany({ where: { productionOrderId: id } });
    await tx.productionPlannedCost.deleteMany({ where: { productionOrderId: id } });
    await tx.productionOrder.update({
      where: { id },
      data: {
        productId: merged.productId, producerSupplierId: merged.producerSupplierId ?? null, bomId: merged.bomId ?? null, orderDate: dateColumn(merged.orderDate!),
        expectedDate: merged.expectedDate ? dateColumn(merged.expectedDate) : null, terms: merged.terms ?? null, notes: merged.notes ?? null,
        lines: { createMany: { data: plan.lines } }, materials: { createMany: { data: plan.materials } }, plannedCosts: { createMany: { data: plan.plannedCosts } },
      },
    });
    const after = await load(tx, business.id, id);
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "production_order.update", entityType: "ProductionOrder", entityId: id, before: productionOrderDto(before, cur, { canSeeCost: true }), after: productionOrderDto(after, cur, { canSeeCost: true }) });
    return productionOrderDto(after, cur, opts);
  });
}

async function transition(id: string, actor: FinanceActor, action: string, apply: (o: MoRow, tx: AppTransactionClient) => Promise<Prisma.ProductionOrderUpdateInput> | Prisma.ProductionOrderUpdateInput, opts: { canSeeCost: boolean }, reason?: string | null) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  return financeTransaction(async (tx) => {
    const before = await lockProductionOrder(tx, business.id, id);
    await tx.productionOrder.update({ where: { id }, data: await apply(before, tx) });
    const after = await load(tx, business.id, id);
    await recordFinanceAudit(tx, { businessId: business.id, actor, action, entityType: "ProductionOrder", entityId: id, before: { status: before.status }, after: { status: after.status }, reason: reason ?? null });
    return productionOrderDto(after, cur, opts);
  });
}

const need = (o: MoRow, ...allowed: ProductionOrderStatus[]) => {
  if (!allowed.includes(o.status)) throw financeError(409, "MO_STATUS", `The production order is ${o.status.toLowerCase().replace("_", " ")}`);
};

/** Approves the plan and snapshots each business-supplied material's moving-average cost (the planned material cost). */
export const approveProductionOrder = (id: string, actor: FinanceActor, opts: { canSeeCost: boolean }) =>
  transition(id, actor, "production_order.approve", async (o, tx) => {
    need(o, "DRAFT");
    if (!actorCan(actor, "manufacturing.approve")) throw financeError(403, "FORBIDDEN", "Approving production orders needs manufacturing.approve");
    if (!o.lines.length) throw financeError(409, "MO_EMPTY", "Plan at least one size / colour");
    if (o.producer && o.producer.status !== "ACTIVE") throw financeError(409, "SUPPLIER_NOT_ACTIVE", `${o.producer.displayName} isn't active`);
    if (o.bom && o.bom.status !== "APPROVED") throw financeError(409, "BOM_NOT_APPROVED", "The plan's bill of materials is no longer approved — re-plan from the current version");
    const business = o.materials.filter((m) => m.suppliedBy === "BUSINESS");
    const states = business.length ? await tx.inventoryCostState.findMany({ where: { variantId: { in: business.map((m) => m.materialVariantId) } }, select: { variantId: true, avgUnitCost: true } }) : [];
    for (const m of business) {
      const avg = states.find((s) => s.variantId === m.materialVariantId)?.avgUnitCost ?? null;
      if (avg !== null) await tx.productionMaterialLine.update({ where: { id: m.id }, data: { plannedUnitCost: avg } });
    }
    return { status: "APPROVED", approvedAt: new Date(), approvedByAdminId: adminOf(actor) };
  }, opts);

export const reopenProductionOrder = (id: string, actor: FinanceActor, opts: { canSeeCost: boolean }) =>
  transition(id, actor, "production_order.reopen", async (o, tx) => {
    need(o, "APPROVED");
    if (o.materials.some((m) => m.issuedQty > 0)) throw financeError(409, "MO_HAS_ISSUES", "Materials were issued — the plan can't reopen");
    // The draft plan is re-costed at the next approval.
    await tx.productionMaterialLine.updateMany({ where: { productionOrderId: o.id, plannedUnitCost: { not: null } }, data: { plannedUnitCost: null } });
    return { status: "DRAFT", approvedAt: null, approvedByAdminId: null };
  }, opts);

export const cancelProductionOrder = (id: string, reason: string, actor: FinanceActor, opts: { canSeeCost: boolean }) =>
  transition(id, actor, "production_order.cancel", (o) => {
    need(o, "DRAFT", "APPROVED");
    if (o.materials.some((m) => m.issuedQty > 0)) throw financeError(409, "MO_HAS_ISSUES", "Materials were issued — return them first; a started order is closed, not cancelled");
    return { status: "CANCELLED", cancelledReason: reason, closedAt: new Date() };
  }, opts, reason);

export async function deleteDraftProductionOrder(id: string, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  return financeTransaction(async (tx) => {
    const o = await lockProductionOrder(tx, business.id, id);
    if (o.status !== "DRAFT") throw financeError(409, "MO_NOT_DRAFT", "Only a draft is deleted — cancel an approved order");
    await tx.productionOrderLine.deleteMany({ where: { productionOrderId: id } });
    await tx.productionMaterialLine.deleteMany({ where: { productionOrderId: id } });
    await tx.productionPlannedCost.deleteMany({ where: { productionOrderId: id } });
    await tx.productionOrder.delete({ where: { id } });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "production_order.delete_draft", entityType: "ProductionOrder", entityId: id, before: productionOrderDto(o, business.baseCurrency, { canSeeCost: true }) });
  });
}

export async function getProductionOrder(id: string, opts: { canSeeCost: boolean }) {
  const { business } = await getFinanceContext();
  return productionOrderDto(await load(prisma, business.id, id), business.baseCurrency, opts);
}

export async function listProductionOrders(q: { status?: ProductionOrderStatus; productId?: string; producerSupplierId?: string; q?: string; page: number; pageSize: number }, opts: { canSeeCost: boolean }) {
  const { business } = await getFinanceContext();
  const num = q.q ? Number(q.q.replace(/^MO-?/i, "")) : NaN;
  const where: Prisma.ProductionOrderWhereInput = {
    businessId: business.id,
    status: q.status,
    productId: q.productId,
    producerSupplierId: q.producerSupplierId,
    ...(q.q ? { OR: [...(Number.isSafeInteger(num) ? [{ number: num }] : []), { product: { name: { contains: q.q, mode: "insensitive" as const } } }, { producer: { displayName: { contains: q.q, mode: "insensitive" as const } } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.productionOrder.count({ where }),
    prisma.productionOrder.findMany({ where, include: MO_INCLUDE, orderBy: { number: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  return { total, page: q.page, pageSize: q.pageSize, productionOrders: rows.map((o) => productionOrderDto(o, business.baseCurrency, opts)) };
}

/** Finished, stock-tracked products that can be produced, with their variants — the production pickers' lookup
 * (manufacturing.read; no prices or costs). */
export async function searchProducibleProducts(q: { q?: string; take: number }) {
  const term = q.q?.trim();
  const rows = await prisma.product.findMany({
    where: {
      kind: "FINISHED", trackInventory: true, deletedAt: null,
      ...(term ? { OR: [{ name: { contains: term, mode: "insensitive" } }, { variants: { some: { sku: { contains: term, mode: "insensitive" } } } }] } : {}),
    },
    select: { id: true, name: true, variants: { select: { id: true, sku: true, size: true, color: true, stock: true }, orderBy: { sortOrder: "asc" } } },
    orderBy: { name: "asc" },
    take: q.take,
  });
  return { products: rows };
}
