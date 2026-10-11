import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { permissionsForRole } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import type { AdminIdentity } from "../../domain/auth/authorization";
import { countUnreadNotifications, listNotifications, markAllNotificationsRead, markNotificationRead, notificationPermission } from "./notification.service";

// Admin V2 DR-15: read state is per admin, and an admin only sees the notification types their permissions cover.

const RUN = Date.now();
let owner: AdminIdentity;
let staff: AdminIdentity;
const ids: Record<string, string> = {};

beforeAll(async () => {
  const make = async (role: "OWNER" | "STAFF", tag: string): Promise<AdminIdentity> => {
    const a = await prisma.adminUser.create({ data: { name: `DR15 ${tag}`, email: `dr15-${tag}-${RUN}@example.com`, passwordHash: await bcrypt.hash("x", 4), role } });
    return { adminId: a.id, role, permissions: permissionsForRole(role) };
  };
  owner = await make("OWNER", "owner");
  staff = await make("STAFF", "staff");
  for (const type of ["order.created", "order.cancelled_but_paid", "product.low_stock", "system.notice"]) {
    ids[type] = (await prisma.notification.create({ data: { type, title: `DR15 ${type} ${RUN}` } })).id;
  }
});

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { id: { in: Object.values(ids) } } });
  await prisma.adminUser.deleteMany({ where: { id: { in: [owner.adminId, staff.adminId] } } });
  await prisma.$disconnect();
});

const mine = (items: Array<{ id: string; readAt: Date | null }>) => items.filter((n) => Object.values(ids).includes(n.id));

describe("notification read state (DR-15)", () => {
  it("one admin reading a notification leaves it unread for the others", async () => {
    const staffBefore = await countUnreadNotifications(staff);
    await markNotificationRead(owner, ids["order.created"]!);
    expect(await countUnreadNotifications(staff)).toBe(staffBefore);
    const ownerView = mine((await listNotifications(owner)).items);
    const staffView = mine((await listNotifications(staff)).items);
    expect(ownerView.find((n) => n.id === ids["order.created"])!.readAt).not.toBeNull();
    expect(staffView.find((n) => n.id === ids["order.created"])!.readAt).toBeNull();
  });

  it("reading twice is harmless, and mark-all only marks the caller's own", async () => {
    await markNotificationRead(owner, ids["order.created"]!);
    await markAllNotificationsRead(staff);
    expect(await countUnreadNotifications(staff)).toBe(0);
    const ownerView = mine((await listNotifications(owner)).items);
    expect(ownerView.filter((n) => n.readAt === null).length).toBe(3);
  });

  it("scopes types by permission, first match wins (exact before prefix)", async () => {
    expect(notificationPermission("order.cancelled_but_paid")).toBe("payments.read");
    expect(notificationPermission("order.created")).toBe("orders.read");
    expect(notificationPermission("product.low_stock")).toBe("inventory.read");
    expect(notificationPermission("system.notice")).toBeNull();
    const ordersOnly: AdminIdentity = { adminId: staff.adminId, role: "STAFF", permissions: ["orders.read"] };
    const seen = mine((await listNotifications(ordersOnly)).items).map((n) => n.id);
    expect(seen.sort()).toEqual([ids["order.created"]!, ids["system.notice"]!].sort());
    const paymentsOnly: AdminIdentity = { adminId: staff.adminId, role: "STAFF", permissions: ["payments.read"] };
    const seen2 = mine((await listNotifications(paymentsOnly)).items).map((n) => n.id);
    expect(seen2.sort()).toEqual([ids["order.cancelled_but_paid"]!, ids["system.notice"]!].sort());
  });

  it("refuses to mark a notification the admin may not see", async () => {
    const ordersOnly: AdminIdentity = { adminId: staff.adminId, role: "STAFF", permissions: ["orders.read"] };
    await expect(markNotificationRead(ordersOnly, ids["product.low_stock"]!)).rejects.toMatchObject({ statusCode: 404 });
  });
});
