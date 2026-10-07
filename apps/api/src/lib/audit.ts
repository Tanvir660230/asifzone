import type { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { captureError } from "./observability/error-capture";
import { currentCorrelationId } from "./observability/context";

interface RecordAuditInput {
  adminId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

/**
 * Fire-and-forget audit trail write — never blocks or fails the request it's logging.
 * Envelope (Blueprint V2): every row also records the request's correlation id (`metadata.requestId`), so an entry
 * leads straight to that request's logs and to the other audit rows the same action wrote.
 */
export function recordAudit(input: RecordAuditInput): void {
  const requestId = currentCorrelationId();
  const metadata = requestId ? { ...(input.metadata ?? {}), requestId } : input.metadata;
  prisma.auditLog
    .create({
      data: {
        adminId: input.adminId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        metadata: metadata as Prisma.InputJsonValue | undefined,
        ipAddress: input.ipAddress ?? null,
      },
    })
    .catch((err) => captureError(err, { msg: "[audit] failed to record", detail: input.action }));
}
