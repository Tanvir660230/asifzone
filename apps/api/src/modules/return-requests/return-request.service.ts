import type { CreateReturnRequestInput, ReviewReturnRequestInput, ReturnRequestListQuery } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { updateOrderStatus } from "../orders/order.service";

const include = {
  order: { select: { id: true, orderNumber: true, status: true, total: true, createdAt: true } },
};

export async function createReturnRequest(customerId: string, input: CreateReturnRequestInput) {
  const order = await prisma.order.findUnique({ where: { id: input.orderId } });
  if (!order || order.customerId !== customerId) throw AppError.notFound("Order not found");
  if (order.status !== "DELIVERED") {
    throw AppError.badRequest("Only delivered orders are eligible for a return request");
  }

  const existingPending = await prisma.returnRequest.findFirst({
    where: { orderId: input.orderId, status: "PENDING" },
  });
  if (existingPending) throw AppError.conflict("A return request for this order is already pending review");

  return prisma.returnRequest.create({
    data: { orderId: input.orderId, customerId, reason: input.reason, note: input.note ?? null },
    include,
  });
}

export async function listMyReturnRequests(customerId: string, query: ReturnRequestListQuery) {
  const where = { customerId, ...(query.status ? { status: query.status } : {}) };
  const [items, total] = await Promise.all([
    prisma.returnRequest.findMany({
      where,
      include,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.returnRequest.count({ where }),
  ]);
  return { items, total, page: query.page, pageSize: query.pageSize };
}

// --- admin ---

export async function listReturnRequestsAdmin(query: ReturnRequestListQuery) {
  const where = query.status ? { status: query.status } : {};
  const [items, total] = await Promise.all([
    prisma.returnRequest.findMany({
      where,
      include: { ...include, customer: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.returnRequest.count({ where }),
  ]);
  return { items, total, page: query.page, pageSize: query.pageSize };
}

async function getReturnRequestById(id: string) {
  const request = await prisma.returnRequest.findUnique({ where: { id } });
  if (!request) throw AppError.notFound("Return request not found");
  return request;
}

/** Approving reuses the existing order-status machinery (transitions the order to RETURNED, with
 * its own status-history entry) rather than tracking a parallel status — there's no refund-API
 * integration, so "refund status" is just the order's own status/paymentStatus from here on. */
export async function reviewReturnRequest(id: string, input: ReviewReturnRequestInput, adminId: string) {
  const request = await getReturnRequestById(id);
  if (request.status !== "PENDING") throw AppError.conflict("This return request has already been reviewed");

  await prisma.returnRequest.update({
    where: { id },
    data: { status: input.status, adminNote: input.adminNote ?? null, reviewedAt: new Date(), reviewedByAdminId: adminId },
  });

  if (input.status === "APPROVED") {
    await updateOrderStatus(
      request.orderId,
      { status: "RETURNED", note: `Return approved: ${request.reason}` },
      adminId,
    );
  }

  return prisma.returnRequest.findUnique({ where: { id }, include });
}
