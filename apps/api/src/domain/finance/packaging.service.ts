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
import { recordPackagingUse } from "../../modules/inventory/inventory.service";
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

export async function createPackingRule(input: PackingRuleInput, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  await validRule(input);
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
    const after = await tx.packingRule.update({ where: { id }, data: { isActive } });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "packing_rule.update", entityType: "PackingRule", entityId: id, before, after });
    return after;
  });
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
    for (const s of r.short) short.push({ orderNumber: o.orderNumber, ...s });
  }
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
