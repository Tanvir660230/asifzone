import { Router } from "express";
import { requireAdmin } from "../../middlewares/require-admin";
import { asyncHandler } from "../../lib/async-handler";
import { prisma } from "../../config/prisma";

export const notificationRouter = Router();

notificationRouter.get(
  "/",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const [items, unreadCount] = await Promise.all([
      prisma.notification.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
      prisma.notification.count({ where: { readAt: null } }),
    ]);
    res.json({ items, unreadCount });
  }),
);

notificationRouter.post(
  "/:id/read",
  requireAdmin,
  asyncHandler(async (req, res) => {
    await prisma.notification.update({ where: { id: req.params.id }, data: { readAt: new Date() } });
    res.status(204).send();
  }),
);

notificationRouter.post(
  "/read-all",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    await prisma.notification.updateMany({ where: { readAt: null }, data: { readAt: new Date() } });
    res.status(204).send();
  }),
);
