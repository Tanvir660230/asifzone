/**
 * The financial audit trail writer (Financial Core Phase 1, docs/FINANCE_PHASE_1.md §4.6). It takes a TRANSACTION client
 * only: the audit entry commits with the change it records or not at all. The database refuses to commit a change to a
 * finance record without an entry from the same transaction (deferred trigger, F-6), and refuses any edit or deletion of
 * an entry (F-7). This is separate from the generic, best-effort AuditLog (middlewares/audit.ts), which finance routes
 * opt out of.
 */
import type { Prisma } from "@prisma/client";
import type { AppTransactionClient } from "../../config/prisma";
import { currentCorrelationId } from "../../lib/observability/context";

export type FinanceActor =
  | { type: "ADMIN"; adminId: string; label: string; permissions: readonly string[] }
  | { type: "SYSTEM"; label: string };

export const SYSTEM_BOOTSTRAP: FinanceActor = { type: "SYSTEM", label: "system:bootstrap" };

export interface FinanceAuditInput {
  businessId: string | null;
  actor: FinanceActor;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  sourceType?: string | null;
  sourceRef?: string | null;
}

/** JSON-safe snapshot (Decimal → string, Date → ISO, bigint → string). */
export function snapshot(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v))) as Prisma.InputJsonValue;
}

export async function recordFinanceAudit(tx: AppTransactionClient, entries: FinanceAuditInput | FinanceAuditInput[]): Promise<void> {
  const list = Array.isArray(entries) ? entries : [entries];
  if (!list.length) return;
  const correlationId = currentCorrelationId();
  await tx.financeAuditEntry.createMany({
    data: list.map((e) => ({
      businessId: e.businessId,
      actorType: e.actor.type,
      actorAdminId: e.actor.type === "ADMIN" ? e.actor.adminId : null,
      actorLabel: e.actor.label,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      before: snapshot(e.before),
      after: snapshot(e.after),
      reason: e.reason ?? null,
      sourceType: e.sourceType ?? null,
      sourceRef: e.sourceRef ?? null,
      correlationId: correlationId ?? null,
    })),
  });
}

/** Whether an actor may do something gated by a finance permission (SYSTEM actors act on behalf of the platform). */
export function actorCan(actor: FinanceActor, permission: string): boolean {
  return actor.type === "SYSTEM" || actor.permissions.includes(permission);
}
