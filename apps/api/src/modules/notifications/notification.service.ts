import type { Prisma } from "@prisma/client";
import type { Permission } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { can, type AdminIdentity } from "../../domain/auth/authorization";

const LIST_SIZE = 30;

/**
 * Admin V2 DR-15: which permission a notification type needs to be seen — the permission of the page its link opens.
 * First match wins: exact types before prefixes. A type no rule names is visible to every admin.
 */
const TYPE_PERMISSIONS: ReadonlyArray<{ type?: string; prefix?: string; permission: Permission }> = [
  { type: "order.cancelled_but_paid", permission: "payments.read" },
  { type: "order.overpaid", permission: "payments.read" },
  { prefix: "order.", permission: "orders.read" },
  { prefix: "product.", permission: "inventory.read" },
];

export function notificationPermission(type: string): Permission | null {
  for (const rule of TYPE_PERMISSIONS) if (rule.type ? type === rule.type : type.startsWith(rule.prefix!)) return rule.permission;
  return null;
}

/** The notifications this admin may see, as a where clause (the same first-match rules as notificationPermission). */
export function notificationScope(identity: AdminIdentity): Prisma.NotificationWhereInput {
  const exact = TYPE_PERMISSIONS.filter((r) => r.type).map((r) => r.type!);
  const prefixes = TYPE_PERMISSIONS.filter((r) => r.prefix).map((r) => r.prefix!);
  const allowed: Prisma.NotificationWhereInput[] = [];
  const allowedExact = TYPE_PERMISSIONS.filter((r) => r.type && can(identity, r.permission)).map((r) => r.type!);
  if (allowedExact.length) allowed.push({ type: { in: allowedExact } });
  for (const rule of TYPE_PERMISSIONS) {
    if (rule.prefix && can(identity, rule.permission)) allowed.push({ type: { startsWith: rule.prefix }, NOT: { type: { in: exact } } });
  }
  allowed.push({ AND: [...prefixes.map((p) => ({ NOT: { type: { startsWith: p } } })), { NOT: { type: { in: exact } } }] });
  return { OR: allowed };
}

/** Visible to this admin and not yet read by them. */
function unreadWhere(identity: AdminIdentity): Prisma.NotificationWhereInput {
  return { AND: [notificationScope(identity), { reads: { none: { adminId: identity.adminId } } }] };
}

export function countUnreadNotifications(identity: AdminIdentity) {
  return prisma.notification.count({ where: unreadWhere(identity) });
}

export async function listNotifications(identity: AdminIdentity) {
  const [rows, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: notificationScope(identity),
      orderBy: { createdAt: "desc" },
      take: LIST_SIZE,
      include: { reads: { where: { adminId: identity.adminId }, select: { readAt: true } } },
    }),
    countUnreadNotifications(identity),
  ]);
  // `readAt` is this admin's own read time — the shape the bell already renders.
  const items = rows.map(({ reads, readAt: _legacy, ...n }) => ({ ...n, readAt: reads[0]?.readAt ?? null }));
  return { items, unreadCount };
}

export async function markNotificationRead(identity: AdminIdentity, id: string) {
  const notification = await prisma.notification.findFirst({ where: { AND: [{ id }, notificationScope(identity)] }, select: { id: true } });
  if (!notification) throw AppError.notFound("Notification not found");
  await prisma.notificationRead.upsert({
    where: { notificationId_adminId: { notificationId: id, adminId: identity.adminId } },
    create: { notificationId: id, adminId: identity.adminId },
    update: {},
  });
}

export async function markAllNotificationsRead(identity: AdminIdentity) {
  const unread = await prisma.notification.findMany({ where: unreadWhere(identity), select: { id: true } });
  if (unread.length) {
    await prisma.notificationRead.createMany({ data: unread.map((n) => ({ notificationId: n.id, adminId: identity.adminId })), skipDuplicates: true });
  }
}
