import { Router } from "express";
import { requireAdmin, requireRole } from "../../middlewares/require-admin";
import { asyncHandler } from "../../lib/async-handler";
import { prisma } from "../../config/prisma";

export const auditRouter = Router();

// OWNER-only — a STAFF account shouldn't be able to review (or notice gaps in) the record of
// admin actions, including their own.
auditRouter.get(
  "/",
  requireAdmin,
  requireRole("OWNER"),
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 30));

    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { admin: { select: { name: true, email: true } } },
      }),
      prisma.auditLog.count(),
    ]);

    res.json({ items, total, page, pageSize });
  }),
);
