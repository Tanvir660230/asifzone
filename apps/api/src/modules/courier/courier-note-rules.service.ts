import type { courierNoteRuleSchema } from "@clothing-brand/shared";
import type { z } from "zod";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { recordAudit } from "../../lib/audit";

/** Catalog → Courier notes: the store's own instructions for the courier. Products and categories hold rule ids in
 * `courierNoteRuleIds` (no FK), so deleting a rule also strips its id from them. See courier-note.ts for how they apply. */

/** A rule as the route's validation leaves it (defaults filled, minDiscountPercent cleared on PRODUCT rules). */
type CourierNoteRuleData = z.output<typeof courierNoteRuleSchema>;

export async function listCourierNoteRules() {
  const [rules, productCounts, categoryCounts] = await Promise.all([
    prisma.courierNoteRule.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    prisma.$queryRaw<Array<{ id: string; count: bigint }>>`
      SELECT rule_id AS id, COUNT(*) AS count FROM "Product", unnest("courierNoteRuleIds") AS rule_id
      WHERE "deletedAt" IS NULL GROUP BY rule_id`,
    prisma.$queryRaw<Array<{ id: string; count: bigint }>>`
      SELECT rule_id AS id, COUNT(*) AS count FROM "Category", unnest("courierNoteRuleIds") AS rule_id
      WHERE "deletedAt" IS NULL GROUP BY rule_id`,
  ]);
  const products = new Map(productCounts.map((r) => [r.id, Number(r.count)]));
  const categories = new Map(categoryCounts.map((r) => [r.id, Number(r.count)]));
  return {
    rules: rules.map((rule) => ({ ...rule, productCount: products.get(rule.id) ?? 0, categoryCount: categories.get(rule.id) ?? 0 })),
  };
}

export async function createCourierNoteRule(data: CourierNoteRuleData, adminId: string, ip?: string) {
  const rule = await prisma.courierNoteRule.create({ data });
  recordAudit({ adminId, action: "courier_note_rule.created", entityType: "courier_note_rules", entityId: rule.id, ipAddress: ip ?? null, metadata: { name: rule.name, text: rule.text } });
  return rule;
}

export async function updateCourierNoteRule(id: string, data: CourierNoteRuleData, adminId: string, ip?: string) {
  const before = await prisma.courierNoteRule.findUnique({ where: { id } });
  if (!before) throw AppError.notFound("Courier note not found");
  const rule = await prisma.courierNoteRule.update({ where: { id }, data });
  recordAudit({
    adminId,
    action: "courier_note_rule.updated",
    entityType: "courier_note_rules",
    entityId: id,
    ipAddress: ip ?? null,
    metadata: {
      from: { name: before.name, text: before.text, trigger: before.trigger, minDiscountPercent: before.minDiscountPercent, isActive: before.isActive },
      to: { name: rule.name, text: rule.text, trigger: rule.trigger, minDiscountPercent: rule.minDiscountPercent, isActive: rule.isActive },
    },
  });
  return rule;
}

export async function deleteCourierNoteRule(id: string, adminId: string, ip?: string) {
  const before = await prisma.courierNoteRule.findUnique({ where: { id } });
  if (!before) throw AppError.notFound("Courier note not found");
  await prisma.$transaction([
    prisma.$executeRaw`UPDATE "Product" SET "courierNoteRuleIds" = array_remove("courierNoteRuleIds", ${id}) WHERE ${id} = ANY("courierNoteRuleIds")`,
    prisma.$executeRaw`UPDATE "Category" SET "courierNoteRuleIds" = array_remove("courierNoteRuleIds", ${id}) WHERE ${id} = ANY("courierNoteRuleIds")`,
    prisma.courierNoteRule.delete({ where: { id } }),
  ]);
  recordAudit({ adminId, action: "courier_note_rule.deleted", entityType: "courier_note_rules", entityId: id, ipAddress: ip ?? null, metadata: { name: before.name, text: before.text } });
}

/** Keeps only ids of rules that exist, deduplicated — what a product/category write stores. `undefined` stays undefined. */
export async function sanitizeCourierNoteRuleIds(ids: string[] | undefined): Promise<string[] | undefined> {
  if (ids === undefined) return undefined;
  if (!ids.length) return [];
  const existing = await prisma.courierNoteRule.findMany({ where: { id: { in: ids } }, select: { id: true } });
  const known = new Set(existing.map((r) => r.id));
  return [...new Set(ids)].filter((id) => known.has(id));
}
