/**
 * Packaging a parcel uses (docs/FINANCE_OWNER_BOOKS.md §6.2). Packaging is bought like any stock (a MATERIAL product
 * through purchasing, at its real cost). Packing rules say what a parcel uses — for every parcel, or for a category,
 * product or variant; per parcel or per unit sold. When a parcel leaves (its courier is booked, or it is marked shipped
 * or delivered) its packaging leaves stock (inventory.service, PACKAGING_USE) and its cost moves to 5300 packaging &
 * fulfilment — so each order's profit carries its packaging. A rule applies to parcels that leave after it was made.
 * The forecast shows how long each material lasts at the last 30 days' pace.
 */
import type { PackingRulePer, PackingRuleScope } from "@prisma/client";
import { addDays, businessDate } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { notifyStockMoved, recordPackagingUse } from "../../modules/inventory/inventory.service";
import { recordFinanceAudit, type FinanceActor } from "./finance-audit";
import { businessToday, getFinanceContext } from "./finance-context";
import { financeTransaction } from "./finance-tx";
import { financeError } from "./finance-values";
import { ensureOwnerBooksSetupInTx } from "./owner-books-setup.service";

export interface PackingRuleInput {
  scope: PackingRuleScope;
  scopeId?: string | null;
  materialVariantId: string;
  quantity: number;
  per?: PackingRulePer;
  isActive?: boolean;
  notes?: string | null;
}

interface Line { variantId: string; productId: string; categoryId: string; quantity: number }
interface Rule { id: string; scope: PackingRuleScope; scopeId: string | null; materialVariantId: string; quantity: number; per: PackingRulePer; createdAt: Date }

/** What one parcel uses under the rules (summed per material). Pure. */
export function packagingFor(lines: Line[], rules: Rule[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rules) {
    const hit = r.scope === "EVERY_PARCEL" ? lines : lines.filter((l) => (r.scope === "CATEGORY" ? l.categoryId : r.scope === "PRODUCT" ? l.productId : l.variantId) === r.scopeId);
    if (!hit.length) continue;
    const qty = r.per === "PARCEL" ? r.quantity : r.quantity * hit.reduce((s, l) => s + l.quantity, 0);
    if (qty > 0) out.set(r.materialVariantId, (out.get(r.materialVariantId) ?? 0) + qty);
  }
  return out;
}

async function validRule(input: PackingRuleInput) {
  const material = await prisma.productVariant.findUnique({ where: { id: input.materialVariantId }, select: { id: true, product: { select: { kind: true, trackInventory: true, name: true } } } });
  if (!material) throw financeError(404, "MATERIAL_NOT_FOUND", "Material not found");
  if (material.product.kind !== "MATERIAL" || !material.product.trackInventory) throw financeError(400, "NOT_A_MATERIAL", `${material.product.name} isn't a stock-tracked material — add packaging under Inventory › Materials`);
  if (input.scope === "EVERY_PARCEL" ? input.scopeId : !input.scopeId) throw financeError(400, "RULE_SCOPE", input.scope === "EVERY_PARCEL" ? "A rule for every parcel names nothing else" : "Choose the category, product or variant");
  if (input.scope === "CATEGORY" && !(await prisma.category.count({ where: { id: input.scopeId! } }))) throw financeError(404, "CATEGORY_NOT_FOUND", "Category not found");
  if (input.scope === "PRODUCT" && !(await prisma.product.count({ where: { id: input.scopeId! } }))) throw financeError(404, "PRODUCT_NOT_FOUND", "Product not found");
  if (input.scope === "VARIANT" && !(await prisma.productVariant.count({ where: { id: input.scopeId! } }))) throw financeError(404, "VARIANT_NOT_FOUND", "Variant not found");
}

type Db = Pick<typeof prisma, "billOfMaterialsLine" | "packingRule" | "product" | "productVariant">;

/** The products (with the size, when the rule names one) a rule reaches — null for every parcel. */
async function productsReached(db: Db, scope: PackingRuleScope, scopeId: string | null): Promise<{ productIds: string[]; variantId: string | null } | null> {
  if (scope === "EVERY_PARCEL") return null;
  if (scope === "PRODUCT") return { productIds: [scopeId!], variantId: null };
  if (scope === "VARIANT") {
    const v = await db.productVariant.findUnique({ where: { id: scopeId! }, select: { productId: true } });
    return { productIds: v ? [v.productId] : [], variantId: scopeId };
  }
  const ps = await db.product.findMany({ where: { categoryId: scopeId!, deletedAt: null }, select: { id: true } });
  return { productIds: ps.map((p) => p.id), variantId: null };
}

/**
 * One consumption point per material (docs/MATERIALS_PURCHASING.md §5): a material in a product's approved recipe leaves
 * stock when that product is filled, so a packing rule taking it again for the same product would count it twice. Refused,
 * naming the recipe.
 */
export async function assertNoRecipeOverlap(db: Db, rule: { scope: PackingRuleScope; scopeId: string | null; materialVariantId: string }) {
  const reached = await productsReached(db, rule.scope, rule.scopeId);
  const lines = await db.billOfMaterialsLine.findMany({
    where: {
      materialVariantId: rule.materialVariantId,
      bom: { status: "APPROVED", ...(reached ? { productId: { in: reached.productIds } } : {}) },
      ...(reached?.variantId ? { OR: [{ finishedVariantId: null }, { finishedVariantId: reached.variantId }] } : {}),
    },
    select: { bom: { select: { version: true, product: { select: { name: true } } } }, materialVariant: { select: { product: { select: { name: true } } } } },
    take: 5,
  });
  if (!lines.length) return;
  const recipes = [...new Set(lines.map((l) => `${l.bom.product.name} v${l.bom.version}`))].join(", ");
  throw financeError(409, "PACKING_RULE_IN_RECIPE", `${lines[0]!.materialVariant.product.name} is already in the approved recipe of ${recipes} — it leaves stock when that is filled; a packing rule would take it a second time`);
}

/** The other way round, when a recipe is approved: no active packing rule may take one of its materials for its product. */
export async function assertNoPackingOverlap(db: Db, product: { id: string; categoryId: string }, lines: Array<{ materialVariantId: string; finishedVariantId: string | null }>) {
  const variants = await db.productVariant.findMany({ where: { productId: product.id }, select: { id: true } });
  const rules = await db.packingRule.findMany({
    where: {
      isActive: true,
      materialVariantId: { in: lines.map((l) => l.materialVariantId) },
      OR: [{ scope: "EVERY_PARCEL" }, { scope: "CATEGORY", scopeId: product.categoryId }, { scope: "PRODUCT", scopeId: product.id }, { scope: "VARIANT", scopeId: { in: variants.map((v) => v.id) } }],
    },
    select: { scope: true, scopeId: true, materialVariantId: true, materialVariant: { select: { product: { select: { name: true } } } } },
  });
  // a rule for one size only clashes with a line for every size or for that size
  const clash = rules.find((r) => lines.some((l) => l.materialVariantId === r.materialVariantId && (r.scope !== "VARIANT" || l.finishedVariantId === null || l.finishedVariantId === r.scopeId)));
  if (clash) throw financeError(409, "RECIPE_MATERIAL_IN_PACKING_RULE", `${clash.materialVariant.product.name} is already taken by an active packing rule for this product — turn that rule off, or leave it out of the recipe, so it isn't counted twice`);
}

export async function createPackingRule(input: PackingRuleInput, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  await validRule(input);
  if (input.isActive ?? true) await assertNoRecipeOverlap(prisma, { scope: input.scope, scopeId: input.scopeId ?? null, materialVariantId: input.materialVariantId });
  return financeTransaction(async (tx) => {
    await ensureOwnerBooksSetupInTx(tx, business, actor);
    const rule = await tx.packingRule.create({ data: { scope: input.scope, scopeId: input.scopeId ?? null, materialVariantId: input.materialVariantId, quantity: input.quantity, per: input.per ?? "PARCEL", isActive: input.isActive ?? true, notes: input.notes ?? null } });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "packing_rule.create", entityType: "PackingRule", entityId: rule.id, after: rule });
    return rule;
  });
}

/** Rules are switched off rather than changed, so a parcel's past packaging always matches the rule it left under. */
export async function setPackingRuleActive(id: string, isActive: boolean, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  return financeTransaction(async (tx) => {
    const before = await tx.packingRule.findUnique({ where: { id } });
    if (!before) throw financeError(404, "RULE_NOT_FOUND", "Packing rule not found");
    if (isActive && !before.isActive) await assertNoRecipeOverlap(tx as unknown as Db, before);
    const after = await tx.packingRule.update({ where: { id }, data: { isActive } });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "packing_rule.update", entityType: "PackingRule", entityId: id, before, after });
    return after;
  });
}

/**
 * The packaging a product's parcels take (docs/MATERIALS_PURCHASING.md §5): every packing rule that reaches it — its own,
 * one of its sizes, its category, every parcel — active and switched off, newest first. For the product's kit panel.
 */
export async function packagingForProduct(productId: string) {
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true, categoryId: true, variants: { select: { id: true, size: true, color: true } } } });
  if (!product) throw financeError(404, "PRODUCT_NOT_FOUND", "Product not found");
  const sizes = new Map(product.variants.map((v) => [v.id, [v.size, v.color].filter(Boolean).join(" ")]));
  const rules = await prisma.packingRule.findMany({
    where: { OR: [{ scope: "EVERY_PARCEL" }, { scope: "CATEGORY", scopeId: product.categoryId }, { scope: "PRODUCT", scopeId: product.id }, { scope: "VARIANT", scopeId: { in: [...sizes.keys()] } }] },
    select: { id: true, scope: true, scopeId: true, quantity: true, per: true, isActive: true, notes: true, createdAt: true, materialVariant: { select: { id: true, sku: true, product: { select: { name: true, stockUnit: true } } } } },
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
  });
  return {
    rules: rules.map((r) => ({
      id: r.id, scope: r.scope, isActive: r.isActive, quantity: r.quantity, per: r.per, notes: r.notes,
      appliesTo: r.scope === "EVERY_PARCEL" ? "Every parcel" : r.scope === "CATEGORY" ? "Its category" : r.scope === "PRODUCT" ? "This product" : `Size ${sizes.get(r.scopeId!) ?? ""}`.trim(),
      material: { variantId: r.materialVariant.id, sku: r.materialVariant.sku, name: r.materialVariant.product.name, unit: r.materialVariant.product.stockUnit ?? "pcs" },
    })),
  };
}

const SHIPPED = ["SHIPPED", "DELIVERED", "PARTIALLY_DELIVERED", "RETURNED"] as const;

/** Takes the packaging of every parcel that left (within `days`, default 60) and hasn't had it taken yet. Idempotent. */
export async function syncPackaging(opts: { days?: number } = {}) {
  const rules = await prisma.packingRule.findMany({ where: { isActive: true } });
  if (!rules.length) return { parcels: 0, movements: 0, short: [] as Array<{ orderNumber: string; variantId: string; quantity: number }> };
  const { business } = await getFinanceContext();
  await financeTransaction((tx) => ensureOwnerBooksSetupInTx(tx, business));
  const since = new Date(Date.now() - (opts.days ?? 60) * 86_400_000);
  const earliestRule = rules.reduce((m, r) => (r.createdAt < m ? r.createdAt : m), rules[0]!.createdAt);
  const orders = await prisma.order.findMany({
    where: {
      deletedAt: null, updatedAt: { gte: since },
      OR: [{ courierBookedAt: { gte: earliestRule } }, { status: { in: [...SHIPPED] }, statusHistory: { some: { status: "SHIPPED", createdAt: { gte: earliestRule } } } }],
    },
    select: {
      id: true, orderNumber: true, courierBookedAt: true,
      statusHistory: { where: { status: "SHIPPED" }, select: { createdAt: true }, orderBy: { createdAt: "asc" }, take: 1 },
      items: { select: { variantId: true, quantity: true } },
    },
  });
  const variantIds = [...new Set(orders.flatMap((o) => o.items.map((i) => i.variantId)))];
  const variants = new Map((await prisma.productVariant.findMany({ where: { id: { in: variantIds } }, select: { id: true, productId: true, product: { select: { categoryId: true } } } })).map((v) => [v.id, v]));
  let movements = 0;
  const moved = new Set<string>();
  const short: Array<{ orderNumber: string; variantId: string; quantity: number }> = [];
  for (const o of orders) {
    const left = o.courierBookedAt ?? o.statusHistory[0]?.createdAt ?? null;
    if (!left) continue;
    const applicable = rules.filter((r) => r.createdAt <= left);
    const lines = o.items.flatMap((i) => {
      const v = variants.get(i.variantId);
      return v ? [{ variantId: i.variantId, productId: v.productId, categoryId: v.product.categoryId, quantity: i.quantity }] : [];
    });
    const needs = packagingFor(lines, applicable);
    if (!needs.size) continue;
    const r = await financeTransaction((tx) => recordPackagingUse(tx, o.id, [...needs].map(([variantId, quantity]) => ({ variantId, quantity })), { note: `Packaging for ${o.orderNumber}` }));
    movements += r.written.length;
    for (const v of r.written) moved.add(v.variantId);
    for (const s of r.short) short.push({ orderNumber: o.orderNumber, ...s });
  }
  notifyStockMoved([...moved]);
  return { parcels: orders.length, movements, short };
}

/** Rules, materials with their stock and how long they last at the last 30 days' pace. */
export async function packagingOverview() {
  const { business } = await getFinanceContext();
  const today = businessToday(business);
  const rules = await prisma.packingRule.findMany({ include: { materialVariant: { select: { id: true, sku: true, size: true, color: true, stock: true, product: { select: { name: true, stockUnit: true } } } } }, orderBy: [{ isActive: "desc" }, { createdAt: "desc" }] });
  const materials = await prisma.productVariant.findMany({
    where: { product: { kind: "MATERIAL" } },
    select: { id: true, sku: true, size: true, color: true, stock: true, costPrice: true, product: { select: { name: true, stockUnit: true } } },
    orderBy: [{ product: { name: "asc" } }, { sku: "asc" }],
  });
  const since = new Date(Date.now() - 30 * 86_400_000);
  const used = await prisma.stockMovement.groupBy({ by: ["variantId"], where: { variantId: { in: materials.map((m) => m.id) }, change: { lt: 0 }, reason: { in: ["PACKAGING_USE", "PRODUCTION_ISSUE"] }, createdAt: { gte: since } }, _sum: { change: true } });
  const usedBy = new Map(used.map((u) => [u.variantId, -(u._sum.change ?? 0)]));
  const scopeNames = await names(rules.map((r) => ({ scope: r.scope, scopeId: r.scopeId })));
  return {
    asOf: today,
    rules: rules.map((r) => ({ id: r.id, scope: r.scope, scopeId: r.scopeId, scopeName: r.scopeId ? scopeNames.get(r.scopeId) ?? null : null, quantity: r.quantity, per: r.per, isActive: r.isActive, notes: r.notes, createdOn: businessDate(r.createdAt, business.timezone), material: r.materialVariant })),
    materials: materials.map((m) => {
      const last30 = usedBy.get(m.id) ?? 0;
      const perDay = last30 / 30;
      const daysLeft = perDay > 0 ? Math.floor(m.stock / perDay) : null;
      return { id: m.id, name: m.product.name, sku: m.sku, size: m.size, color: m.color, unit: m.product.stockUnit, stock: m.stock, usedLast30Days: last30, perDay: Math.round(perDay * 10) / 10, daysLeft, runsOutOn: daysLeft === null ? null : addDays(today, daysLeft), low: daysLeft !== null && daysLeft <= 14 };
    }),
  };
}

async function names(scopes: Array<{ scope: PackingRuleScope; scopeId: string | null }>) {
  const ids = (s: PackingRuleScope) => scopes.filter((x) => x.scope === s && x.scopeId).map((x) => x.scopeId!);
  const [cats, prods, vars] = await Promise.all([
    prisma.category.findMany({ where: { id: { in: ids("CATEGORY") } }, select: { id: true, name: true } }),
    prisma.product.findMany({ where: { id: { in: ids("PRODUCT") } }, select: { id: true, name: true } }),
    prisma.productVariant.findMany({ where: { id: { in: ids("VARIANT") } }, select: { id: true, sku: true, product: { select: { name: true } } } }),
  ]);
  return new Map<string, string>([...cats.map((c) => [c.id, c.name] as const), ...prods.map((p) => [p.id, p.name] as const), ...vars.map((v) => [v.id, `${v.product.name} (${v.sku})`] as const)]);
}
