import type { Prisma } from "@prisma/client";
import type { CreateFeedbackInput, FeedbackListQuery } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { paginate } from "../../lib/paginate";

export async function createFeedback(input: CreateFeedbackInput) {
  return prisma.feedback.create({
    data: {
      name: input.name,
      email: input.email ?? null,
      phone: input.phone ?? null,
      subject: input.subject,
      message: input.message,
    },
  });
}

export async function listFeedback(query: FeedbackListQuery) {
  const where: Prisma.FeedbackWhereInput = {
    ...(query.status === "unread" ? { readAt: null } : {}),
    ...(query.status === "read" ? { readAt: { not: null } } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: "insensitive" } },
            { email: { contains: query.search, mode: "insensitive" } },
            { subject: { contains: query.search, mode: "insensitive" } },
            { message: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  return paginate(
    query,
    (p) => prisma.feedback.findMany({ where, orderBy: { createdAt: "desc" }, ...p }),
    () => prisma.feedback.count({ where }),
  );
}

export async function markFeedbackRead(id: string) {
  const feedback = await prisma.feedback.findUnique({ where: { id } });
  if (!feedback) throw AppError.notFound("Feedback not found");
  return prisma.feedback.update({ where: { id }, data: { readAt: new Date() } });
}

export async function deleteFeedback(id: string) {
  const feedback = await prisma.feedback.findUnique({ where: { id } });
  if (!feedback) throw AppError.notFound("Feedback not found");
  await prisma.feedback.delete({ where: { id } });
}
