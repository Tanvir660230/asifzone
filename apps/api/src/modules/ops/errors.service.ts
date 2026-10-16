import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";

/** Site health: reads of the grouped production errors (written by lib/observability/error-store-reporter.ts) for
 * Admin › System health, and the owner's "Mark fixed". */

const ATTENTION_WINDOW_MS = 24 * 60 * 60 * 1000;

const listSelect = { id: true, source: true, title: true, lastPath: true, count: true, firstSeenAt: true, lastSeenAt: true, resolvedAt: true } as const;

export function listErrorGroups(status: "open" | "resolved", limit: number) {
  return prisma.errorGroup.findMany({
    where: { resolvedAt: status === "open" ? null : { not: null } },
    orderBy: status === "open" ? { lastSeenAt: "desc" } : { resolvedAt: "desc" },
    take: limit,
    select: listSelect,
  });
}

export async function getErrorGroup(id: string) {
  const row = await prisma.errorGroup.findUnique({ where: { id }, select: { ...listSelect, errorClass: true, sampleStack: true, lastCorrelationId: true } });
  if (!row) throw AppError.notFound("Error not found");
  return row;
}

/** Hides the group until it happens again — the reporter clears resolvedAt on the next occurrence. */
export async function resolveErrorGroup(id: string): Promise<void> {
  const { count } = await prisma.errorGroup.updateMany({ where: { id }, data: { resolvedAt: new Date() } });
  if (count === 0) throw AppError.notFound("Error not found");
}

/** Open errors that happened in the last 24 hours — the number on Home's "Needs your attention". */
export function countOpenErrors(now: Date = new Date()) {
  return prisma.errorGroup.count({ where: { resolvedAt: null, lastSeenAt: { gte: new Date(now.getTime() - ATTENTION_WINDOW_MS) } } });
}
