import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { auditLogListQuerySchema, type AuditLogListQuery } from "@clothing-brand/shared";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import { validate } from "../../middlewares/validate";
import { asyncHandler } from "../../lib/async-handler";
import { prisma } from "../../config/prisma";
import { resolveStoreRange } from "../../domain/metrics/store-time";

export const auditRouter = Router();

async function auditWhere(q: AuditLogListQuery): Promise<Prisma.AuditLogWhereInput> {
  const and: Prisma.AuditLogWhereInput[] = [];
  if (q.adminId) and.push({ adminId: q.adminId === "system" ? null : q.adminId });
  if (q.entityType) and.push({ entityType: q.entityType });
  if (q.action) and.push(q.action.includes(".") ? { action: q.action } : { action: { contains: `.${q.action}` } });
  if (q.entityId) and.push({ entityId: { startsWith: q.entityId } });
  if (q.requestId) and.push({ metadata: { path: ["requestId"], equals: q.requestId } });
  if (q.from || q.to) {
    // Business dates in the store timezone, inclusive — the same range resolution as every report.
    const range = await resolveStoreRange({ from: q.from ?? "1970-01-01", to: q.to ?? q.from! });
    and.push({ createdAt: { gte: range.startUtc, lt: range.endUtc } });
  }
  return and.length ? { AND: and } : {};
}

// OWNER-only — a STAFF account shouldn't be able to review (or notice gaps in) the record of
// admin actions, including their own.
auditRouter.get(
  "/",
  requireAdmin,
  requirePermission("audit.read"),
  validate(auditLogListQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as AuditLogListQuery;
    const where = await auditWhere(q);
    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { admin: { select: { name: true, email: true } } },
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({ items, total, page: q.page, pageSize: q.pageSize });
  }),
);

/** The values the audit log can be filtered by: areas that have entries, and every admin (incl. deactivated). */
auditRouter.get(
  "/facets",
  requireAdmin,
  requirePermission("audit.read"),
  asyncHandler(async (_req, res) => {
    const [areas, admins] = await Promise.all([
      prisma.auditLog.groupBy({ by: ["entityType"], _count: { _all: true }, orderBy: { entityType: "asc" } }),
      prisma.adminUser.findMany({ select: { id: true, name: true, isActive: true }, orderBy: { name: "asc" } }),
    ]);
    res.json({ entityTypes: areas.map((a) => a.entityType), admins });
  }),
);
