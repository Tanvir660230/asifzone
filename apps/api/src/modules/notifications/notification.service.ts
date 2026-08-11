import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";

export async function listNotifications() {
  const [items, unreadCount] = await Promise.all([
    prisma.notification.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.notification.count({ where: { readAt: null } }),
  ]);
  return { items, unreadCount };
}

export async function markNotificationRead(id: string) {
  const notification = await prisma.notification.findUnique({ where: { id } });
  if (!notification) throw AppError.notFound("Notification not found");
  await prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
}

export async function markAllNotificationsRead() {
  await prisma.notification.updateMany({ where: { readAt: null }, data: { readAt: new Date() } });
}
