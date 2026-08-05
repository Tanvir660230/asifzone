import type { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";

interface RecordAuditInput {
  adminId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

/** Fire-and-forget audit trail write — never blocks or fails the request it's logging. */
export function recordAudit(input: RecordAuditInput): void {
  prisma.auditLog
    .create({
      data: {
        adminId: input.adminId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        metadata: input.metadata as Prisma.InputJsonValue | undefined,
        ipAddress: input.ipAddress ?? null,
      },
    })
    .catch((err) => console.error("[audit] failed to record", input.action, err));
}
