/**
 * Problems a customer reported with a delivered item (torn, stain, broken zip…). Staff record them on the call; the
 * parcel scanner shows them when the item comes back, so the unit is checked and kept off the shelf when damaged.
 */
import { ORDER_ISSUE_LABEL, type CreateOrderIssueInput, type OrderIssueKindValue } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";

export interface OrderIssueView {
  id: string;
  orderId: string;
  orderItemId: string | null;
  itemLabel: string | null;
  kind: OrderIssueKindValue;
  kindLabel: string;
  channel: string;
  note: string;
  reportedByName: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolution: string | null;
}

export async function createOrderIssue(orderId: string, input: CreateOrderIssueInput, admin: { adminId: string }): Promise<OrderIssueView> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, deletedAt: true, items: { select: { id: true } } } });
  if (!order || order.deletedAt) throw AppError.notFound("Order not found");
  if (input.orderItemId && !order.items.some((i) => i.id === input.orderItemId)) throw AppError.badRequest("That item isn't on this order");
  const who = await prisma.adminUser.findUnique({ where: { id: admin.adminId }, select: { name: true } });
  const row = await prisma.orderIssue.create({
    data: { orderId, orderItemId: input.orderItemId ?? null, kind: input.kind, channel: input.channel, note: input.note, reportedByAdminId: admin.adminId, reportedByName: who?.name ?? null },
  });
  return (await listOrderIssues([orderId])).get(orderId)!.find((i) => i.id === row.id)!;
}

/** Open and closed issues per order, oldest first. */
export async function listOrderIssues(orderIds: string[]): Promise<Map<string, OrderIssueView[]>> {
  const out = new Map<string, OrderIssueView[]>();
  if (orderIds.length === 0) return out;
  const rows = await prisma.orderIssue.findMany({
    where: { orderId: { in: orderIds } },
    orderBy: { createdAt: "asc" },
    include: { order: { select: { items: { select: { id: true, productNameSnapshot: true, sizeSnapshot: true, colorSnapshot: true } } } } },
  });
  for (const r of rows) {
    const it = r.order.items.find((i) => i.id === r.orderItemId);
    const view: OrderIssueView = {
      id: r.id,
      orderId: r.orderId,
      orderItemId: r.orderItemId,
      itemLabel: it ? [it.productNameSnapshot, [it.sizeSnapshot, it.colorSnapshot].filter(Boolean).join(" / ")].filter(Boolean).join(" — ") : null,
      kind: r.kind,
      kindLabel: ORDER_ISSUE_LABEL[r.kind],
      channel: r.channel,
      note: r.note,
      reportedByName: r.reportedByName,
      createdAt: r.createdAt.toISOString(),
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      resolution: r.resolution,
    };
    out.set(r.orderId, [...(out.get(r.orderId) ?? []), view]);
  }
  return out;
}

/** Closes an issue by hand (customer withdrew it, resolved another way). */
export async function resolveOrderIssue(orderId: string, issueId: string, resolution: string) {
  const r = await prisma.orderIssue.updateMany({ where: { id: issueId, orderId, resolvedAt: null }, data: { resolvedAt: new Date(), resolution } });
  if (r.count === 0) throw AppError.notFound("Open problem not found on this order");
}
