import { Prisma } from "@prisma/client";
import type { CreateReturnRequestInput, ReviewReturnRequestInput, ReturnRequestListQuery } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { paginate } from "../../lib/paginate";
import { updateOrderStatus, restockReturnedOrderItems } from "../orders/order.service";

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

  try {
    return await prisma.returnRequest.create({
      data: { orderId: input.orderId, customerId, reason: input.reason, note: input.note ?? null },
      include,
    });
  } catch (err) {
    // Backstopped by a partial unique index (one PENDING request per order — see the migration
    // and the comment on ReturnRequest.status in schema.prisma) for the race the check above can't
    // fully close on its own.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw AppError.conflict("A return request for this order is already pending review");
    }
    throw err;
  }
}

export async function listMyReturnRequests(customerId: string, query: ReturnRequestListQuery) {
  const where = { customerId, ...(query.status ? { status: query.status } : {}) };
  return paginate(
    query,
    (p) => prisma.returnRequest.findMany({ where, include, orderBy: { createdAt: "desc" }, ...p }),
    () => prisma.returnRequest.count({ where }),
  );
}

// --- admin ---

export async function listReturnRequestsAdmin(query: ReturnRequestListQuery) {
  const where = query.status ? { status: query.status } : {};
  return paginate(
    query,
    (p) =>
      prisma.returnRequest.findMany({
        where,
        include: { ...include, customer: { select: { name: true, email: true } } },
        orderBy: { createdAt: "desc" },
        ...p,
      }),
    () => prisma.returnRequest.count({ where }),
  );
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

  // Conditional on status still being PENDING (not a plain update) — closes the race where two
  // admins review the same request at once: only the update that actually flips PENDING wins,
  // the loser's count is 0 and gets a clean conflict instead of both silently "succeeding" and
  // potentially double-triggering the order-status transition below.
  const result = await prisma.returnRequest.updateMany({
    where: { id, status: "PENDING" },
    data: { status: input.status, adminNote: input.adminNote ?? null, reviewedAt: new Date(), reviewedByAdminId: adminId },
  });
  if (result.count === 0) throw AppError.conflict("This return request has already been reviewed");

  if (input.status === "APPROVED") {
    const order = await updateOrderStatus(
      request.orderId,
      { status: "RETURNED", note: `Return approved: ${request.reason}` },
      adminId,
    );
    await restockReturnedOrderItems(order.id, order.items, adminId);
  }

  return prisma.returnRequest.findUnique({ where: { id }, include });
}
